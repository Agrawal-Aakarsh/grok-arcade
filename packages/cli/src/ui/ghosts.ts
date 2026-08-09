/**
 * Ghost gallery — everyone else's best card for today.
 *
 * This is the multiplayer. Prompts stay hidden until you've used your own
 * attempts; a 17-stroke prompt that cleared, seen beforehand, is just the answer.
 */

import { finalScore } from "@x-arcade/shared";

import { fetchImagePng, fetchImageRgb, type Ghost } from "../api.js";
import { bold, centre, dim, plainLength, reset } from "../term/ansi.js";
import { clearKittyImages, drawKittyPng, renderBlocks, SLOT, type ImageMode } from "../term/image.js";
import { onKey } from "../term/input.js";
import type { Screen } from "../term/screen.js";

const COLS = 30;
const ROWS = 15;

export interface GhostData {
  day: string;
  unlocked: boolean;
  ghosts: Ghost[];
}

export function showGhosts(
  screen: Screen,
  data: GhostData,
  mode: ImageMode,
  you?: string,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let index = 0;
    let png: Buffer | undefined;
    let rgb: Buffer | undefined;

    const ghosts = data.ghosts;

    async function loadCurrent(): Promise<void> {
      png = undefined;
      rgb = undefined;
      const ghost = ghosts[index];
      if (!ghost?.imageId) return render();
      try {
        if (mode === "kitty") png = await fetchImagePng(ghost.imageId, COLS * 8, ROWS * 16);
        else rgb = await fetchImageRgb(ghost.imageId, COLS, ROWS * 2);
      } catch {
        /* render text-only */
      }
      render();
    }

    function render(): void {
      const width = screen.cols;
      const ghost = ghosts[index];
      const margin = " ".repeat(Math.max(0, Math.floor((width - COLS) / 2)));

      const lines: string[] = ["", centre(`${bold}GHOSTS${reset}  ${dim}${data.day}${reset}`, width), ""];

      if (!ghosts.length) {
        lines.push("", centre(`${dim}nobody has played today yet — be first${reset}`, width));
      } else if (ghost) {
        const picture = rgb ? renderBlocks(rgb, COLS, ROWS * 2) : Array.from({ length: ROWS }, () => " ".repeat(COLS));
        for (const line of picture) lines.push(margin + line);

        const mine = ghost.handle === you;
        lines.push("");
        lines.push(
          centre(
            `${dim}#${ghost.rank}${reset} ${mine ? bold : ""}@${ghost.handle}${mine ? reset : ""}  ` +
              `${bold}${finalScore(ghost.score, ghost.strokes) ?? "-"}${reset} ${dim}· ${ghost.strokes} chars${reset}`,
            width,
          ),
        );
        lines.push("");
        lines.push(
          centre(
            ghost.prompt
              ? `${dim}"${ghost.prompt}"${reset}`
              : `${dim}prompt hidden until you've used your attempts${reset}`,
            width,
          ),
        );
      }

      lines.push("");
      lines.push(centre(`${dim}← → browse (${index + 1}/${Math.max(1, ghosts.length)}) · Esc back${reset}`, width));
      screen.render(lines);

      if (mode === "kitty") {
        let out = clearKittyImages();
        if (png) out += drawKittyPng(png, { col: plainLength(margin), row: 3, cols: COLS, rows: ROWS, id: SLOT.ghost });
        process.stdout.write(out);
      }
    }

    const stopResize = screen.onResize(render);
    const stop = onKey((key) => {
      if (key.type === "dir" && (key.dir === "left" || key.dir === "right") && ghosts.length) {
        index = (index + (key.dir === "right" ? 1 : -1) + ghosts.length) % ghosts.length;
        void loadCurrent();
        return;
      }
      if (key.type === "escape" || key.type === "quit") {
        stop();
        stopResize();
        if (mode === "kitty") process.stdout.write(clearKittyImages());
        resolve();
      }
    });

    void loadCurrent();
  });
}
