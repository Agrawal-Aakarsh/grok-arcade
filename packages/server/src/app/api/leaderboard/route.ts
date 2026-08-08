/**
 * GET /api/leaderboard?day=YYYY-MM-DD&limit=20 -> { day, entries }
 *
 * Public: no identity required, so the board can be shown before login.
 */

import { dayKey } from "@x-arcade/shared";

import { enforceRateLimit, fail, ok } from "@/lib/api";
import { getStore } from "@/lib/store";

export async function GET(request: Request): Promise<Response> {
  const limited = await enforceRateLimit(request, "read", null);
  if (limited) return limited;

  const params = new URL(request.url).searchParams;
  const requested = params.get("day");
  if (requested !== null && !/^\d{4}-\d{2}-\d{2}$/.test(requested)) {
    return fail(400, "day must be YYYY-MM-DD");
  }

  const day = requested ?? dayKey();
  const limit = Math.min(Math.max(Number.parseInt(params.get("limit") ?? "20", 10) || 20, 1), 100);
  const entries = await getStore().leaderboard(day, limit);

  return ok({ day, entries });
}
