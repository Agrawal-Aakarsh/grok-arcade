/**
 * Storage interface.
 *
 * Two implementations, exactly as the reference project does it: Postgres for
 * real deployments and an in-memory twin so `npm run dev` works with zero
 * configuration. Every route is written against this interface, so the memory
 * store is a genuine test double rather than a stub that drifts.
 */

export interface RunRecord {
  apples: number;
  ticks: number;
  elapsedMs: number;
  at: number;
}

export interface LeaderboardEntry {
  handle: string;
  apples: number;
  ticks: number;
  runs: number;
}

export interface ClaimResult {
  ok: boolean;
  token?: string;
  /** Set when ok is false — the handle exists and the token did not match. */
  reason?: "taken";
}

export interface RateVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface Store {
  /**
   * Claim a handle, or re-authenticate an existing one.
   * First claim wins and mints a device token; later logins must present it.
   */
  claimHandle(handle: string, token?: string): Promise<ClaimResult>;
  verifyHandle(handle: string, token: string): Promise<boolean>;

  /** Ranked runs already banked for that handle on that day. */
  runsFor(handle: string, day: string): Promise<RunRecord[]>;
  addRun(handle: string, day: string, run: RunRecord): Promise<void>;

  leaderboard(day: string, limit: number): Promise<LeaderboardEntry[]>;

  /** Fixed-window counter. Fails open at the call site, never here. */
  rateLimit(key: string, limit: number, windowMs: number): Promise<RateVerdict>;
}
