/**
 * GET /api/golf/ghosts -> everyone's best card for today.
 *
 * This is the multiplayer. Prompts are revealed here — that is the point, and
 * why it is gated on having finished your own attempts. Seeing a 17-stroke
 * prompt that cleared before you have played would just be the answer.
 */

import { ATTEMPTS_PER_DAY, dayKey } from "@x-arcade/shared";

import { authenticate, enforceRateLimit, ok } from "@/lib/api";
import { getStore } from "@/lib/store";

export async function GET(request: Request): Promise<Response> {
  const limited = await enforceRateLimit(request, "read", null);
  if (limited) return limited;

  const day = dayKey();
  const store = getStore();
  const identity = await authenticate(request);

  const mine = identity ? await store.attemptsFor(identity.handle, day) : [];
  const settled = mine.filter((a) => a.status === "scored" || a.status === "failed").length;
  const unlocked = settled >= ATTEMPTS_PER_DAY;

  const board = await store.golfBoard(day, 20);

  return ok({
    day,
    unlocked,
    attemptsUsed: settled,
    attemptsAllowed: ATTEMPTS_PER_DAY,
    ghosts: board.map((entry, index) => ({
      rank: index + 1,
      handle: entry.handle,
      strokes: entry.strokes,
      score: entry.score,
      imageId: entry.imageId,
      // Withheld until you've played. The rank and stroke count still show, so
      // the board is legible as a scoreboard beforehand.
      prompt: unlocked || entry.handle === identity?.handle ? entry.prompt : null,
    })),
  });
}
