/**
 * Postgres store, used whenever DATABASE_URL is set.
 *
 * Connection options are tuned for Supabase's transaction pooler:
 * `prepare: false` is required there (the pooler does not keep a session, so
 * prepared statements break), and the pool is deliberately small because
 * serverless functions each hold their own.
 */

import { randomBytes } from "node:crypto";

import postgres from "postgres";

import { RANKED_RUNS_PER_DAY } from "../rules";
import type { ClaimResult, LeaderboardEntry, RateVerdict, RunRecord, Store } from "./types";

const globalSql = globalThis as unknown as { __xArcadeSql?: postgres.Sql };

function sql(): postgres.Sql {
  globalSql.__xArcadeSql ??= postgres(process.env["DATABASE_URL"]!, {
    max: 5,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    max_lifetime: 1800,
  });
  return globalSql.__xArcadeSql;
}

export function createPostgresStore(): Store {
  return {
    async claimHandle(handle, token): Promise<ClaimResult> {
      const db = sql();
      const minted = randomBytes(24).toString("base64url");

      // Atomic claim: insert wins outright, conflict returns nothing and we
      // fall through to verifying the presented token. Doing this as a
      // select-then-insert would race two players claiming the same handle.
      const claimed = await db<{ token: string }[]>`
        insert into handles (handle, token) values (${handle}, ${minted})
        on conflict (handle) do nothing
        returning token
      `;
      if (claimed.length > 0) return { ok: true, token: minted };

      if (token) {
        const rows = await db<{ handle: string }[]>`
          select handle from handles where handle = ${handle} and token = ${token}
        `;
        if (rows.length > 0) return { ok: true, token };
      }
      return { ok: false, reason: "taken" };
    },

    async verifyHandle(handle, token) {
      const rows = await sql()<{ handle: string }[]>`
        select handle from handles where handle = ${handle} and token = ${token}
      `;
      return rows.length > 0;
    },

    async runsFor(handle, day) {
      // float8, not the default numeric: postgres.js hands numeric back as a
      // *string* to avoid precision loss, which would silently diverge from the
      // memory store's plain number and break any arithmetic on `at`.
      return sql()<RunRecord[]>`
        select apples, ticks, elapsed_ms as "elapsedMs",
               floor(extract(epoch from created_at) * 1000)::float8 as at
        from serpent_runs where handle = ${handle} and day = ${day}
        order by created_at asc
      `;
    },

    async addRun(handle, day, run) {
      // The cap is enforced in SQL rather than by a prior count, so two
      // concurrent submissions cannot both see "2 runs" and both insert.
      await sql()`
        insert into serpent_runs (handle, day, apples, ticks, elapsed_ms)
        select ${handle}, ${day}, ${run.apples}, ${run.ticks}, ${run.elapsedMs}
        where (select count(*) from serpent_runs where handle = ${handle} and day = ${day}) < ${RANKED_RUNS_PER_DAY}
      `;
    },

    async leaderboard(day, limit) {
      return sql()<LeaderboardEntry[]>`
        select distinct on (handle)
          handle, apples, ticks,
          (select count(*)::int from serpent_runs r2 where r2.handle = r1.handle and r2.day = ${day}) as runs
        from serpent_runs r1
        where day = ${day}
        order by handle, apples desc, ticks asc
      `.then((rows) =>
        [...rows].sort((a, b) => b.apples - a.apples || a.ticks - b.ticks).slice(0, limit),
      );
    },

    async rateLimit(key, limit, windowMs): Promise<RateVerdict> {
      const now = Date.now();
      const windowStart = Math.floor(now / windowMs) * windowMs;
      const rows = await sql()<{ count: number }[]>`
        insert into rate_limits (key, window_start, count) values (${key}, ${windowStart}, 1)
        on conflict (key) do update set
          count = case when rate_limits.window_start = ${windowStart} then rate_limits.count + 1 else 1 end,
          window_start = ${windowStart}
        returning count
      `;
      const count = rows[0]?.count ?? 1;
      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        retryAfterMs: windowStart + windowMs - now,
      };
    },
  } satisfies Store;
}
