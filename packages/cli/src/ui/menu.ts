/**
 * The arcade menu. Two games, today's date, and what you've banked so far.
 */

import { compareRuns, puzzleNumber, timeUntilNextPuzzle, type RunResult } from "@x-arcade/shared";

import { bold, centre, dim, reset } from "../term/ansi.js";
import { onKey } from "../term/input.js";
import { MIN_COLS, MIN_ROWS, type Screen } from "../term/screen.js";
import { toastFor, watchEvents } from "../events.js";

export type MenuChoice = "serpent" | "golf" | "board" | "login" | "quit";

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
  handle?: string;
  /** False when the server was unreachable — play continues, unranked. */
  ranked?: boolean;
}

export function showMenu(options: MenuOptions): Promise<MenuChoice> {
  const { screen, day, serpentRuns, handle, ranked = true } = options;

  const best = [...serpentRuns].sort(compareRuns)[0];
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
      id: "golf",
      label: "Prompt Golf",
      status: `${dim}coming soon${reset}`,
      ready: false,
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
    const TOAST_MS = 12_000;
    let ticker: NodeJS.Timeout | undefined;

    const render = (): void => {
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
        showToast ? centre(`${bold}▸ ${toast!.text} · any key to dismiss${reset}`, width) : "",
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
