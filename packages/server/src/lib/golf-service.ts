/**
 * Golf orchestration: the daily target, and the async attempt lifecycle.
 *
 * Generation takes 10-30s and judging another 10-20s — far past a serverless
 * response budget. So `POST /golf/attempt` inserts a pending row and returns
 * immediately; the work runs in `after()` and the client polls.
 *
 * The rule inherited from the reference project, which cost someone a debugging
 * session: a dangling `void doWork()` is NOT tracked by Vercel's waitUntil. The
 * instance freezes the moment the response is sent and the job silently never
 * finishes. Every background job must go through `after()`.
 */

import { after } from "next/server";

import { buildDailyTarget } from "./providers/daily-target";
import { generateImage } from "./providers/generate";
import { judge } from "./providers/jury";
import { XaiError } from "./providers/xai";
import { MAX_GENERATIONS_PER_DAY } from "./rules";
import { getStore } from "./store/index";
import type { GolfDailyRow } from "./store/types";

/** A build that has not published within this is presumed dead and reclaimable. */
const CLAIM_STALE_MS = 90_000;
/** How long a request will wait for someone else's build before giving up. */
const WAIT_DEADLINE_MS = 20_000;

/**
 * Resolve today's target, building it if nobody has.
 *
 * Exactly one caller builds; everyone else polls until it appears. Without the
 * claim, a cold morning with five simultaneous players would generate five
 * different targets and five bills.
 */
export async function resolveDailyTarget(day: string): Promise<GolfDailyRow | null> {
  const store = getStore();
  const deadline = Date.now() + WAIT_DEADLINE_MS;

  for (;;) {
    const { claimed, row } = await store.claimGolfDaily(day, CLAIM_STALE_MS);
    if (row?.status === "ready" && row.imageId) return row;

    if (claimed) {
      try {
        const target = await buildDailyTarget(day);
        await store.putImage(target.image);
        await store.publishGolfDaily(day, target.sourcePrompt, target.image.id);
        return store.getGolfDaily(day);
      } catch (error) {
        console.error(`[golf] daily build failed for ${day}:`, error);
        return null;
      }
    }

    if (Date.now() >= deadline) return null; // caller answers 503 retryable
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * Run one attempt to completion. Called from `after()`, never inline.
 *
 * Statuses move pending -> generating -> judging -> scored|failed, and the
 * client renders each one. That is not decoration: generation and judging fail
 * for different reasons, and "which stage died" is the first thing anyone needs
 * when this misbehaves.
 */
export async function runAttempt(attemptId: string): Promise<void> {
  const store = getStore();
  const attempt = await store.getAttempt(attemptId);
  if (!attempt || attempt.status !== "pending") return;

  const daily = await store.getGolfDaily(attempt.day);
  if (!daily?.imageId) {
    await store.updateAttempt(attemptId, { status: "failed", error: "today's target isn't ready yet" });
    return;
  }

  try {
    await store.updateAttempt(attemptId, { status: "generating" });

    // Checked here rather than at submit time so the ceiling counts actual
    // paid calls, not requests that were rejected before spending anything.
    if (!(await store.consumeBudget(attempt.day, MAX_GENERATIONS_PER_DAY))) {
      await store.updateAttempt(attemptId, {
        status: "failed",
        error: "the arcade hit today's generation budget — try again tomorrow",
      });
      return;
    }

    const image = await generateImage(attempt.prompt);
    await store.putImage(image);
    await store.updateAttempt(attemptId, { status: "judging", imageId: image.id });

    const target = await store.getImage(daily.imageId);
    if (!target) throw new Error("target image missing from store");

    const verdict = await judge(target, image);
    await store.updateAttempt(attemptId, {
      status: "scored",
      score: verdict.total,
      jury: verdict,
    });
    console.info(`[golf] ${attempt.handle} fidelity ${verdict.total} in ${attempt.strokes} strokes`);
  } catch (error) {
    // Never record a failed judging as a score of zero — that reads to the
    // player as "your prompt was terrible" when the truth is "we fell over".
    const message =
      error instanceof XaiError && error.blocked
        ? "that prompt couldn't be turned into an image — try different wording"
        : error instanceof Error
          ? error.message
          : "generation failed";
    console.error(`[golf] attempt ${attemptId} failed:`, error);
    await store.updateAttempt(attemptId, { status: "failed", error: message.slice(0, 200) });
  }
}

/** Queue an attempt so it survives the response being sent. */
export function scheduleAttempt(attemptId: string): void {
  after(() => runAttempt(attemptId).catch((error) => console.error("[golf] job crashed:", error)));
}

/** Warm tomorrow's target off the back of a request, so nobody waits at midnight. */
export function warmNextDay(day: string): void {
  after(() =>
    resolveDailyTarget(day).catch((error) => console.error(`[golf] warm ${day} failed:`, error)),
  );
}
