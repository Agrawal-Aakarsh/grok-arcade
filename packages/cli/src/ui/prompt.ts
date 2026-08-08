/**
 * Single-line text input.
 *
 * Deliberately does NOT go through term/input.ts. That decoder maps w/a/s/d and
 * h/j/k/l to directions, which is right for a game and catastrophic for a text
 * field — you could not type "@wasd" or in fact most handles. Text input reads
 * raw stdin itself.
 *
 * This is also the editor Prompt Golf will need in Part 4, so it is built to be
 * reusable rather than inlined into the login screen.
 */

import { bold, centre, dim, reset } from "../term/ansi.js";
import type { Screen } from "../term/screen.js";

export interface PromptOptions {
  screen: Screen;
  title: string;
  hint?: string;
  /** Rendered live under the field, e.g. a character counter. */
  status?: (value: string) => string;
  validate?: (value: string) => string | null;
  maxLength?: number;
  initial?: string;
}

/** Resolves with the entered string, or null if the user pressed Esc. */
export function promptLine(options: PromptOptions): Promise<string | null> {
  const { screen, title, hint, status, validate, maxLength = 64, initial = "" } = options;

  return new Promise<string | null>((resolve) => {
    let value = initial;
    let error: string | null = null;

    const render = (): void => {
      const width = screen.cols;
      const field = `${value}${bold}▏${reset}`;
      screen.render([
        "",
        "",
        centre(`${bold}${title}${reset}`, width),
        "",
        centre(`${dim}▸${reset} ${field}`, width),
        "",
        centre(error ? `${bold}${error}${reset}` : status ? `${dim}${status(value)}${reset}` : "", width),
        "",
        centre(`${dim}${hint ?? "Enter to confirm · Esc to cancel"}${reset}`, width),
      ]);
    };

    const finish = (result: string | null): void => {
      process.stdin.off("data", onData);
      stopResize();
      resolve(result);
    };

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");

      if (text === "\x1b") return finish(null);
      if (text === "\x03") {
        screen.restore();
        process.exit(0);
      }
      if (text === "\r" || text === "\n") {
        const problem = validate?.(value) ?? null;
        if (problem) {
          error = problem;
          render();
          return;
        }
        return finish(value);
      }
      // Backspace arrives as DEL (0x7f) on most terminals and BS (0x08) on some.
      if (text === "\x7f" || text === "\b") {
        value = value.slice(0, -1);
        error = null;
        render();
        return;
      }
      // Ignore any other escape sequence (arrows, function keys) rather than
      // letting its raw bytes land in the field as garbage.
      if (text.startsWith("\x1b")) return;

      const printable = [...text].filter((ch) => ch >= " " && ch !== "\x7f").join("");
      if (!printable) return;
      value = (value + printable).slice(0, maxLength);
      error = null;
      render();
    };

    const stopResize = screen.onResize(render);
    process.stdin.on("data", onData);
    render();
  });
}
