/**
 * GET /api/golf/attempt/[id] -> the attempt's current state.
 *
 * Polled every ~2s by the client while status is pending/generating/judging.
 */

import { authenticate, fail, ok } from "@/lib/api";
import { getStore } from "@/lib/store";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const identity = await authenticate(request);
  if (!identity) return fail(401, "run `arcade login` first");

  const { id } = await context.params;
  const attempt = await getStore().getAttempt(id);
  if (!attempt) return fail(404, "no such attempt");
  // Your attempt is yours: another player must not be able to poll it and read
  // your prompt before the ghost gallery is meant to reveal it.
  if (attempt.handle !== identity.handle) return fail(403, "not your attempt");

  return ok({
    id: attempt.id,
    prompt: attempt.prompt,
    strokes: attempt.strokes,
    status: attempt.status,
    score: attempt.score,
    imageId: attempt.imageId,
    jury: attempt.jury,
    error: attempt.error,
  });
}
