/**
 * Today's board. Serpent shared ranks + local Breakout high scores.
 */

import { puzzleNumber, timeUntilNextPuzzle } from "@x-arcade/shared";

import { fetchLeaderboard, offlineSafe, type BreakoutEntry, type LeaderboardEntry } from "../api.js";
import { bold, centre, dim, reset } from "../term/ansi.js";
import { onKey } from "../term/input.js";
import type { Screen } from "../term/screen.js";

const MEDALS = ["🥇", "🥈", "🥉"];

export function showLeaderboard(screen: Screen, you?: string): Promise<void> {
  return new Promise<void>((resolve) => {
    let entries: LeaderboardEntry[] | null = null;
    let breakout: BreakoutEntry[] = [];
    let failed = false;

    const render = (): void => {
      const width = screen.cols;
      const lines: string[] = [
        "",
        "",
        centre(`${bold}TODAY'S BOARD${reset}`, width),
        centre(`${dim}Serpent #${puzzleNumber()} · next puzzle in ${timeUntilNextPuzzle()}${reset}`, width),
        "",
      ];

      if (entries === null && !failed) {
        lines.push(centre(`${dim}loading…${reset}`, width));
      } else if (failed) {
        lines.push(centre(`${dim}couldn't reach the server — your runs are saved locally${reset}`, width));
      } else if (entries!.length === 0) {
        lines.push(centre(`${dim}nobody has played Serpent today yet. be first.${reset}`, width));
      } else {
        entries!.forEach((entry, i) => {
          const medal = MEDALS[i] ?? `${String(i + 1).padStart(2)} `;
          const mine = entry.handle === you;
          const name = `@${entry.handle}`.padEnd(18);
          const score = `${String(entry.apples).padStart(3)} 🍎`;
          const detail = `${dim}${String(entry.ticks).padStart(5)} ticks · ${entry.runs}/3${reset}`;
          const row = `${medal} ${mine ? bold : ""}${name}${mine ? reset : ""} ${score}  ${detail}`;
          lines.push(centre(row, width - 8));
        });
      }

      lines.push("", centre(`${bold}BREAKOUT${reset}`, width), "");
      if (breakout.length === 0) {
        lines.push(centre(`${dim}nobody has played Breakout today yet. be first.${reset}`, width));
      } else {
        breakout.slice(0, 10).forEach((entry, i) => {
          const medal = MEDALS[i] ?? `${String(i + 1).padStart(2)} `;
          const mine = entry.handle === you;
          const name = `@${entry.handle}`.padEnd(18);
          const score = `${String(entry.score).padStart(6)} pts`;
          const detail = `${dim}L${entry.level} · ${entry.ticks} ticks${reset}`;
          lines.push(centre(`${medal} ${mine ? bold : ""}${name}${mine ? reset : ""} ${score}  ${detail}`, width - 8));
        });
      }

      lines.push("", "", centre(`${dim}Esc / q to go back${reset}`, width));
      screen.render(lines);
    };

    const stopResize = screen.onResize(render);
    const stop = onKey((key) => {
      if (key.type === "escape" || key.type === "quit") {
        stop();
        stopResize();
        resolve();
      }
    });

    render();
    void offlineSafe(() => fetchLeaderboard(15)).then((result) => {
      if (result) {
        entries = result.entries;
        breakout = result.breakout ?? [];
      } else failed = true;
      render();
    });
  });
}
