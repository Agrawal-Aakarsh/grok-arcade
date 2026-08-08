#!/usr/bin/env node
/**
 * Migration runner — plain SQL files, applied in filename order, tracked in a
 * table, serialised behind an advisory lock.
 *
 * Not the Supabase CLI, deliberately: this needs nothing installed but Node and
 * a DATABASE_URL, which means it runs identically on a laptop and in Vercel's
 * build step. The advisory lock matters because Vercel can build two deploys
 * concurrently and both would otherwise race the same migration.
 *
 *   node scripts/migrate.mjs           apply pending migrations
 *   node scripts/migrate.mjs --check   exit 1 if any are pending (CI drift guard)
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "supabase", "migrations");
const LOCK_ID = 918_273_646;

/**
 * Read DATABASE_URL from the environment, falling back to dotenv files.
 *
 * packages/server is checked first because that is where Next auto-loads
 * .env.local from — keeping one file for both the dev server and migrations,
 * rather than a root file that only half the tooling can see.
 */
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const candidates = [
    join(ROOT, "packages", "server", ".env.local"),
    join(ROOT, "packages", "server", ".env"),
    join(ROOT, ".env.local"),
    join(ROOT, ".env"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const match = readFileSync(path, "utf8").match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/m);
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

const url = databaseUrl();
if (!url) {
  console.error(
    "\nDATABASE_URL is not set.\n\n" +
      "  Supabase → Project Settings → Database → Connection string → URI\n" +
      "  Use the *session* pooler URI for migrations (port 5432).\n\n" +
      "  DATABASE_URL='postgresql://...' npm run migrate --workspace packages/server\n",
  );
  process.exit(1);
}

const check = process.argv.includes("--check");
const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 15, onnotice: () => {} });

try {
  await sql`select pg_advisory_lock(${LOCK_ID})`;
  await sql`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `;
  // Same server-only posture as every table in the migrations themselves: RLS
  // on, no policies. It only holds filenames, but "every table" should mean
  // every table, including the one the runner creates for itself.
  await sql`alter table schema_migrations enable row level security`;

  const applied = new Set((await sql`select name from schema_migrations`).map((row) => row.name));
  const files = readdirSync(DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const pending = files.filter((name) => !applied.has(name));

  if (pending.length === 0) {
    console.log(`✓ up to date (${files.length} migration${files.length === 1 ? "" : "s"})`);
  } else if (check) {
    console.error(`✗ ${pending.length} pending migration(s):\n  ${pending.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    for (const name of pending) {
      process.stdout.write(`applying ${name} … `);
      // Each file runs in its own transaction: a failure half way leaves the
      // database on the last good migration rather than in a partial state.
      await sql.begin(async (tx) => {
        await tx.unsafe(readFileSync(join(DIR, name), "utf8"));
        await tx`insert into schema_migrations (name) values (${name})`;
      });
      console.log("ok");
    }
    console.log(`✓ applied ${pending.length}`);
  }
} catch (error) {
  console.error("\n✗ migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await sql`select pg_advisory_unlock(${LOCK_ID})`.catch(() => {});
  await sql.end({ timeout: 5 });
}
