/**
 * POST /api/breakout/run  { score, level, ticks, elapsedMs, cleared } -> { rank, best }
 *
 * Unlike Serpent there is no runs-per-day cap. Serpent caps at 3 because
 * everyone plays an identical date-seeded maze, so unlimited attempts would
 * reward whoever grinds longest rather than whoever plays best. Breakout is not
 * seeded — there is no shared board to protect — so the honest ranking is your
 * best score of the day, however many runs that took.
 */

import { dayKey } from "@x-arcade/shared";

import { authenticate, enforceRateLimit, fail, ok } from "@/lib/api";
import { getStore } from "@/lib/store";

/** Cheap plausibility only, same posture as Serpent. */
const MAX_PLAUSIBLE_SCORE = 5_000_000;
const MAX_LEVEL = 10;

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

  const { score, level, ticks, elapsedMs, cleared } = (body ?? {}) as Record<string, unknown>;
  if (typeof score !== "number" || typeof level !== "number" || typeof ticks !== "number") {
    return fail(400, "score, level and ticks must be numbers");
  }
  if (!Number.isInteger(score) || !Number.isInteger(level) || !Number.isInteger(ticks)) {
    return fail(400, "score, level and ticks must be integers");
  }
  if (score < 0 || ticks < 0 || level < 1 || level > MAX_LEVEL) return fail(400, "out of range");
  if (score > MAX_PLAUSIBLE_SCORE) return fail(422, "implausible score");

  const day = dayKey();
  const store = getStore();
  await store.addBreakoutRun(identity.handle, day, {
    score,
    level,
    ticks,
    elapsedMs: typeof elapsedMs === "number" ? Math.max(0, Math.round(elapsedMs)) : 0,
    cleared: cleared === true,
  });

  const board = await store.breakoutBoard(day, 500);
  const rank = board.findIndex((entry) => entry.handle === identity.handle) + 1;
  const best = board.find((entry) => entry.handle === identity.handle) ?? null;

  return ok({ accepted: true, rank: rank || null, best, players: board.length });
}
