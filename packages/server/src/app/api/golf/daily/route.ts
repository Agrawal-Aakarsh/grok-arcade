/**
 * GET /api/golf/daily -> { day, imageId, attempts, bar, maxChars }
 *
 * Returns today's target *image id*, never the source prompt that produced it.
 * That prompt is the answer key: exposing it would turn Golf from "recreate
 * what you see" into "copy the string", which is not a game.
 */

import { ATTEMPTS_PER_DAY, dayKey, MAX_PROMPT_CHARS, PAR_CHARS } from "@x-arcade/shared";

import { authenticate, enforceRateLimit, fail, ok } from "@/lib/api";
import { resolveDailyTarget, warmNextDay } from "@/lib/golf-service";
import { getStore } from "@/lib/store";

export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const limited = await enforceRateLimit(request, "read", null);
  if (limited) return limited;

  const day = dayKey();
  const daily = await resolveDailyTarget(day);
  if (!daily?.imageId) {
    // Someone else is mid-build. Tell the client to come back rather than
    // starting a second one.
    return fail(503, "today's target is still being generated — try again in a moment", { retryable: true });
  }

  // Pre-build tomorrow off the back of a real request, so the first player
  // after midnight doesn't eat a 40s wait.
  warmNextDay(new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10));

  const identity = await authenticate(request);
  const attempts = identity ? await getStore().attemptsFor(identity.handle, day) : [];

  return ok({
    day,
    imageId: daily.imageId,
    par: PAR_CHARS,
    maxChars: MAX_PROMPT_CHARS,
    attemptsAllowed: ATTEMPTS_PER_DAY,
    attempts: attempts.map((a) => ({
      id: a.id,
      prompt: a.prompt,
      strokes: a.strokes,
      status: a.status,
      score: a.score,
      imageId: a.imageId,
      error: a.error,
    })),
  });
}
