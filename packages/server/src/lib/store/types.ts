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

export interface StoredImage {
  id: string;
  bytes: Buffer;
  mime: string;
}

export type AttemptStatus = "pending" | "generating" | "judging" | "scored" | "failed";

export interface GolfAttemptRow {
  id: string;
  handle: string;
  day: string;
  prompt: string;
  strokes: number;
  status: AttemptStatus;
  imageId: string | null;
  score: number | null;
  cleared: boolean | null;
  jury: unknown;
  error: string | null;
  createdAt: number;
}

export interface GolfDailyRow {
  day: string;
  sourcePrompt: string | null;
  imageId: string | null;
  status: "pending" | "ready";
  claimedAt: number;
}

export interface GolfStore {
  putImage(image: StoredImage): Promise<void>;
  getImage(id: string): Promise<StoredImage | null>;

  /**
   * Atomically claim the right to build today's target. Exactly one caller gets
   * `claimed: true`; everyone else polls. A stale claim (a crashed builder) is
   * reclaimable after `staleMs`.
   */
  claimGolfDaily(day: string, staleMs: number): Promise<{ claimed: boolean; row: GolfDailyRow | null }>;
  publishGolfDaily(day: string, sourcePrompt: string, imageId: string): Promise<void>;
  getGolfDaily(day: string): Promise<GolfDailyRow | null>;

  createAttempt(row: Omit<GolfAttemptRow, "createdAt">): Promise<void>;
  updateAttempt(id: string, patch: Partial<GolfAttemptRow>): Promise<void>;
  getAttempt(id: string): Promise<GolfAttemptRow | null>;
  attemptsFor(handle: string, day: string): Promise<GolfAttemptRow[]>;
  /** Best cleared attempt per player — the ghost gallery and the daily board. */
  golfBoard(day: string, limit: number): Promise<GolfAttemptRow[]>;

  /** Increment the global daily spend counter; false means the ceiling is hit. */
  consumeBudget(day: string, limit: number): Promise<boolean>;
}

export interface Store extends GolfStore {
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
