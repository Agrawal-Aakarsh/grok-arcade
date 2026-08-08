/**
 * Serpent screen: loop, input, chrome.
 *
 * All game rules live in @x-arcade/shared; all board drawing lives in
 * ./render.ts. This file only owns timing, keys, and the frame around the
 * board — if a rule question arises it belongs in the engine, where it is
 * deterministic and testable.
 *
 * The render loop is deliberately decoupled from the game tick. The game steps
 * every 130ms falling to 60ms; rendering at that rate locks every animation to
 * the snake's speed, so nothing can pulse, fade, or shake. A fixed 30fps render
 * with the game stepping on its own timer is what buys any sense of motion.
 */

import {
  compareRuns,
  createGame,
  puzzleNumber,
  resultOf,
  seedForDay,
  step,
  tickIntervalMs,
  tierOf,
  turn,
  type DailyConfig,
  type RunResult,
  type SerpentState,
} from "@x-arcade/shared";

import { centre, dim, reset } from "../term/ansi.js";
import { CellBuffer, stringWidth } from "../term/buffer.js";
import { onKey } from "../term/input.js";
import type { Screen } from "../term/screen.js";
import { toastFor, watchEvents } from "../events.js";
import { CELL_H, CELL_W, drawBig, mix, PALETTE as P, paintBoard, type BoardEffect } from "./render.js";

const RANKED_RUNS = 3;
const RENDER_MS = 33; // ~30fps
const COUNTDOWN_MS = 1500;
/**
 * Toasts persist until you press a key.
 *
 * They used to expire after 12s, which defeated the point: if you are mid-run
 * and do not glance over for twenty seconds, you miss the one thing the arcade
 * exists to tell you. It is a status indicator, not a transient alert — "you
 * switch when you are ready" only works if the signal waits for you.
 */
const TOAST_MS = Number.POSITIVE_INFINITY;

type Phase = "countdown" | "playing" | "dead";

interface Popup {
  x: number;
  y: number;
  at: number;
  text: string;
}

function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export interface SerpentOptions {
  screen: Screen;
  config: DailyConfig;
  day: string;
  existing: RunResult[];
  onRunComplete: (run: RunResult) => void;
}

export function playSerpent(options: SerpentOptions): Promise<void> {
  const { screen, config, day, existing, onRunComplete } = options;

  return new Promise<void>((resolve) => {
    const banked: RunResult[] = [...existing];
    let state: SerpentState = createGame(config);

    const boardW = state.maze.width * CELL_W;
    const boardH = state.maze.height * CELL_H;
    const panelW = boardW + 2;
    const panelH = boardH + 2;
    /** Panel rows plus a HUD row and one of padding. */
    const buf = new CellBuffer(panelW, panelH + 2, P.void);

    let phase: Phase = "countdown";
    let phaseAt = Date.now();
    let startedAt = Date.now();
    let rings: BoardEffect[] = [];
    let popups: Popup[] = [];
    let toast: { text: string; at: number } | null = null;

    let gameTimer: NodeJS.Timeout | undefined;
    let renderTimer: NodeJS.Timeout | undefined;

    const ranked = (): boolean => banked.length < RANKED_RUNS;
    const runNumber = (): number => Math.min(banked.length + 1, RANKED_RUNS);
    const best = (): RunResult | undefined => [...banked].sort(compareRuns)[0];

    /* ---------------------------------------------------------------- */
    /* Chrome                                                            */
    /* ---------------------------------------------------------------- */

    function paintChrome(now: number): void {
      buf.set(0, 0, { glyph: "╭", fg: P.frame, bg: P.void });
      buf.set(panelW - 1, 0, { glyph: "╮", fg: P.frame, bg: P.void });
      for (let x = 1; x < panelW - 1; x++) buf.set(x, 0, { glyph: "─", fg: P.frame, bg: P.void });

      if (toast && now - toast.at < TOAST_MS) {
        // No emoji here: ⚡ and — are East Asian Ambiguous width, so terminals
        // disagree on whether they take one column or two and the border stops
        // meeting. The block/box glyphs elsewhere are ambiguous too, but every
        // TUI relies on those rendering narrow.
        const label = ` ▸ ${toast.text} · Esc when you're done `;
        buf.text(Math.max(1, Math.floor((panelW - label.length) / 2)), 0, label, P.amber, { bold: true });
      } else {
        buf.text(2, 0, " SERPENT ", P.text, { bold: true });
        const right = ` ${state.maze.name} · #${puzzleNumber()} · ${day} `;
        buf.text(panelW - 2 - right.length, 0, right, P.faint);
      }

      for (let row = 1; row <= boardH; row++) {
        buf.set(0, row, { glyph: "│", fg: P.frame, bg: P.void });
        buf.set(panelW - 1, row, { glyph: "│", fg: P.frame, bg: P.void });
      }

      const bottom = panelH - 1;
      buf.set(0, bottom, { glyph: "╰", fg: P.frame, bg: P.void });
      buf.set(panelW - 1, bottom, { glyph: "╯", fg: P.frame, bg: P.void });
      for (let x = 1; x < panelW - 1; x++) buf.set(x, bottom, { glyph: "─", fg: P.frame, bg: P.void });

      // Speed as segments rather than a number: you feel a tier change, you
      // don't read one.
      const tier = tierOf(state);
      const segments = Array.from({ length: 8 }, (_, i) => (i <= tier ? "▰" : "▱")).join("");

      const hudRow = panelH;
      const b = best();
      buf.text(1, hudRow, "🍎", P.apple);
      buf.text(4, hudRow, String(state.apples).padStart(2), P.accent, { bold: true });
      buf.text(8, hudRow, segments, tier > 0 ? P.amber : P.faint);

      // `startedAt` marks when the countdown ends, so it sits in the future
      // while counting down — clamp rather than render a negative clock.
      const rightHud = `${ranked() ? `run ${runNumber()}/${RANKED_RUNS}` : "practice"}${
        b ? ` · best ${b.apples}` : ""
      } · ${clock(Math.max(0, Date.now() - startedAt))}`;
      buf.text(panelW - 1 - stringWidth(rightHud), hudRow, rightHud, P.faint);
    }

    function overlay(now: number): void {
      const midY = 1 + Math.floor(boardH / 2);

      if (phase === "countdown") {
        const elapsed = now - phaseAt;
        const label = elapsed < 400 ? "3" : elapsed < 800 ? "2" : elapsed < 1200 ? "1" : "GO";
        drawBig(buf, Math.floor(panelW / 2), midY - 5, label, label === "GO" ? P.accent : P.text);
        return;
      }
      if (phase !== "dead") return;

      const done = banked.length >= RANKED_RUNS;
      const title = done ? "  ALL RUNS DONE  " : "  DEAD  ";
      const detail = done
        ? `  best ${best()?.apples ?? 0} 🍎 today  `
        : `  ${state.apples} 🍎 · run ${banked.length}/${RANKED_RUNS}  `;
      const hint = done ? "  r practice · Esc menu  " : `  Enter → run ${banked.length + 1} · Esc menu  `;

      buf.textCentred(midY - 2, title, done ? P.accent : P.danger, { bold: true, bg: P.void });
      buf.textCentred(midY, detail, P.text, { bg: P.void });
      buf.textCentred(midY + 2, hint, P.faint, { bg: P.void });
    }

    function render(): void {
      const now = Date.now();

      if (screen.tooSmall) {
        // Don't fight a cramped window — say what's needed and redraw on resize.
        screen.render([
          "",
          centre(`${dim}x-arcade needs ${panelW + 2}×${panelH + 4} — this terminal is ${screen.cols}×${screen.rows}${reset}`, screen.cols),
          centre(`${dim}resize and it'll pick up automatically${reset}`, screen.cols),
        ]);
        return;
      }

      buf.clear();
      rings = rings.filter((r) => now - r.at < 300);
      popups = popups.filter((p) => now - p.at < 700);

      paintBoard(buf, state, {
        now,
        originX: 1,
        originY: 1,
        effects: rings,
        ...(phase === "dead" ? { dyingSince: phaseAt } : {}),
      });
      paintChrome(now);

      // Floating score popups ride above the board.
      for (const popup of popups) {
        const age = (now - popup.at) / 700;
        const y = 1 + Math.round(popup.y * CELL_H - age * 2.5);
        buf.text(
          Math.max(1, Math.min(panelW - 3, 1 + popup.x * CELL_W)),
          Math.max(1, y),
          popup.text,
          mix(P.amber, P.void, age * 0.75),
          { bold: true },
        );
      }

      overlay(now);

      let shake = 0;
      if (phase === "dead") {
        const age = now - phaseAt;
        if (age < 400) shake = Math.round(Math.sin(age / 26) * (1 - age / 400) * 2);
      }

      const margin = " ".repeat(Math.max(0, Math.floor((screen.cols - panelW) / 2) + shake));
      const hint =
        phase === "playing"
          ? `${dim}arrows / wasd / hjkl · r ${ranked() ? "end run" : "restart"} · Esc menu${reset}`
          : "";

      screen.render(["", ...buf.toLines().map((l) => margin + l), centre(hint, screen.cols)]);
    }

    /* ---------------------------------------------------------------- */
    /* Loop                                                              */
    /* ---------------------------------------------------------------- */

    function tick(): void {
      if (phase !== "playing") return;
      const before = state.apples;
      step(state);

      if (state.apples > before) {
        const head = state.snake[0]!;
        const at = Date.now();
        rings = [...rings, { kind: "ring" as const, x: head.x, y: head.y, at }].slice(-6);
        popups = [...popups, { x: head.x, y: head.y, at, text: "+1" }].slice(-6);
      }

      if (state.status === "dead") {
        endRun();
        return;
      }
      gameTimer = setTimeout(tick, tickIntervalMs(state));
    }

    function endRun(): void {
      clearTimeout(gameTimer);
      if (phase === "dead") return;
      phase = "dead";
      phaseAt = Date.now();
      if (ranked()) {
        banked.push(resultOf(state, Date.now() - startedAt));
        onRunComplete(banked[banked.length - 1]!);
      }
    }

    function beginRun(): void {
      clearTimeout(gameTimer);
      state = createGame(config);
      rings = [];
      popups = [];
      phase = "countdown";
      phaseAt = Date.now();
      startedAt = Date.now() + COUNTDOWN_MS;
      setTimeout(() => {
        if (phase !== "countdown") return;
        phase = "playing";
        startedAt = Date.now();
        tick();
      }, COUNTDOWN_MS);
    }

    const stopResize = screen.onResize(render);
    const stopEvents = watchEvents((event) => {
      toast = { text: toastFor(event), at: Date.now() };
    });

    const stopInput = onKey((key) => {
      // Any key dismisses the toast — it must never steal focus or block play.
      if (toast) toast = null;

      switch (key.type) {
        case "dir":
          if (phase === "playing") turn(state, key.dir);
          break;
        case "restart":
          if (phase === "dead") beginRun();
          else if (phase === "playing" && ranked()) endRun();
          else if (phase === "playing") beginRun();
          break;
        case "enter":
          if (phase === "dead") beginRun();
          break;
        case "escape":
          finish();
          break;
        case "quit":
          screen.restore();
          process.exit(0);
        // falls through — process.exit never returns
        default:
          break;
      }
    });

    function finish(): void {
      clearTimeout(gameTimer);
      clearInterval(renderTimer);
      stopInput();
      stopResize();
      stopEvents();
      resolve();
    }

    renderTimer = setInterval(render, RENDER_MS);
    beginRun();
    render();
  });
}

export { RANKED_RUNS };
export const dailyConfigFor = seedForDay;
