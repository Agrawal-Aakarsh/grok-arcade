/**
 * xAI transport. Raw fetch — there is no official xAI TypeScript SDK.
 *
 * (`@xai-org/sdk` does not exist; `xai-sdk` on npm is a 306-byte alpha squatted
 * by a private individual; `xai` is an xAI-owned name reservation reading
 * "coming soon". The real SDK is Python-only.)
 *
 * Nothing here is OpenAI. xAI documents `/v1/chat/completions` as accepting the
 * same *wire format*, which is a body shape, not a dependency.
 */

export const XAI_BASE_URL = process.env["XAI_BASE_URL"] ?? "https://api.x.ai/v1";

export const MODELS = {
  /** Vision + text. Also does structured outputs. */
  judge: process.env["JUDGE_MODEL"] ?? "grok-4.5",
  /** $0.02/image — what players' attempts use. */
  image: process.env["IMAGE_MODEL"] ?? "grok-imagine-image",
  /** $0.05/image — the daily target is generated once, so pay for quality. */
  targetImage: process.env["TARGET_IMAGE_MODEL"] ?? "grok-imagine-image-quality",
} as const;

/** Mock unless a key is present, so dev and tests never spend money. */
export function hasKey(): boolean {
  return Boolean(process.env["XAI_API_KEY"]);
}

export class XaiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** 429 and 5xx are worth retrying; 4xx is not. */
    readonly retryable: boolean,
    /** Content moderation refused the prompt — a player-facing outcome. */
    readonly blocked = false,
  ) {
    super(message);
    this.name = "XaiError";
  }
}

function classify(status: number, detail: string): XaiError {
  const blocked = status === 422 || /safety|content[ _-]?polic|nsfw|prohibited|moderation/i.test(detail);
  return new XaiError(status, detail.slice(0, 300), status === 429 || status >= 500, blocked);
}

export async function xaiFetch<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const response = await fetch(`${XAI_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env["XAI_API_KEY"]}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  if (!response.ok) throw classify(response.status, text);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new XaiError(response.status, "xAI returned non-JSON", false);
  }
}

/**
 * Retry with jittered backoff. Jitter matters because all three jury votes fire
 * at once — without it they would retry in lockstep and hammer the same
 * rate limit together.
 */
export async function withRetry<T>(label: string, attempts: number, work: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await work();
    } catch (error) {
      last = error;
      const retryable = error instanceof XaiError ? error.retryable : true;
      if (!retryable || attempt === attempts - 1) break;
      const backoff = 500 * 2 ** attempt + Math.floor(Math.random() * 400);
      console.warn(`[xai] ${label} attempt ${attempt + 1} failed, retrying in ${backoff}ms`);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
  throw last;
}
