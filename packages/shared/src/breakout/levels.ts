/**
 * Breakout level catalog — 10 levels with strictly increasing difficulty.
 *
 * High-resolution landscape field with many small bricks (2 cells wide).
 * CLI maps logical cells to the terminal; bricks stay compact at all scales.
 */

export type BrickKind =
  | "soft" // 1 hit
  | "medium" // 2 hits
  | "hard" // 3 hits
  | "steel" // unbreakable
  | "gold"; // 1 hit, high score

export interface BrickDef {
  kind: BrickKind;
  /** Column in brick grid (0..BRICK_COLS-1). */
  col: number;
  /** Row in brick grid (0..BRICK_ROWS-1). */
  row: number;
}

export interface LevelDef {
  readonly index: number; // 1-based
  readonly name: string;
  /** Base ball speed (cells per tick). Increases with level. */
  readonly ballSpeed: number;
  /** Score multiplier for bricks on this level. */
  readonly scoreMul: number;
  readonly bricks: readonly BrickDef[];
}

/**
 * High-res landscape: 60 bricks × 2 cells = 120 wide.
 * Each brick is only 2 game cells so it stays small even when the board scales.
 */
export const FIELD_W = 120;
export const FIELD_H = 30;

export const BRICK_COLS = 60;
export const BRICK_ROWS = 14;
export const BRICK_W = 2;
export const BRICK_H = 1;

export function hitsFor(kind: BrickKind): number {
  switch (kind) {
    case "soft":
      return 1;
    case "medium":
      return 2;
    case "hard":
      return 3;
    case "steel":
      return Infinity;
    case "gold":
      return 1;
  }
}

export function pointsFor(kind: BrickKind): number {
  switch (kind) {
    case "soft":
      return 10;
    case "medium":
      return 25;
    case "hard":
      return 50;
    case "steel":
      return 0;
    case "gold":
      return 100;
  }
}

export const BRICK_VISUAL: Record<
  BrickKind,
  { glyph: string; fg: { r: number; g: number; b: number }; label: string }
> = {
  soft: { glyph: "▒▒", fg: { r: 255, g: 92, b: 92 }, label: "soft" },
  medium: { glyph: "▓▓", fg: { r: 255, g: 164, b: 64 }, label: "medium" },
  hard: { glyph: "██", fg: { r: 255, g: 220, b: 72 }, label: "hard" },
  steel: { glyph: "##", fg: { r: 120, g: 132, b: 160 }, label: "steel" },
  gold: { glyph: "◆◆", fg: { r: 255, g: 214, b: 96 }, label: "gold" },
};

function row(r: number, pattern: Array<BrickKind | null>): BrickDef[] {
  const out: BrickDef[] = [];
  for (let c = 0; c < pattern.length; c++) {
    const kind = pattern[c];
    if (kind) out.push({ kind, col: c, row: r });
  }
  return out;
}

function fillRow(r: number, kind: BrickKind, cols = BRICK_COLS): BrickDef[] {
  return Array.from({ length: cols }, (_, col) => ({ kind, col, row: r }));
}

function alternating(r: number, a: BrickKind, b: BrickKind): BrickDef[] {
  return Array.from({ length: BRICK_COLS }, (_, col) => ({
    kind: col % 2 === 0 ? a : b,
    col,
    row: r,
  }));
}

/** Sparse: brick, gap, brick, gap… across the full width. */
function sparseRow(r: number, kind: BrickKind, gap = 1): BrickDef[] {
  const out: BrickDef[] = [];
  for (let col = 0; col < BRICK_COLS; col += gap + 1) {
    out.push({ kind, col, row: r });
  }
  return out;
}

/** Pairs with gaps: ##__##__… */
function pairGapRow(r: number, kind: BrickKind): BrickDef[] {
  const out: BrickDef[] = [];
  for (let col = 0; col < BRICK_COLS - 1; col += 4) {
    out.push({ kind, col, row: r });
    out.push({ kind, col: col + 1, row: r });
  }
  return out;
}

function steelRibRow(r: number, fill: BrickKind): BrickDef[] {
  return Array.from({ length: BRICK_COLS }, (_, col) => ({
    kind: col % 3 === 0 ? ("steel" as BrickKind) : fill,
    col,
    row: r,
  }));
}

export function difficultyOf(level: LevelDef): number {
  let hitSum = 0;
  let breakable = 0;
  for (const b of level.bricks) {
    if (b.kind === "steel") continue;
    breakable++;
    const h = hitsFor(b.kind);
    hitSum += Number.isFinite(h) ? h : 0;
  }
  return hitSum * 10 + level.ballSpeed * 100 + breakable * 2 + level.scoreMul;
}

const LEVELS: LevelDef[] = [
  {
    index: 1,
    name: "Warmup",
    ballSpeed: 0.12,
    scoreMul: 1,
    bricks: [...pairGapRow(2, "soft"), ...sparseRow(4, "soft", 2)],
  },
  {
    index: 2,
    name: "Row House",
    ballSpeed: 0.14,
    scoreMul: 1,
    bricks: [...fillRow(1, "soft"), ...fillRow(2, "soft"), ...fillRow(3, "soft")],
  },
  {
    index: 3,
    name: "Double Tap",
    ballSpeed: 0.15,
    scoreMul: 1,
    bricks: [
      ...fillRow(1, "medium"),
      ...fillRow(2, "soft"),
      ...fillRow(3, "soft"),
      ...fillRow(4, "soft"),
    ],
  },
  {
    index: 4,
    name: "Gilded",
    ballSpeed: 0.16,
    scoreMul: 1,
    bricks: [
      ...fillRow(0, "medium"),
      ...alternating(1, "medium", "soft"),
      ...fillRow(2, "soft"),
      ...alternating(3, "gold", "soft"),
      ...fillRow(4, "medium"),
    ],
  },
  {
    index: 5,
    name: "Triple Threat",
    ballSpeed: 0.18,
    scoreMul: 1,
    bricks: [
      ...fillRow(0, "hard"),
      ...fillRow(1, "medium"),
      ...fillRow(2, "medium"),
      ...fillRow(3, "soft"),
      ...fillRow(4, "soft"),
      ...fillRow(5, "soft"),
    ],
  },
  {
    index: 6,
    name: "Iron Curtain",
    ballSpeed: 0.2,
    scoreMul: 1,
    bricks: [
      ...fillRow(0, "hard"),
      ...fillRow(1, "hard"),
      ...steelRibRow(2, "medium"),
      ...fillRow(3, "medium"),
      ...fillRow(4, "medium"),
      ...fillRow(5, "soft"),
      ...fillRow(6, "soft"),
    ],
  },
  {
    index: 7,
    name: "Labyrinth",
    ballSpeed: 0.22,
    scoreMul: 1,
    bricks: [
      ...fillRow(0, "hard"),
      ...fillRow(1, "hard"),
      ...fillRow(2, "medium"),
      ...steelRibRow(3, "gold"),
      ...fillRow(4, "medium"),
      ...fillRow(5, "medium"),
      ...fillRow(6, "soft"),
      ...fillRow(7, "soft"),
    ],
  },
  {
    index: 8,
    name: "Fortress",
    ballSpeed: 0.24,
    scoreMul: 1,
    bricks: [
      ...fillRow(0, "hard"),
      ...fillRow(1, "hard"),
      ...fillRow(2, "hard"),
      ...fillRow(3, "medium"),
      ...steelRibRow(4, "hard"),
      ...fillRow(5, "medium"),
      ...fillRow(6, "hard"),
      ...fillRow(7, "medium"),
    ],
  },
  {
    index: 9,
    name: "Velocity",
    ballSpeed: 0.26,
    scoreMul: 1,
    bricks: [
      ...fillRow(0, "hard"),
      ...fillRow(1, "hard"),
      ...fillRow(2, "hard"),
      ...fillRow(3, "hard"),
      ...fillRow(4, "medium"),
      ...fillRow(5, "hard"),
      ...fillRow(6, "medium"),
      ...alternating(7, "gold", "hard"),
    ],
  },
  {
    index: 10,
    name: "Endgame",
    ballSpeed: 0.3,
    scoreMul: 1,
    bricks: [
      ...fillRow(0, "hard"),
      ...fillRow(1, "hard"),
      ...fillRow(2, "hard"),
      ...fillRow(3, "hard"),
      ...fillRow(4, "hard"),
      ...steelRibRow(5, "hard"),
      ...fillRow(6, "hard"),
      ...fillRow(7, "hard"),
      ...fillRow(8, "hard"),
    ],
  },
];

export const LEVEL_COUNT = LEVELS.length;

export function getLevel(index: number): LevelDef {
  const i = Math.max(1, Math.min(LEVEL_COUNT, Math.floor(index)));
  return LEVELS[i - 1]!;
}

export function allLevels(): readonly LevelDef[] {
  return LEVELS;
}
