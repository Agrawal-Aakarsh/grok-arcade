/**
 * Server client.
 *
 * Every call degrades: if the network is down or the server is unreachable, the
 * arcade falls back to local play rather than refusing to start. Serpent is
 * fully deterministic and offline-capable by design, so a dead network should
 * cost you the leaderboard, not the game — which also makes it the safe thing
 * to open a demo with when the venue wifi is bad.
 */

import type { RunResult } from "@x-arcade/shared";

/**
 * Baked in at build time so `npx x-arcade` needs no configuration. Override
 * with API_URL for local development against a dev server.
 */
export const API_URL = process.env["API_URL"] ?? "https://grok-arcade-server-three.vercel.app";

const TIMEOUT_MS = 6000;

export interface DailyConfigResponse {
  day: string;
  puzzle: number;
  serpent: { seed: number; mazeIndex: number };
  /** Runs the server already has for you today. Absent when signed out. */
  serpentRuns?: RunResult[];
}

export interface LeaderboardEntry {
  handle: string;
  apples: number;
  ticks: number;
  runs: number;
}

export interface SubmitResult {
  accepted: boolean;
  reason?: string;
  runs: number;
  rank: number | null;
  players?: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  handle?: string;
  token?: string;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.handle) headers["x-arcade-handle"] = options.handle;
  if (options.token) headers["x-arcade-token"] = options.token;

  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(response.status, `server returned non-JSON (${response.status})`);
  }
  if (!response.ok) {
    throw new ApiError(response.status, (parsed as { error?: string }).error ?? `request failed (${response.status})`);
  }
  return parsed as T;
}

export async function login(handle: string, token?: string): Promise<{ handle: string; token: string }> {
  return request("/api/login", { method: "POST", body: { handle, ...(token ? { token } : {}) } });
}

export async function fetchDaily(identity?: { handle: string; token: string }): Promise<DailyConfigResponse> {
  return request("/api/daily", identity ?? {});
}

export async function fetchLeaderboard(limit = 15): Promise<{ day: string; entries: LeaderboardEntry[] }> {
  return request(`/api/leaderboard?limit=${limit}`);
}

export async function submitRun(
  identity: { handle: string; token: string },
  day: string,
  run: RunResult,
): Promise<SubmitResult> {
  return request("/api/serpent/run", {
    method: "POST",
    handle: identity.handle,
    token: identity.token,
    body: { day, apples: run.apples, ticks: run.ticks, elapsedMs: run.elapsedMs },
  });
}

/* ── Prompt Golf ─────────────────────────────────────────────────────── */

export type AttemptStatus = "pending" | "generating" | "judging" | "scored" | "failed";

export interface GolfAttemptView {
  id: string;
  prompt: string;
  strokes: number;
  status: AttemptStatus;
  score: number | null;
  imageId: string | null;
  error: string | null;
  jury?: {
    total: number;
    accuracy: number;
    style: number;
    comment: string;
    spread: number;
    votes: number;
    breakdown: { subject: number; composition: number; palette: number; technique: number; mood: number };
  };
}

export interface GolfDailyView {
  day: string;
  imageId: string;
  par: number;
  maxChars: number;
  attemptsAllowed: number;
  attempts: GolfAttemptView[];
}

export interface Ghost {
  rank: number;
  handle: string;
  strokes: number;
  score: number | null;
  imageId: string | null;
  prompt: string | null;
}

export async function fetchGolfDaily(identity?: { handle: string; token: string }): Promise<GolfDailyView> {
  return request("/api/golf/daily", identity ?? {});
}

export async function submitAttempt(
  identity: { handle: string; token: string },
  prompt: string,
): Promise<{ id: string; strokes: number; attemptsUsed: number }> {
  return request("/api/golf/attempt", { method: "POST", body: { prompt }, ...identity });
}

export async function pollAttempt(
  identity: { handle: string; token: string },
  id: string,
): Promise<GolfAttemptView> {
  return request(`/api/golf/attempt/${id}`, identity);
}

export async function fetchGhosts(
  identity?: { handle: string; token: string },
): Promise<{ day: string; unlocked: boolean; ghosts: Ghost[] }> {
  return request("/api/golf/ghosts", identity ?? {});
}

/** Resized PNG for the Kitty protocol. */
export async function fetchImagePng(imageId: string, width: number, height: number): Promise<Buffer> {
  const response = await fetch(`${API_URL}/api/image/${imageId}?w=${width}&h=${height}&fmt=png`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new ApiError(response.status, "couldn't load image");
  return Buffer.from(await response.arrayBuffer());
}

/** Raw RGB24 at exactly this many pixels, for the half-block fallback. */
export async function fetchImageRgb(imageId: string, width: number, height: number): Promise<Buffer> {
  const response = await fetch(`${API_URL}/api/image/${imageId}?w=${width}&h=${height}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new ApiError(response.status, "couldn't load image");
  return Buffer.from(await response.arrayBuffer());
}

export function imageUrl(imageId: string): string {
  return `${API_URL}/api/image/${imageId}`;
}

/** Resolve a value, returning null on any network or server failure. */
export async function offlineSafe<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch {
    return null;
  }
}
