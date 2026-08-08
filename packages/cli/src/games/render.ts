/**
 * Board renderer — quadrant subpixels.
 *
 * The first version drew one game cell as one half-block character. That is the
 * cheapest possible mapping and it looks it: every cell is an identical square,
 * so the snake reads as a chain of separate blocks rather than a body, and the
 * board occupies a tenth of the screen.
 *
 * Here each game cell is **two characters wide by one tall**, and each character
 * carries a 2x2 quadrant glyph — so a cell is a 4x2 subpixel mask. Two wins fall
 * out of that:
 *
 *   1. Size. A 40x20 board becomes 80x20 characters instead of 40x10, which is
 *      four times the screen area, and 2 chars wide by 1 tall is roughly square
 *      given a terminal cell's 1:2 aspect.
 *   2. Shape. With subpixels we can round the outside of every turn, taper the
 *      tail, and put a nose on the head — the snake becomes a continuous ribbon.
 *      That, not the cell count, is what stops it looking pixelated.
 *
 * The constraint to respect: a character cell holds exactly two colours, so a
 * mask is drawn in one colour over one background. Never try to fit three.
 */

import type { SerpentState } from "@x-arcade/shared";

import type { CellBuffer } from "../term/buffer.js";
import type { Rgb } from "../term/ansi.js";

/** Game cell footprint, in characters. */
export const CELL_W = 2;
export const CELL_H = 1;

/** Quadrant glyph for a 2x2 mask, indexed TL*8 + TR*4 + BL*2 + BR. */
const QUAD = [" ", "▗", "▖", "▄", "▝", "▐", "▞", "▟", "▘", "▚", "▌", "▙", "▀", "▜", "▛", "█"];

export const PALETTE = {
  void: { r: 9, g: 11, b: 16 },
  fieldA: { r: 17, g: 19, b: 27 },
  fieldB: { r: 21, g: 24, b: 33 },
  wall: { r: 44, g: 49, b: 68 },
  wallTop: { r: 72, g: 80, b: 106 },
  apple: { r: 255, g: 78, b: 82 },
  appleHot: { r: 255, g: 166, b: 130 },
  head: { r: 208, g: 255, b: 226 },
  bodyNear: { r: 76, g: 226, b: 144 },
  bodyFar: { r: 16, g: 92, b: 60 },
  frame: { r: 48, g: 54, b: 76 },
  text: { r: 208, g: 216, b: 236 },
  faint: { r: 106, g: 116, b: 144 },
  accent: { r: 122, g: 255, b: 186 },
  amber: { r: 255, g: 194, b: 96 },
  danger: { r: 255, g: 92, b: 92 },
  white: { r: 255, g: 255, b: 255 },
} satisfies Record<string, Rgb>;

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t));
  return {
    r: Math.round(a.r + (b.r - a.r) * k),
    g: Math.round(a.g + (b.g - a.g) * k),
    b: Math.round(a.b + (b.b - a.b) * k),
  };
}

/** A 4-wide, 2-tall subpixel mask for one game cell. */
type Mask = [boolean[], boolean[]];

function filled(): Mask {
  return [
    [true, true, true, true],
    [true, true, true, true],
  ];
}

const SOLID: Mask = filled();

/** A compact centred blob — the apple. */
const BLOB: Mask = [
  [false, true, true, false],
  [false, true, true, false],
];

interface Links {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/**
 * Round every corner of the cell that isn't held down by a neighbouring
 * segment. A straight run keeps all four (so the body stays continuous), a turn
 * loses its outside corner, and an end loses both corners on its free side.
 */
function roundedBody(links: Links, taper: boolean): Mask {
  const mask = filled();
  if (!links.left && !links.up) mask[0]![0] = false;
  if (!links.right && !links.up) mask[0]![3] = false;
  if (!links.left && !links.down) mask[1]![0] = false;
  if (!links.right && !links.down) mask[1]![3] = false;

  // The tail (and the head's nose) pulls in the whole free column, so the body
  // visibly narrows to a point instead of stopping at a blunt square edge.
  if (taper) {
    if (!links.left && links.right) for (const row of mask) row[0] = false;
    if (!links.right && links.left) for (const row of mask) row[3] = false;
  }
  return mask;
}

function linksBetween(from: { x: number; y: number }, to: { x: number; y: number } | undefined, into: Links): void {
  if (!to) return;
  if (to.x < from.x) into.left = true;
  if (to.x > from.x) into.right = true;
  if (to.y < from.y) into.up = true;
  if (to.y > from.y) into.down = true;
}

/** Write one game cell's mask into the buffer at character coordinates. */
function stamp(buf: CellBuffer, cx: number, cy: number, mask: Mask, colour: Rgb, background: Rgb): void {
  for (let half = 0; half < 2; half++) {
    const tl = mask[0]![half * 2] ? 8 : 0;
    const tr = mask[0]![half * 2 + 1] ? 4 : 0;
    const bl = mask[1]![half * 2] ? 2 : 0;
    const br = mask[1]![half * 2 + 1] ? 1 : 0;
    buf.set(cx + half, cy, { glyph: QUAD[tl + tr + bl + br]!, fg: colour, bg: background });
  }
}

export interface BoardEffect {
  kind: "ring";
  x: number;
  y: number;
  at: number;
}

export interface PaintOptions {
  now: number;
  originX: number;
  originY: number;
  effects: readonly BoardEffect[];
  /** Set while the death animation plays; drives the strobe. */
  dyingSince?: number;
}

export function paintBoard(buf: CellBuffer, state: SerpentState, opts: PaintOptions): void {
  const { maze } = state;
  const { now, originX, originY } = opts;

  // Index every snake segment so the per-cell lookup stays O(1).
  const segmentAt = new Map<number, number>();
  state.snake.forEach((seg, i) => segmentAt.set(seg.y * maze.width + seg.x, i));

  const pulse = (Math.sin(now / 180) + 1) / 2;
  const deathAge = opts.dyingSince === undefined ? -1 : (now - opts.dyingSince) / 420;
  const strobe = opts.dyingSince !== undefined && Math.floor((now - opts.dyingSince) / 60) % 2 === 0;

  for (let y = 0; y < maze.height; y++) {
    for (let x = 0; x < maze.width; x++) {
      const i = y * maze.width + x;
      const cx = originX + x * CELL_W;
      const cy = originY + y * CELL_H;

      let background: Rgb = (x + y) % 2 === 0 ? PALETTE.fieldA : PALETTE.fieldB;

      // Ring shockwave tints the field it passes over.
      for (const fx of opts.effects) {
        const age = (now - fx.at) / 260;
        if (age > 1) continue;
        const d = Math.hypot(x - fx.x, (y - fx.y) * 0.55);
        if (Math.abs(d - age * 5) < 0.8) background = mix(background, PALETTE.accent, (1 - age) * 0.5);
      }

      if (maze.walls[i]) {
        const openAbove = y > 0 && !maze.walls[i - maze.width];
        stamp(buf, cx, cy, SOLID, openAbove ? PALETTE.wallTop : PALETTE.wall, PALETTE.void);
        continue;
      }

      const segment = segmentAt.get(i);
      if (segment !== undefined) {
        const links: Links = { up: false, down: false, left: false, right: false };
        linksBetween(state.snake[segment]!, state.snake[segment - 1], links);
        linksBetween(state.snake[segment]!, state.snake[segment + 1], links);

        const isEnd = segment === 0 || segment === state.snake.length - 1;
        const t = state.snake.length > 1 ? segment / (state.snake.length - 1) : 0;
        let colour = segment === 0 ? PALETTE.head : mix(PALETTE.bodyNear, PALETTE.bodyFar, t);
        if (deathAge >= 0 && deathAge < 1) {
          colour = mix(colour, strobe ? PALETTE.white : PALETTE.danger, 1 - deathAge * 0.6);
        }
        stamp(buf, cx, cy, roundedBody(links, isEnd), colour, background);
        continue;
      }

      if (x === state.apple.x && y === state.apple.y) {
        stamp(buf, cx, cy, BLOB, mix(PALETTE.apple, PALETTE.appleHot, pulse), background);
        continue;
      }

      buf.set(cx, cy, { glyph: " ", fg: background, bg: background });
      buf.set(cx + 1, cy, { glyph: " ", fg: background, bg: background });
    }
  }
}

/** 3x5 bitmap digits, drawn at 4x2 characters per pixel so they read as large. */
const BIG: Record<string, string[]> = {
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["###", "..#", "###", "#..", "###"],
  "3": ["###", "..#", "###", "..#", "###"],
  G: ["###", "#..", "#.#", "#.#", "###"],
  O: ["###", "#.#", "#.#", "#.#", "###"],
};

const PX_W = 4;
const PX_H = 2;

export function drawBig(buf: CellBuffer, centreX: number, top: number, text: string, colour: Rgb): void {
  const glyphs = [...text].map((c) => BIG[c]).filter((g): g is string[] => Boolean(g));
  if (!glyphs.length) return;
  const glyphW = 3 * PX_W;
  const total = glyphs.length * glyphW + (glyphs.length - 1) * PX_W;

  let x = centreX - Math.floor(total / 2);
  for (const glyph of glyphs) {
    glyph.forEach((row, ry) => {
      [...row].forEach((px, rx) => {
        if (px !== "#") return;
        for (let dy = 0; dy < PX_H; dy++) {
          for (let dx = 0; dx < PX_W; dx++) {
            buf.set(x + rx * PX_W + dx, top + ry * PX_H + dy, { glyph: "█", fg: colour, bg: PALETTE.void });
          }
        }
      });
    });
    x += glyphW + PX_W;
  }
}
