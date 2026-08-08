/**
 * Screen ownership: alternate buffer, cursor, raw mode, teardown.
 *
 * The single rule here is that the terminal must be returned exactly as it was
 * found, on every exit path — clean quit, Ctrl-C, an uncaught throw, or a
 * SIGTERM. A game that leaves raw mode on and the cursor hidden leaves the
 * user's shell apparently broken, which is a far worse bug than anything on
 * screen. Hence `restore` being idempotent and wired to every signal.
 */

import {
  clearScreen,
  clearToEol,
  enterAltScreen,
  hideCursor,
  home,
  leaveAltScreen,
  reset,
  showCursor,
} from "./ansi.js";

/**
 * The board is 40 cells wide at two characters each, plus borders — 82 columns,
 * 22 rows, and a couple more for the HUD. Rather than refuse to launch below
 * this, screens render a "resize me" prompt and redraw when the window changes;
 * a game that exits on a small window is more annoying than one that waits.
 */
export const MIN_COLS = 84;
export const MIN_ROWS = 27;

export class Screen {
  private active = false;
  private readonly out = process.stdout;

  /**
   * `||` rather than `??` on purpose: some environments (CI, `script`, a few
   * multiplexers) report a size of 0 rather than undefined, and `??` would let
   * that through as a real measurement and refuse to launch on a fine terminal.
   * When we genuinely cannot measure, assume the minimum and let the player see
   * a cramped screen instead of an error.
   */
  get cols(): number {
    return this.out.columns || Number(process.env["COLUMNS"]) || MIN_COLS;
  }

  get rows(): number {
    return this.out.rows || Number(process.env["LINES"]) || MIN_ROWS;
  }

  get tooSmall(): boolean {
    return this.cols < MIN_COLS || this.rows < MIN_ROWS;
  }

  enter(): void {
    if (this.active) return;
    this.active = true;

    this.out.write(enterAltScreen + hideCursor + clearScreen + home);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();

    // Every abnormal exit path gets the terminal back. `exit` alone is not
    // enough: it does not fire on an unhandled signal.
    process.on("exit", this.restore);
    process.on("SIGINT", this.onSignal);
    process.on("SIGTERM", this.onSignal);
    process.on("uncaughtException", this.onFatal);
  }

  private readonly onSignal = (): void => {
    this.restore();
    process.exit(130);
  };

  private readonly onFatal = (error: unknown): void => {
    this.restore();
    console.error(error);
    process.exit(1);
  };

  readonly restore = (): void => {
    if (!this.active) return;
    this.active = false;
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    this.out.write(reset + showCursor + leaveAltScreen);
  };

  /**
   * Paint a whole frame in one write.
   *
   * Rendering cell-by-cell makes the snake visibly tear as the terminal draws a
   * partial frame. One string, one syscall, no tearing.
   */
  render(lines: string[]): void {
    const frame = home + lines.map((line) => line + clearToEol).join("\n") + reset;
    this.out.write(frame);
  }

  onResize(handler: () => void): () => void {
    this.out.on("resize", handler);
    return () => this.out.off("resize", handler);
  }
}
