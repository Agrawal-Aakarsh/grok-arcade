/**
 * Raw ANSI primitives.
 *
 * No Ink, no blessed. Part 4 renders images via the Kitty graphics protocol,
 * which writes escape sequences directly to stdout at a specific cursor
 * position — a virtual-DOM reconciler redrawing around that will clobber the
 * image or fight it for placement. Owning the byte stream outright is less code
 * than working around a framework that assumes it owns the screen.
 */

export const ESC = "\x1b";
export const CSI = `${ESC}[`;

export const enterAltScreen = `${CSI}?1049h`;
export const leaveAltScreen = `${CSI}?1049l`;
export const hideCursor = `${CSI}?25l`;
export const showCursor = `${CSI}?25h`;
export const clearScreen = `${CSI}2J`;
export const home = `${CSI}H`;
/** Erase from the cursor to end of line — cheaper than padding every line. */
export const clearToEol = `${CSI}K`;
export const reset = `${CSI}0m`;
export const bold = `${CSI}1m`;
export const dim = `${CSI}2m`;

export function moveTo(col: number, row: number): string {
  return `${CSI}${row + 1};${col + 1}H`;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function fg({ r, g, b }: Rgb): string {
  return `${CSI}38;2;${r};${g};${b}m`;
}

export function bg({ r, g, b }: Rgb): string {
  return `${CSI}48;2;${r};${g};${b}m`;
}

/** Visible width, ignoring escape sequences. */
export function plainLength(text: string): number {
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").length;
}

export function centre(text: string, width: number): string {
  const pad = Math.max(0, Math.floor((width - plainLength(text)) / 2));
  return " ".repeat(pad) + text;
}
