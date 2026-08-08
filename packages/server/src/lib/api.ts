/**
 * Shared route helpers: responses, identity, rate limiting.
 */

import { NextResponse } from "next/server";

import { getStore } from "./store/index";
import { RATE_LIMITS } from "./rules";

export function ok<T>(body: T): NextResponse {
  return NextResponse.json(body);
}

export function fail(status: number, error: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error, ...extra }, { status });
}

/** X handles: 1-15 chars, letters/digits/underscore. Stored lower-cased. */
export function normaliseHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const handle = raw.trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

/**
 * Best-effort client IP. Vercel sets x-forwarded-for; the first entry is the
 * client and the rest are proxies.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/**
 * Fixed-window rate limit.
 *
 * Keyed on IP plus handle, deliberately *not* on any client-supplied id alone —
 * that would be trivially rotatable and the guard would be decorative.
 * Fails open: a store hiccup should not lock everyone out of the game.
 */
export async function enforceRateLimit(
  request: Request,
  name: keyof typeof RATE_LIMITS,
  handle: string | null,
): Promise<NextResponse | null> {
  const limit = RATE_LIMITS[name];
  if (typeof limit !== "number") return null;
  try {
    const key = `${name}:${clientIp(request)}:${handle ?? "anon"}`;
    const verdict = await getStore().rateLimit(key, limit, RATE_LIMITS.windowMs);
    if (verdict.allowed) return null;
    return NextResponse.json(
      { error: "rate limited" },
      { status: 429, headers: { "retry-after": String(Math.ceil(verdict.retryAfterMs / 1000)) } },
    );
  } catch {
    return null;
  }
}

export interface Identity {
  handle: string;
  token: string;
}

/** Read and verify the caller's identity from headers. */
export async function authenticate(request: Request): Promise<Identity | null> {
  const handle = normaliseHandle(request.headers.get("x-arcade-handle"));
  const token = request.headers.get("x-arcade-token");
  if (!handle || !token) return null;
  return (await getStore().verifyHandle(handle, token)) ? { handle, token } : null;
}
