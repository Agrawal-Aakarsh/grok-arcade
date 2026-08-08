/**
 * POST /api/serpent/run  { day, apples, ticks, elapsedMs } -> { accepted, runs, best, rank }
 *
 * Requires x-arcade-handle / x-arcade-token headers.
 */

import { dayKey } from "@x-arcade/shared";

import { authenticate, enforceRateLimit, fail, ok } from "@/lib/api";
import { MAX_PLAUSIBLE_APPLES, MIN_TICKS_PER_APPLE, RANKED_RUNS_PER_DAY } from "@/lib/rules";
import { getStore } from "@/lib/store";

export async function POST(request: Request): Promise<Response> {
  const identity = await authenticate(request);
  if (!identity) return fail(401, "run `arcade login` first");

  const limited = await enforceRateLimit(request, "run", identity.handle);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "invalid json");
  }

  const { day: rawDay, apples, ticks, elapsedMs } = (body ?? {}) as Record<string, unknown>;
  if (typeof apples !== "number" || typeof ticks !== "number" || typeof elapsedMs !== "number") {
    return fail(400, "apples, ticks and elapsedMs must be numbers");
  }
  if (!Number.isInteger(apples) || !Number.isInteger(ticks) || apples < 0 || ticks < 0) {
    return fail(400, "apples and ticks must be non-negative integers");
  }

  const day = typeof rawDay === "string" ? rawDay : dayKey();
  // Only today counts. Backdating would let anyone farm an empty old board.
  if (day !== dayKey()) return fail(400, "only today's runs can be submitted");

  // Cheap plausibility only. A determined player can still forge a believable
  // score; the honest fix is replaying the input log server-side, which the
  // engine is deterministic enough to support. Left for later deliberately —
  // this is an honour-system leaderboard among friends.
  if (apples > MAX_PLAUSIBLE_APPLES) return fail(422, "implausible score");
  if (apples > 0 && ticks < apples * MIN_TICKS_PER_APPLE) return fail(422, "implausible score");

  const store = getStore();
  const existing = await store.runsFor(identity.handle, day);
  if (existing.length >= RANKED_RUNS_PER_DAY) {
    return ok({ accepted: false, reason: "daily runs used", runs: existing.length });
  }

  await store.addRun(identity.handle, day, { apples, ticks, elapsedMs, at: Date.now() });

  const runs = await store.runsFor(identity.handle, day);
  const best = [...runs].sort((a, b) => b.apples - a.apples || a.ticks - b.ticks)[0] ?? null;
  const board = await store.leaderboard(day, 500);
  const rank = board.findIndex((entry) => entry.handle === identity.handle) + 1;

  return ok({ accepted: true, runs: runs.length, best, rank: rank || null, players: board.length });
}
