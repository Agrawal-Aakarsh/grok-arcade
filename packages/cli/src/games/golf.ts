/**
 * Prompt Golf.
 *
 * Recreate the day's target image with the shortest prompt that clears the bar.
 *
 * Rendering note: Kitty images persist on screen until explicitly deleted, and
 * a naive full-frame repaint paints spaces straight over them. So a full repaint
 * (which redraws images) only happens on a state change; the spinner rewrites a
 * single line in place. That is why there is no 30fps loop here as there is in
 * Serpent.
 */

import { finalScore, MAX_PROMPT_CHARS, PAR_CHARS, strokesOf } from "@x-arcade/shared";

import {
  fetchGhosts,
  fetchGolfDaily,
  fetchImagePng,
  fetchImageRgb,
  imageUrl,
  pollAttempt,
  submitAttempt,
  type GolfAttemptView,
  type GolfDailyView,
} from "../api.js";
import { bold, centre, dim, moveTo, plainLength, reset } from "../term/ansi.js";
import {
  clearKittyImages,
  detectImageMode,
  drawKittyPng,
  renderBlocks,
  type ImageMode,
} from "../term/image.js";
import { onKey } from "../term/input.js";
import type { Screen } from "../term/screen.js";
import { loadState } from "../store.js";
import { showGhosts } from "../ui/ghosts.js";

const POLL_MS = 2000;
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Target panel size in character cells. Cells are ~1:2, so 2:1 reads square. */
const IMG_COLS = 44;
const IMG_ROWS = 22;

type Phase = "loading" | "target" | "writing" | "working" | "result" | "error";

interface ImageData {
  png?: Buffer;
  rgb?: Buffer;
}

export interface GolfOptions {
  screen: Screen;
}

export async function playGolf({ screen }: GolfOptions): Promise<void> {
  const state = loadState();
  const identity =
    state.handle && state.deviceToken ? { handle: state.handle, token: state.deviceToken } : undefined;

  const mode: ImageMode = detectImageMode();
  let phase: Phase = "loading";
  let daily: GolfDailyView | null = null;
  let targetImage: ImageData = {};
  let attemptImage: ImageData = {};
  let draft = "";
  let current: GolfAttemptView | null = null;
  let message = "";
  let spinnerFrame = 0;
  let statusRow = 0;
  /**
   * Set the moment the player leaves.
   *
   * Kitty images persist until explicitly deleted, and every async path here —
   * the initial target load, the 2s attempt poll — ends in render(). Leaving
   * mid-load meant that pending callback resolved afterwards and painted the
   * target on top of the menu, which is exactly what it looks like: a
   * photograph sitting over the game list.
   */
  let finished = false;

  /** Fetch an image in whichever form this terminal can draw. */
  async function loadImage(imageId: string, cols: number, rows: number): Promise<ImageData> {
    if (mode === "kitty") {
      // Ask for roughly 8x16 device pixels per cell — enough that the terminal
      // is downscaling rather than stretching.
      return { png: await fetchImagePng(imageId, cols * 8, rows * 16) };
    }
    // Half-blocks pack two pixels into each cell vertically, so the pixel grid
    // is exactly cols wide and rows*2 tall.
    return { rgb: await fetchImageRgb(imageId, cols, rows * 2) };
  }

  function imageLines(image: ImageData, cols: number, rows: number): string[] {
    if (image.rgb) return renderBlocks(image.rgb, cols, rows * 2);
    // In Kitty mode the picture is drawn separately, over these blank rows.
    return Array.from({ length: rows }, () => " ".repeat(cols));
  }

  function strokeColour(count: number): string {
    if (count <= PAR_CHARS) return "\x1b[38;2;120;255;180m"; // green — under par
    if (count <= 160) return "\x1b[38;2;255;194;96m"; // amber
    return "\x1b[38;2;255;96;96m"; // red
  }

  function render(): void {
    if (finished) return;
    const width = screen.cols;
    const lines: string[] = [""];
    const attemptsUsed = daily?.attempts.length ?? 0;
    const allowed = daily?.attemptsAllowed ?? 3;

    lines.push(
      centre(
        `${bold}PROMPT GOLF${reset}  ${dim}shortest prompt that nails it wins · ${attemptsUsed}/${allowed} attempts${reset}`,
        width,
      ),
    );
    lines.push("");

    const showBoth = phase === "result" && current?.imageId;
    const cols = showBoth ? Math.floor(IMG_COLS / 2) - 1 : IMG_COLS;
    const rows = showBoth ? Math.floor(IMG_ROWS / 2) : IMG_ROWS;
    const margin = " ".repeat(Math.max(0, Math.floor((width - (showBoth ? cols * 2 + 3 : cols)) / 2)));

    if (phase === "loading") {
      lines.push("", centre(`${dim}fetching today's target…${reset}`, width));
    } else if (showBoth) {
      const left = imageLines(targetImage, cols, rows);
      const right = imageLines(attemptImage, cols, rows);
      lines.push(margin + `${dim}target${reset}`.padEnd(cols + 12) + `${dim}yours${reset}`);
      for (let i = 0; i < rows; i++) lines.push(margin + (left[i] ?? "") + "   " + (right[i] ?? ""));
    } else {
      for (const line of imageLines(targetImage, cols, rows)) lines.push(margin + line);
    }

    lines.push("");
    statusRow = lines.length;

    if (phase === "target") {
      const remaining = allowed - attemptsUsed;
      lines.push(
        centre(
          remaining > 0
            ? `${bold}Enter${reset} ${dim}to write a prompt · ${remaining} attempt${remaining === 1 ? "" : "s"} left${reset}`
            : `${dim}all attempts used${reset}`,
          width,
        ),
      );
    } else if (phase === "writing") {
      const count = strokesOf(draft);
      lines.push(centre(`${dim}▸${reset} ${draft}${bold}▏${reset}`, width));
      lines.push("");
      lines.push(
        centre(
          `${strokeColour(count)}${count}${reset}${dim} chars${reset}`,
          width,
        ),
      );
    } else if (phase === "working") {
      lines.push(centre(`${SPINNER[spinnerFrame % SPINNER.length]} ${dim}${workingLabel()}${reset}`, width));
    } else if (phase === "result" && current) {
      lines.push(...resultLines(width));
    } else if (phase === "error") {
      lines.push(centre(`${bold}${message}${reset}`, width));
    }

    lines.push("");
    lines.push(centre(footer(), width));

    screen.render(lines);

    // Images go on top of the blank rows the frame just laid down.
    if (mode === "kitty" && phase !== "loading") {
      const imageRow = 3;
      const imageCol = plainLength(margin);
      let out = clearKittyImages();
      if (targetImage.png) out += drawKittyPng(targetImage.png, { col: imageCol, row: imageRow, cols, rows });
      if (showBoth && attemptImage.png) {
        out += drawKittyPng(attemptImage.png, { col: imageCol + cols + 3, row: imageRow, cols, rows });
      }
      process.stdout.write(out);
    }
  }

  function workingLabel(): string {
    switch (current?.status) {
      case "generating":
        return "grok-imagine is drawing your prompt…";
      case "judging":
        return "the jury is comparing it to the target…";
      default:
        return "submitting…";
    }
  }

  function resultLines(width: number): string[] {
    if (!current) return [];
    if (current.status === "failed") {
      return [centre(`${bold}attempt failed${reset}`, width), "", centre(`${dim}${current.error ?? ""}${reset}`, width)];
    }
    // Just the number. The multiplier is the mechanism, not something the
    // player needs to reason about mid-round — showing the arithmetic made the
    // screen read like a spreadsheet.
    const final = finalScore(current.score, current.strokes);
    const verdict = `${bold}${final}${reset}  ${dim}·  ${current.strokes} chars${reset}`;
    const jury = current.jury;
    return [
      centre(verdict, width),
      "",
      centre(`${dim}"${current.prompt}"${reset}`, width),
      "",
      jury
        ? centre(
            `${dim}subject ${jury.breakdown.subject} · composition ${jury.breakdown.composition} · palette ${jury.breakdown.palette} · ${jury.votes} votes ±${jury.spread}${reset}`,
            width,
          )
        : "",
      jury?.comment ? centre(`${dim}${jury.comment}${reset}`, width) : "",
    ];
  }

  function footer(): string {
    if (phase === "writing") return `${dim}Enter submit · Esc cancel${reset}`;
    if (phase === "working") return `${dim}this takes 10-30s · Esc to leave it running${reset}`;
    const browse = mode === "blocks" && daily ? ` · o open in browser` : "";
    return `${dim}g ghosts${browse} · Esc menu${reset}`;
  }

  /** Repaint only the spinner line, so the images above it survive. */
  function tickSpinner(): void {
    if (finished) return;
    spinnerFrame++;
    process.stdout.write(
      moveTo(0, statusRow) +
        centre(`${SPINNER[spinnerFrame % SPINNER.length]} ${dim}${workingLabel()}${reset}`, screen.cols) +
        "\x1b[K",
    );
  }

  /* ── flow ─────────────────────────────────────────────────────────── */

  async function loadDaily(): Promise<void> {
    try {
      daily = await fetchGolfDaily(identity);
      targetImage = await loadImage(daily.imageId, IMG_COLS, IMG_ROWS);
      // Resuming: if the last attempt is still in flight, rejoin its poll
      // rather than pretending it never happened.
      const last = daily.attempts.at(-1);
      if (last && last.status !== "scored" && last.status !== "failed") {
        current = last;
        phase = "working";
        render();
        void watch(last.id);
        return;
      }
      phase = "target";
    } catch (error) {
      phase = "error";
      message = error instanceof Error ? error.message : "couldn't load today's target";
    }
    render();
  }

  async function watch(id: string): Promise<void> {
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      if (finished || !identity) return;
      try {
        current = await pollAttempt(identity, id);
      } catch {
        continue; // transient; keep polling
      }
      if (current.status === "scored" || current.status === "failed") break;
      render(); // status text changed (generating -> judging)
    }

    if (current?.imageId) {
      const cols = Math.floor(IMG_COLS / 2) - 1;
      const rows = Math.floor(IMG_ROWS / 2);
      try {
        attemptImage = await loadImage(current.imageId, cols, rows);
        targetImage = await loadImage(daily!.imageId, cols, rows);
      } catch {
        /* fall through to a text-only result */
      }
    }
    if (daily && current) daily.attempts = [...daily.attempts.filter((a) => a.id !== current!.id), current];
    phase = "result";
    render();
  }

  async function send(): Promise<void> {
    if (!identity) {
      phase = "error";
      message = "sign in first — `arcade login`";
      render();
      return;
    }
    const prompt = draft.trim();
    if (!prompt) return;

    phase = "working";
    current = null;
    render();
    try {
      const { id } = await submitAttempt(identity, prompt);
      draft = "";
      await watch(id);
    } catch (error) {
      phase = "error";
      message = error instanceof Error ? error.message : "submission failed";
      render();
    }
  }

  /* ── input ────────────────────────────────────────────────────────── */

  return new Promise<void>((resolve) => {
    const spinner = setInterval(() => {
      if (phase === "working") tickSpinner();
    }, 120);
    const stopResize = screen.onResize(render);

    const finish = (): void => {
      finished = true;
      clearInterval(spinner);
      stopInput();
      stopResize();
      if (mode === "kitty") process.stdout.write(clearKittyImages());
      resolve();
    };

    const stopInput = onKey((key) => {
      // The prompt editor needs raw characters, so it is handled before the
      // game-key mapping — otherwise "w" and "d" would steer instead of type.
      if (phase === "writing") {
        if (key.type === "escape") {
          phase = "target";
          draft = "";
          render();
          return;
        }
        if (key.type === "enter") {
          void send();
          return;
        }
        if (key.type === "char" && key.value === "\x7f") {
          draft = draft.slice(0, -1);
          render();
          return;
        }
        // `raw` and never the semantic key: "l" decodes to `right`, and mapping
        // that back guesses "d" — which silently typed "saidboat" for
        // "sailboat" until it showed up in a test.
        const typed = key.type === "char" ? key.value : "raw" in key ? (key.raw ?? "") : "";
        if (typed && typed >= " ") {
          draft = (draft + typed).slice(0, MAX_PROMPT_CHARS);
          render();
        }
        return;
      }

      switch (key.type) {
        case "enter":
          if (phase === "target" && (daily?.attempts.length ?? 0) < (daily?.attemptsAllowed ?? 3)) {
            phase = "writing";
            render();
          } else if (phase === "result") {
            phase = "target";
            render();
          }
          break;
        case "escape":
          if (phase === "result") {
            phase = "target";
            render();
          } else finish();
          break;
        case "quit":
          finish();
          break;
        case "char":
          if (key.value === "g") {
            void openGhosts();
          } else if (key.value === "o" && daily) {
            void openInBrowser(imageUrl(daily.imageId));
          }
          break;
        default:
          break;
      }
    });

    async function openGhosts(): Promise<void> {
      if (mode === "kitty") process.stdout.write(clearKittyImages());
      const data = await fetchGhosts(identity).catch(() => null);
      if (data) await showGhosts(screen, data, mode, identity?.handle);
      render();
    }

    void loadDaily();
  });
}

async function openInBrowser(url: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(opener, [url], { detached: true, stdio: "ignore" }).unref();
}
