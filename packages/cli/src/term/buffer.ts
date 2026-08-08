/**
 * A 2D character buffer with per-cell colour.
 *
 * The first renderer built each line as a string directly, which made anything
 * layered impossible — you cannot splice a floating "+1" into a string that is
 * already full of escape sequences without counting invisible bytes. Compose
 * into a grid of cells, overlay freely, serialise once at the end.
 *
 * This is also what Part 4 needs: Kitty image placement has to know exactly
 * which character cells it owns, and text has to be drawable on top of them.
 */

import { bg, fg, reset, type Rgb } from "./ansi.js";

export interface Cell {
  glyph: string;
  fg: Rgb;
  bg: Rgb;
  bold?: boolean;
  /** Placeholder owned by the wide glyph to its left; emits nothing. */
  tail?: boolean;
}

/**
 * Does this character occupy two terminal columns?
 *
 * Emoji and CJK are double-width, and treating them as one column silently
 * shifts everything to their right by a column — centred text lands off-centre
 * and box borders stop meeting. Covers the ranges we actually use (emoji,
 * symbols, CJK); anything exotic degrades to a one-column assumption, which is
 * the same behaviour as not having this function at all.
 */
export function charWidth(ch: string): 1 | 2 {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x1100) return 1;
  return (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK radicals … Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
    (cp >= 0xfe30 && cp <= 0xfe6f) || // CJK compatibility forms
    (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) || // emoji: symbols & pictographs, emoticons
    (cp >= 0x1f680 && cp <= 0x1f6ff) || // transport & map
    (cp >= 0x1f900 && cp <= 0x1f9ff) || // supplemental symbols
    (cp >= 0x1fa70 && cp <= 0x1faff)
    ? 2
    : 1;
}

/** Rendered column count of a string. */
export function stringWidth(value: string): number {
  let total = 0;
  for (const ch of value) total += charWidth(ch);
  return total;
}

export class CellBuffer {
  private readonly cells: Cell[];

  constructor(
    readonly width: number,
    readonly height: number,
    private readonly blank: Rgb,
  ) {
    this.cells = new Array(width * height);
    this.clear();
  }

  clear(): void {
    for (let i = 0; i < this.cells.length; i++) {
      this.cells[i] = { glyph: " ", fg: this.blank, bg: this.blank };
    }
  }

  set(x: number, y: number, cell: Cell): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.cells[y * this.width + x] = cell;
  }

  /**
   * Draw text, preserving whatever background is already underneath. That is
   * what makes an overlay read as floating above the board rather than as a
   * hole punched through it.
   */
  text(x: number, y: number, value: string, colour: Rgb, opts: { bold?: boolean; bg?: Rgb } = {}): void {
    let col = x;
    for (const glyph of value) {
      const under = this.cells[y * this.width + col];
      const background = opts.bg ?? under?.bg ?? this.blank;
      this.set(col, y, {
        glyph,
        fg: colour,
        bg: background,
        ...(opts.bold === undefined ? {} : { bold: opts.bold }),
      });
      if (charWidth(glyph) === 2) {
        // Claim the column the terminal will paint over anyway, so nothing else
        // writes into it and the run-length serialiser skips it cleanly.
        this.set(col + 1, y, { glyph: "", fg: colour, bg: background, tail: true });
        col += 2;
      } else {
        col += 1;
      }
    }
  }

  /** Centre text on a row by rendered width, not code-point count. */
  textCentred(y: number, value: string, colour: Rgb, opts: { bold?: boolean; bg?: Rgb } = {}): void {
    this.text(Math.max(0, Math.floor((this.width - stringWidth(value)) / 2)), y, value, colour, opts);
  }

  /**
   * Serialise to styled lines, emitting a colour code only when it changes.
   * A naive version re-states fg+bg on all 42x12 cells every frame — roughly
   * 20KB per frame, which is visible stutter over SSH.
   */
  toLines(): string[] {
    const lines: string[] = [];
    for (let y = 0; y < this.height; y++) {
      let line = "";
      let lastFg = "";
      let lastBg = "";
      let lastBold = false;
      for (let x = 0; x < this.width; x++) {
        const cell = this.cells[y * this.width + x]!;
        // The terminal already advanced two columns for the wide glyph before
        // this one; emitting anything here would push the row out of alignment.
        if (cell.tail) continue;
        const f = fg(cell.fg);
        const b = bg(cell.bg);
        const wantBold = cell.bold === true;
        if (wantBold !== lastBold) {
          // Bold-off requires a full reset, which also clears colour, so both
          // are re-stated immediately after.
          line += wantBold ? "\x1b[1m" : reset;
          lastBold = wantBold;
          lastFg = "";
          lastBg = "";
        }
        if (f !== lastFg) {
          line += f;
          lastFg = f;
        }
        if (b !== lastBg) {
          line += b;
          lastBg = b;
        }
        line += cell.glyph;
      }
      lines.push(line + reset);
    }
    return lines;
  }
}
