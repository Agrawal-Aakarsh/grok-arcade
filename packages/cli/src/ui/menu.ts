/**
 * The arcade menu. Games, today's date, and what you've banked so far.
 */

import {
  compareBreakoutRuns,
  compareRuns,
  puzzleNumber,
  timeUntilNextPuzzle,
  type BreakoutRunResult,
  type RunResult,
} from "@x-arcade/shared";

import { bold, centre, dim, reset } from "../term/ansi.js";
import { stringWidth } from "../term/buffer.js";
import { onKey } from "../term/input.js";
import { MIN_COLS, MIN_ROWS, type Screen } from "../term/screen.js";
import { toastFor, watchEvents } from "../events.js";
import { clearKittyImages, detectImageMode } from "../term/image.js";

/**
 * A full-width amber bar. The toast is the one thing the arcade exists to
 * deliver, and as dim text among dim text it read as decoration — you have to
 * be able to catch it from the corner of your eye, mid-run, without looking
 * for it.
 */
function toastBar(text: string, width: number): string {
  const label = `  ▸  ${text.toUpperCase()}  ·  press any key  `;
  const pad = Math.max(0, width - stringWidth(label));
  const left = Math.floor(pad / 2);
  return `\x1b[48;2;255;186;74m\x1b[38;2;24;18;8m\x1b[1m${" ".repeat(left)}${label}${" ".repeat(pad - left)}${reset}`;
}

export type MenuChoice = "serpent" | "breakout" | "golf" | "board" | "login" | "quit";

interface Entry {
  id: MenuChoice;
  label: string;
  status: string;
  ready: boolean;
}

export interface MenuOptions {
  screen: Screen;
  day: string;
  serpentRuns: RunResult[];
  breakoutRuns?: BreakoutRunResult[];
  handle?: string;
  /** False when the server was unreachable — play continues, unranked. */
  ranked?: boolean;
}

export function showMenu(options: MenuOptions): Promise<MenuChoice> {
  const { screen, day, serpentRuns, breakoutRuns = [], handle, ranked = true } = options;

  const best = [...serpentRuns].sort(compareRuns)[0];
  const bestBreakout = [...breakoutRuns].sort(compareBreakoutRuns)[0];
  const entries: Entry[] = [
    {
      id: "serpent",
      label: "Serpent",
      status: best
        ? `${dim}best ${best.apples} 🍎 · ${serpentRuns.length}/3 runs${reset}`
        : `${dim}daily speedrun · not played${reset}`,
      ready: true,
    },
    {
      id: "breakout",
      label: "Breakout",
      status: bestBreakout
        ? `${dim}best ${bestBreakout.score} · L${bestBreakout.level} · ${breakoutRuns.length} run${breakoutRuns.length === 1 ? "" : "s"}${reset}`
        : `${dim}10 levels · power-ups · arrows + Space${reset}`,
      ready: true,
    },
    {
      id: "golf",
      label: "Prompt Golf",
      status: `${dim}shortest prompt wins${reset}`,
      ready: true,
    },
    {
      id: "board",
      label: "Leaderboard",
      status: `${dim}today's top runs${reset}`,
      ready: true,
    },
    {
      id: "login",
      label: handle ? "Change handle" : "Sign in",
      status: handle ? `${dim}@${handle}${reset}` : `${dim}claim your X handle to rank${reset}`,
      ready: true,
    },
  ];

  return new Promise<MenuChoice>((resolve) => {
    let cursor = 0;
    let note = "";
    // The menu watches for agent events too. Sitting on the menu is a perfectly
    // normal way to wait out a task, and a toast that only appeared inside a
    // game would silently miss that case.
    let toast: { text: string; at: number } | null = null;
    // Persists until dismissed — see the note in games/serpent.ts.
    const TOAST_MS = Number.POSITIVE_INFINITY;
    let ticker: NodeJS.Timeout | undefined;

    const render = (): void => {
      // Defensive: a Kitty image left behind by a game would otherwise sit on
      // top of the menu until something else happened to overwrite it.
      if (detectImageMode() === "kitty") process.stdout.write(clearKittyImages());
      if (screen.tooSmall) {
        screen.render([
          "",
          centre(
            `${dim}x-arcade needs ${MIN_COLS}×${MIN_ROWS} — this terminal is ${screen.cols}×${screen.rows}${reset}`,
            screen.cols,
          ),
          centre(`${dim}resize and it'll pick up automatically${reset}`, screen.cols),
        ]);
        return;
      }
      const width = screen.cols;
      const showToast = toast !== null && Date.now() - toast.at < TOAST_MS;
      const lines: string[] = [
        "",
        showToast ? toastBar(toast!.text, width) : "",
        centre(`${bold}X ARCADE${reset}`, width),
        centre(`${dim}#${puzzleNumber()} · ${day} · next puzzle in ${timeUntilNextPuzzle()}${reset}`, width),
        "",
        "",
      ];

      entries.forEach((entry, i) => {
        const selected = i === cursor;
        const marker = selected ? `${bold}❯${reset} ` : "  ";
        const name = selected ? `${bold}${entry.label}${reset}` : entry.ready ? entry.label : `${dim}${entry.label}${reset}`;
        lines.push(centre(`${marker}${name.padEnd(selected ? 22 : 20)}  ${entry.status}`, width - 12));
      });

      lines.push("", "");
      lines.push(centre(note || `${dim}↑↓ select · Enter play · q quit${reset}`, width));
      lines.push(
        "",
        centre(
          ranked
            ? handle
              ? `${dim}signed in as @${handle} — runs count${reset}`
              : `${dim}not signed in — runs are local only${reset}`
            : `${dim}offline — playing today's board unranked${reset}`,
          width,
        ),
      );

      screen.render(lines);
    };

    // Before the key handler — see the matching note in games/serpent.ts.
    const stopResize = screen.onResize(render);
    const stopEvents = watchEvents((event) => {
      toast = { text: toastFor(event), at: Date.now() };
      render();
    });
    // The menu is otherwise event-driven; without a slow tick an expiring toast
    // would stay on screen until the next keypress.
    ticker = setInterval(render, 1000);

    const teardown = (): void => {
      stopEvents();
      stopResize();
      clearInterval(ticker);
    };

    const stop = onKey((key) => {
      note = "";
      const dismissed = toast !== null;
      toast = null;
      switch (key.type) {
        case "dir":
          if (key.dir === "up") cursor = (cursor - 1 + entries.length) % entries.length;
          if (key.dir === "down") cursor = (cursor + 1) % entries.length;
          render();
          break;
        case "enter": {
          const entry = entries[cursor]!;
          if (!entry.ready) {
            note = `${dim}Prompt Golf lands in Part 3 — Serpent is live now.${reset}`;
            render();
            return;
          }
          stop();
          teardown();
          resolve(entry.id);
          break;
        }
        case "quit":
        case "escape":
          stop();
          teardown();
          resolve("quit");
          break;
        default:
          if (dismissed) render();
          break;
      }
    });

    render();
  });
}
