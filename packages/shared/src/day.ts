/**
 * Day math. UTC only, always.
 *
 * A daily leaderboard is only comparable if everyone agrees on when "today"
 * starts. Local timezones would give a player in Auckland a different maze from
 * one in LA at the same moment, and the board would be meaningless.
 */

/** Day 1 of X Arcade. Lets us show "Serpent #14" instead of a raw date. */
export const EPOCH_MS = Date.UTC(2026, 7, 8); // 2026-08-08

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` in UTC — the canonical key for a day's content. */
export function dayKey(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Zero-based day index since the epoch. */
export function dayIndex(now: number = Date.now()): number {
  return Math.floor((now - EPOCH_MS) / DAY_MS);
}

/** One-based puzzle number, for display. */
export function puzzleNumber(now: number = Date.now()): number {
  return dayIndex(now) + 1;
}

/** Epoch ms of the next UTC midnight — drives the "next puzzle in 4h 12m" line. */
export function nextPuzzleAt(now: number = Date.now()): number {
  return Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;
}

/** Human countdown to the next puzzle, e.g. "4h 12m". */
export function timeUntilNextPuzzle(now: number = Date.now()): string {
  const ms = nextPuzzleAt(now) - now;
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
