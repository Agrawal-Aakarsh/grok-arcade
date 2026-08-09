/**
 * Inline images: Kitty graphics protocol, with a half-block colour fallback.
 *
 * The client never decodes an image. It asks the server for either a resized
 * PNG (which Kitty accepts directly as f=100) or raw RGB24 at an exact
 * character-cell size (which the fallback turns into half-blocks). Kitty does
 * not accept JPEG, and xAI returns JPEG, so doing the conversion server-side is
 * what keeps an image codec out of a terminal game.
 */

import { bg, fg, moveTo, reset, type Rgb } from "./ansi.js";

const ESC = "\x1b";
/** Kitty's escape payload limit per chunk. */
const CHUNK = 4096;

export type ImageMode = "kitty" | "blocks";

/**
 * Detect Kitty graphics support.
 *
 * Deliberately env sniffing rather than the protocol's query-and-wait
 * handshake: the query requires reading a response off stdin with a timeout,
 * and getting that wrong hangs the game on startup on any terminal that stays
 * silent. A wrong guess here costs a downgrade to half-blocks, which is a
 * perfectly good picture — a hang costs the session.
 */
export function detectImageMode(): ImageMode {
  if (process.env["X_ARCADE_FORCE_BLOCKS"]) return "blocks";
  const program = (process.env["TERM_PROGRAM"] ?? "").toLowerCase();
  const term = (process.env["TERM"] ?? "").toLowerCase();
  const supported =
    term.includes("kitty") ||
    term.includes("ghostty") ||
    program.includes("ghostty") ||
    program.includes("wezterm") ||
    Boolean(process.env["KITTY_WINDOW_ID"]);
  return supported ? "kitty" : "blocks";
}

/** Split base64 into Kitty-sized chunks, flagging every one but the last. */
function chunks(payload: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < payload.length; i += CHUNK) out.push(payload.slice(i, i + CHUNK));
  return out;
}

export interface DrawOptions {
  /** Character cell to place the top-left corner at. */
  col: number;
  row: number;
  /** Size of the drawing area, in character cells. */
  cols: number;
  rows: number;
  /** Which slot this image occupies. See SLOT. */
  id?: number;
}

/**
 * Fixed image ids, one per thing we ever draw.
 *
 * Every image is transmitted with an explicit `i=<id>` so it can be deleted by
 * id later. Relying on the "delete everything" form (`a=d` with no target) left
 * the Golf target sitting on top of the menu after pressing Esc — a byte
 * capture cannot catch that, because it only proves what we *sent*, not what
 * the terminal did with it.
 */
export const SLOT = { target: 1001, attempt: 1002, ghost: 1003 } as const;

/**
 * Draw a PNG at a character-cell position via the Kitty protocol.
 *
 * `a=T` transmits and displays in one go; `f=100` says the payload is PNG;
 * `c`/`r` ask the terminal to scale it into that many cells. `q=2` suppresses
 * the terminal's acknowledgement — without it the replies land in stdin and get
 * decoded as keystrokes, which reads as the game pressing random keys.
 */
export function drawKittyPng(png: Buffer, options: DrawOptions): string {
  const parts = chunks(png.toString("base64"));
  let out = moveTo(options.col, options.row);
  parts.forEach((part, index) => {
    const first = index === 0;
    const more = index < parts.length - 1 ? 1 : 0;
    const control = first
      ? `a=T,f=100,i=${options.id ?? SLOT.target},c=${options.cols},r=${options.rows},q=2,m=${more}`
      : `m=${more}`;
    out += `${ESC}_G${control};${part}${ESC}\\`;
  });
  return out;
}

/**
 * Remove every image on screen.
 *
 * `d=A` rather than the default `d=a`: the lowercase form deletes placements
 * but keeps the image data alive in the terminal, and implementations differ on
 * whether a kept image can reappear. The uppercase form frees the data too,
 * which is what "get this off my screen" should mean.
 */
export function clearKittyImages(): string {
  // Belt and braces, in this order:
  //   d=I,i=<id>  delete that image and free its data — the reliable form
  //   d=A         delete every placement and its data
  //   d=a         same, older spelling some implementations only accept
  // Sending all three costs a few dozen bytes and removes any dependence on
  // which subset a given terminal implements.
  const byId = Object.values(SLOT)
    .map((id) => `${ESC}_Ga=d,d=I,i=${id},q=2${ESC}\\`)
    .join("");
  return `${byId}${ESC}_Ga=d,d=A,q=2${ESC}\\${ESC}_Ga=d,d=a,q=2${ESC}\\`;
}

/**
 * Render raw RGB24 as half-blocks: one character cell carries two vertical
 * pixels via `▀`, foreground for the top and background for the bottom.
 *
 * This is the same technique the first Serpent renderer used, and it is a much
 * better fallback than ASCII-by-luminance — it keeps full colour, so the
 * picture is still recognisably the target rather than a grey smudge.
 */
export function renderBlocks(rgb: Buffer, width: number, height: number): string[] {
  const at = (x: number, y: number): Rgb => {
    const i = (y * width + x) * 3;
    return { r: rgb[i] ?? 0, g: rgb[i + 1] ?? 0, b: rgb[i + 2] ?? 0 };
  };

  const lines: string[] = [];
  for (let y = 0; y + 1 < height; y += 2) {
    let line = "";
    let lastFg = "";
    let lastBg = "";
    for (let x = 0; x < width; x++) {
      const top = fg(at(x, y));
      const bottom = bg(at(x, y + 1));
      if (top !== lastFg) {
        line += top;
        lastFg = top;
      }
      if (bottom !== lastBg) {
        line += bottom;
        lastBg = bottom;
      }
      line += "▀";
    }
    lines.push(line + reset);
  }
  return lines;
}
