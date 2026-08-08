/**
 * Server-side rules and tunables. Everything here is env-overridable so limits
 * can change without a redeploy.
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Ranked Serpent runs per handle per day. Best of these is your rank. */
export const RANKED_RUNS_PER_DAY = envInt("RANKED_RUNS_PER_DAY", 3);

/**
 * Salt for the daily seed. Lives only on the server, so the maze and apple
 * sequence for future days cannot be datamined out of the published npm
 * package — a client can derive today's board only by asking for it.
 */
export const SERVER_SALT = process.env["SERVER_SALT"] ?? "x-arcade-dev-salt";

export const RATE_LIMITS = {
  windowMs: envInt("RATE_LIMIT_WINDOW_MS", 10 * 60 * 1000),
  login: envInt("RATE_LIMIT_LOGIN", 20),
  run: envInt("RATE_LIMIT_RUN", 40),
  read: envInt("RATE_LIMIT_READ", 120),
};

/**
 * A run is rejected outright above this. Not anti-cheat — a determined player
 * can still forge a plausible score, and the honest fix is server-side replay
 * of the input log, which the engine is already deterministic enough to
 * support. This only stops the laziest nonsense from wrecking the board.
 */
export const MAX_PLAUSIBLE_APPLES = envInt("MAX_PLAUSIBLE_APPLES", 400);

/** Every apple needs at least a few ticks to reach; below this is impossible. */
export const MIN_TICKS_PER_APPLE = 2;
