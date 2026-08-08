/**
 * Prompt Golf scoring.
 *
 * The jury compares your generated image against the target and returns a
 * fidelity score, 0-100. Length then multiplies it: a short prompt that gets
 * close beats a long one that gets slightly closer.
 *
 * There is deliberately **no pass/fail bar**. The first version gated on
 * clearing 70, and the first real playtest killed it — three faithful
 * recreations of the target scored 44, 52 and 55, so every one of them read as
 * a failure with nothing to show. A cliff edge turns a good attempt into a
 * blank, and the player cannot tell "nearly" from "nowhere near".
 *
 * Ranking on length alone is the opposite failure: the empty prompt wins. The
 * multiplier keeps both halves live — fidelity is the score, brevity is the
 * edge.
 */

/**
 * Prompt length where the multiplier is exactly 1.0 — the par a good attempt
 * should aim for. Shorter earns a bonus, longer pays.
 */
export const PAR_CHARS = 80;

/** Attempts per player per day. Also the cost ceiling, since we pay for these. */
export const ATTEMPTS_PER_DAY = 3;

/** Prompts longer than this are refused outright — golf, not an essay. */
export const MAX_PROMPT_CHARS = 320;

const MAX_MULTIPLIER = 1.25;
const MIN_MULTIPLIER = 0.5;

export interface GolfAttempt {
  prompt: string;
  /** Jury fidelity 0-100, or null while still being judged. */
  score: number | null;
}

/** Character count of a prompt. The "strokes" in the golf metaphor. */
export function strokesOf(prompt: string): number {
  return [...prompt].length;
}

/**
 * Length multiplier, 0.5x to 1.25x.
 *
 * Clamped at both ends on purpose: without a floor, a rambling prompt would
 * round to zero and every long attempt would tie at nothing; without a ceiling,
 * a one-character prompt would be worth 1.25x and brevity would dominate
 * fidelity entirely.
 */
export function multiplierFor(strokes: number): number {
  const raw = MAX_MULTIPLIER - strokes / (PAR_CHARS * 4);
  return Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, raw));
}

/** Final score: fidelity scaled by brevity. Higher is better. */
export function finalScore(juryScore: number | null, strokes: number): number | null {
  if (juryScore === null) return null;
  return Math.round(juryScore * multiplierFor(strokes) * 10) / 10;
}

export interface GolfCard {
  final: number;
  score: number;
  strokes: number;
  multiplier: number;
}

export function cardFor(attempt: GolfAttempt): GolfCard | null {
  if (attempt.score === null) return null;
  const strokes = strokesOf(attempt.prompt);
  return {
    final: finalScore(attempt.score, strokes)!,
    score: attempt.score,
    strokes,
    multiplier: Math.round(multiplierFor(strokes) * 100) / 100,
  };
}

/** Your best attempt of the day. */
export function cardOf(attempts: readonly GolfAttempt[]): GolfCard | null {
  const cards = attempts.map(cardFor).filter((c): c is GolfCard => c !== null);
  if (cards.length === 0) return null;
  return cards.reduce((a, b) => (a.final >= b.final ? a : b));
}

/** Leaderboard order: highest final score first, ties broken by fewer strokes. */
export function compareCards(a: GolfCard, b: GolfCard): number {
  return b.final - a.final || a.strokes - b.strokes;
}
