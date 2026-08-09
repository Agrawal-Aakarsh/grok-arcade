/**
 * GET /api/daily -> { day, puzzle, serpent: { seed, mazeIndex } }
 *
 * The seed is derived from the day key plus a server-only salt, so the client
 * cannot precompute tomorrow's maze from the published npm package. It can only
 * learn today's board by asking, which is what keeps the daily a daily.
 */

import { dayKey, puzzleNumber, seedForDay } from "@x-arcade/shared";

import { authenticate, enforceRateLimit, fail, ok } from "@/lib/api";
import { getStore } from "@/lib/store";
import { SERVER_SALT } from "@/lib/rules";

export async function GET(request: Request): Promise<Response> {
  const limited = await enforceRateLimit(request, "read", null);
  if (limited) return limited;

  const requested = new URL(request.url).searchParams.get("day");
  if (requested !== null && !/^\d{4}-\d{2}-\d{2}$/.test(requested)) {
    return fail(400, "day must be YYYY-MM-DD");
  }

  // UTC only. A local-timezone day would give players in different regions
  // different boards at the same moment and the leaderboard would compare
  // nothing.
  const day = requested ?? dayKey();
  const config = seedForDay(day, SERVER_SALT);

  // The client needs this to know how many ranked runs are left. It used to
  // count local runs, which meant runs played *before* signing in still burned
  // the daily allowance despite never reaching the server — you would be locked
  // into practice mode with nothing on the board.
  const identity = await authenticate(request);
  const runs = identity ? await getStore().runsFor(identity.handle, day) : [];

  return ok({
    day,
    serpentRuns: runs.map((r) => ({ apples: r.apples, ticks: r.ticks, elapsedMs: r.elapsedMs })),
    puzzle: puzzleNumber(Date.parse(`${day}T00:00:00Z`)),
    serpent: { seed: config.seed, mazeIndex: config.mazeIndex },
  });
}
