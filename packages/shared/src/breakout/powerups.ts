/**
 * Breakout power-up catalog — exactly 10 distinct classic-style effects.
 *
 * Drop chance and spawn live in the engine; this module owns type ids, symbols,
 * and pure apply helpers so each effect can be unit-tested in isolation.
 */

export type PowerUpType =
  | "multi" // multi-ball
  | "expand" // wider paddle
  | "shrink" // narrower paddle
  | "catch" // sticky paddle
  | "slow" // slow ball(s)
  | "fast" // fast ball(s)
  | "laser" // Space fires lasers
  | "life" // +1 life
  | "through" // ball pierces bricks
  | "magnet"; // pull falling power-ups toward paddle (score bonus on collect already)

export interface PowerUpCatalogEntry {
  readonly type: PowerUpType;
  readonly name: string;
  /** Single-char glyph shown while falling. */
  readonly glyph: string;
  readonly color: { r: number; g: number; b: number };
  readonly description: string;
}

export const POWERUP_TYPES: readonly PowerUpType[] = [
  "multi",
  "expand",
  "shrink",
  "catch",
  "slow",
  "fast",
  "laser",
  "life",
  "through",
  "magnet",
] as const;

export const POWERUP_COUNT = POWERUP_TYPES.length;

export const POWERUP_CATALOG: Record<PowerUpType, PowerUpCatalogEntry> = {
  multi: {
    type: "multi",
    name: "Multi-Ball",
    glyph: "M",
    color: { r: 120, g: 220, b: 255 },
    description: "Split into extra balls",
  },
  expand: {
    type: "expand",
    name: "Expand",
    glyph: "E",
    color: { r: 96, g: 255, b: 160 },
    description: "Widen the paddle",
  },
  shrink: {
    type: "shrink",
    name: "Shrink",
    glyph: "S",
    color: { r: 255, g: 100, b: 140 },
    description: "Narrow the paddle",
  },
  catch: {
    type: "catch",
    name: "Catch",
    glyph: "C",
    color: { r: 180, g: 140, b: 255 },
    description: "Sticky paddle holds the ball",
  },
  slow: {
    type: "slow",
    name: "Slow",
    glyph: "W",
    color: { r: 140, g: 200, b: 255 },
    description: "Slow the ball",
  },
  fast: {
    type: "fast",
    name: "Fast",
    glyph: "F",
    color: { r: 255, g: 180, b: 80 },
    description: "Speed up the ball",
  },
  laser: {
    type: "laser",
    name: "Laser",
    glyph: "L",
    color: { r: 255, g: 80, b: 100 },
    description: "Space fires lasers at bricks",
  },
  life: {
    type: "life",
    name: "1-Up",
    glyph: "P",
    color: { r: 120, g: 255, b: 140 },
    description: "Extra life",
  },
  through: {
    type: "through",
    name: "Through",
    glyph: "T",
    color: { r: 255, g: 240, b: 120 },
    description: "Ball pierces through bricks",
  },
  magnet: {
    type: "magnet",
    name: "Magnet",
    glyph: "G",
    color: { r: 200, g: 120, b: 255 },
    description: "Attract falling power-ups",
  },
};

/** Deterministic pick from brick position (no RNG dependency in pure tests). */
export function powerUpForBrick(col: number, row: number, levelIndex: number): PowerUpType {
  const i = (col * 7 + row * 13 + levelIndex * 3) % POWERUP_COUNT;
  return POWERUP_TYPES[i]!;
}
