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

import { cardFor, compareCards, type GolfCard } from "@x-arcade/shared";

import { RANKED_RUNS_PER_DAY } from "../rules";
import type {
  ClaimResult,
  GolfAttemptRow,
  GolfDailyRow,
  LeaderboardEntry,
  RateVerdict,
  RunRecord,
  Store,
} from "./types";

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

    /* ── Golf ─────────────────────────────────────────────────────────── */

    async putImage(image) {
      await sql()`
        insert into images (id, bytes, mime) values (${image.id}, ${image.bytes}, ${image.mime})
        on conflict (id) do nothing
      `;
    },

    async getImage(id) {
      const rows = await sql()<{ id: string; bytes: Buffer; mime: string }[]>`
        select id, bytes, mime from images where id = ${id}
      `;
      return rows[0] ?? null;
    },

    async claimGolfDaily(day, staleMs) {
      const db = sql();
      const staleBefore = new Date(Date.now() - staleMs);

      // One atomic statement decides the winner. A select-then-insert would let
      // two cold serverless functions both conclude "nobody has built today"
      // and each burn a paid image generation.
      const claimed = await db<{ day: string }[]>`
        insert into golf_dailies (day, status, claimed_at) values (${day}, 'pending', now())
        on conflict (day) do update
          set claimed_at = now()
          where golf_dailies.status = 'pending' and golf_dailies.claimed_at < ${staleBefore}
        returning day
      `;

      const row = await this.getGolfDaily(day);
      return { claimed: claimed.length > 0, row };
    },

    async publishGolfDaily(day, sourcePrompt, imageId) {
      // coalesce: a slow-but-alive builder must not swap the image out from
      // under players who already started on the published one.
      await sql()`
        insert into golf_dailies (day, source_prompt, image_id, status)
        values (${day}, ${sourcePrompt}, ${imageId}, 'ready')
        on conflict (day) do update set
          source_prompt = coalesce(golf_dailies.source_prompt, excluded.source_prompt),
          image_id      = coalesce(golf_dailies.image_id, excluded.image_id),
          status        = 'ready'
      `;
    },

    async getGolfDaily(day) {
      const rows = await sql()<GolfDailyRow[]>`
        select day::text as day, source_prompt as "sourcePrompt", image_id as "imageId", status,
               floor(extract(epoch from claimed_at) * 1000)::float8 as "claimedAt"
        from golf_dailies where day = ${day}
      `;
      return rows[0] ?? null;
    },

    async createAttempt(row) {
      await sql()`
        insert into golf_attempts (id, handle, day, prompt, strokes, status)
        values (${row.id}, ${row.handle}, ${row.day}, ${row.prompt}, ${row.strokes}, ${row.status})
      `;
    },

    async updateAttempt(id, patch) {
      const db = sql();
      await db`
        update golf_attempts set
          status    = coalesce(${patch.status ?? null}, status),
          image_id  = coalesce(${patch.imageId ?? null}, image_id),
          score     = coalesce(${patch.score ?? null}, score),
          cleared   = coalesce(${patch.cleared ?? null}, cleared),
          jury      = coalesce(${patch.jury ? db.json(patch.jury as never) : null}, jury),
          error     = coalesce(${patch.error ?? null}, error),
          scored_at = case when ${patch.status ?? null} in ('scored','failed') then now() else scored_at end
        where id = ${id}
      `;
    },

    async getAttempt(id) {
      const rows = await sql()<GolfAttemptRow[]>`
        select id, handle, day::text as day, prompt, strokes, status, image_id as "imageId",
               score, cleared, jury, error,
               floor(extract(epoch from created_at) * 1000)::float8 as "createdAt"
        from golf_attempts where id = ${id}
      `;
      return rows[0] ?? null;
    },

    async attemptsFor(handle, day) {
      return sql()<GolfAttemptRow[]>`
        select id, handle, day::text as day, prompt, strokes, status, image_id as "imageId",
               score, cleared, jury, error,
               floor(extract(epoch from created_at) * 1000)::float8 as "createdAt"
        from golf_attempts where handle = ${handle} and day = ${day}
        order by created_at asc
      `;
    },

    async golfBoard(day, limit) {
      // The final score is fidelity x a length multiplier, so it is not a
      // column and cannot be ORDER BY'd. Fetch the day's scored attempts and
      // rank them with the shared rules — one source of truth for the maths.
      const rows = await sql()<GolfAttemptRow[]>`
        select id, handle, day::text as day, prompt, strokes, status, image_id as "imageId",
               score, cleared, jury, error,
               floor(extract(epoch from created_at) * 1000)::float8 as "createdAt"
        from golf_attempts
        where day = ${day} and status = 'scored' and score is not null
      `;

      const bestByHandle = new Map<string, { row: GolfAttemptRow; card: GolfCard }>();
      for (const row of rows) {
        const card = cardFor({ prompt: row.prompt, score: row.score });
        if (!card) continue;
        const current = bestByHandle.get(row.handle);
        if (!current || compareCards(card, current.card) < 0) bestByHandle.set(row.handle, { row, card });
      }

      return [...bestByHandle.values()]
        .sort((a, b) => compareCards(a.card, b.card))
        .slice(0, limit)
        .map((entry) => entry.row);
    },

    async consumeBudget(day, limit) {
      // Increment and check in one statement, so concurrent attempts cannot
      // both read "one left" and both spend it.
      const rows = await sql()<{ used: number }[]>`
        insert into generation_budget (day, used) values (${day}, 1)
        on conflict (day) do update set used = generation_budget.used + 1
        where generation_budget.used < ${limit}
        returning used
      `;
      return rows.length > 0;
    },

    /* ── shared ───────────────────────────────────────────────────────── */

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
