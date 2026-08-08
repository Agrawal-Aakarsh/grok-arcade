/**
 * Keyboard decoding from a raw stdin stream.
 *
 * Terminals deliver keys as bytes, not events, so everything is a parse. The
 * one genuinely ambiguous case is bare Escape: `\x1b` is both the Escape key
 * and the first byte of every arrow-key sequence. We disambiguate on chunk
 * boundaries — a lone `\x1b` in its own chunk is the key, `\x1b[A` is an arrow.
 * That is reliable in practice because terminals emit escape sequences as a
 * single write, and it costs nothing when it is occasionally wrong (a dropped
 * Escape, never a spurious turn).
 */

import type { Dir } from "@x-arcade/shared";

export type Key =
  | { type: "dir"; dir: Dir }
  | { type: "enter" }
  | { type: "escape" }
  | { type: "quit" }
  | { type: "restart" }
  | { type: "char"; value: string };

const ARROWS: Record<string, Dir> = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
};

const LETTERS: Record<string, Dir> = {
  w: "up",
  a: "left",
  s: "down",
  d: "right",
  k: "up",
  h: "left",
  j: "down",
  l: "right",
};

export function decode(chunk: string): Key[] {
  const keys: Key[] = [];

  if (chunk === "\x1b") return [{ type: "escape" }];

  for (let i = 0; i < chunk.length; i++) {
    const ch = chunk[i]!;

    if (ch === "\x1b" && chunk[i + 1] === "[") {
      const code = chunk[i + 2];
      const dir = code ? ARROWS[code] : undefined;
      if (dir) keys.push({ type: "dir", dir });
      i += 2;
      continue;
    }

    // Ctrl-C must always kill the process, even mid-game. A game that swallows
    // it is a game the user cannot get out of.
    if (ch === "\x03") {
      keys.push({ type: "quit" });
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      keys.push({ type: "enter" });
      continue;
    }

    const lower = ch.toLowerCase();
    const dir = LETTERS[lower];
    if (dir) {
      keys.push({ type: "dir", dir });
      continue;
    }
    if (lower === "q") {
      keys.push({ type: "quit" });
      continue;
    }
    if (lower === "r") {
      keys.push({ type: "restart" });
      continue;
    }
    keys.push({ type: "char", value: ch });
  }

  return keys;
}

/** Subscribe to decoded keys. Returns an unsubscribe function. */
export function onKey(handler: (key: Key) => void): () => void {
  const listener = (data: Buffer): void => {
    for (const key of decode(data.toString("utf8"))) handler(key);
  };
  process.stdin.on("data", listener);
  return () => process.stdin.off("data", listener);
}
