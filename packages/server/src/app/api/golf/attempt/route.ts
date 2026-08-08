/**
 * POST /api/golf/attempt  { prompt } -> { id, status }
 *
 * Returns immediately with a pending row; generation and judging happen in
 * `after()`. The client polls GET /api/golf/attempt/[id].
 */

import { ATTEMPTS_PER_DAY, dayKey, MAX_PROMPT_CHARS, strokesOf } from "@x-arcade/shared";
import { randomUUID } from "node:crypto";

import { authenticate, enforceRateLimit, fail, ok } from "@/lib/api";
import { resolveDailyTarget, scheduleAttempt } from "@/lib/golf-service";
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

  const prompt = typeof (body as { prompt?: unknown })?.prompt === "string" ? (body as { prompt: string }).prompt.trim() : "";
  if (!prompt) return fail(400, "prompt is required");
  const strokes = strokesOf(prompt);
  if (strokes > MAX_PROMPT_CHARS) return fail(400, `prompt must be ${MAX_PROMPT_CHARS} characters or fewer`);

  const day = dayKey();
  const daily = await resolveDailyTarget(day);
  if (!daily?.imageId) return fail(503, "today's target isn't ready yet", { retryable: true });

  const store = getStore();
  const existing = await store.attemptsFor(identity.handle, day);
  if (existing.length >= ATTEMPTS_PER_DAY) {
    return fail(429, `you've used all ${ATTEMPTS_PER_DAY} attempts today`, { attempts: existing.length });
  }
  // One at a time: attempts are sequential by design, so you see each result
  // before spending the next one.
  if (existing.some((a) => a.status !== "scored" && a.status !== "failed")) {
    return fail(409, "your previous attempt is still being judged");
  }

  const id = randomUUID();
  await store.createAttempt({
    id,
    handle: identity.handle,
    day,
    prompt,
    strokes,
    status: "pending",
    imageId: null,
    score: null,
    cleared: null,
    jury: null,
    error: null,
  });

  scheduleAttempt(id);
  return ok({ id, status: "pending", strokes, attemptsUsed: existing.length + 1 });
}
