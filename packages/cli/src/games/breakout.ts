/**
 * Breakout screen: loop, input, chrome.
 *
 * Rules live in @x-arcade/shared breakout engine; this file owns timing, keys,
 * and ANSI rendering with coloured/symbol bricks.
 *
 * Display scales with the terminal: each logical game cell maps to scaleX×scaleY
 * character cells so the board fills landscape space as the window grows.
 */

import {
  advanceLevel,
  brickWorldX,
  brickWorldY,
  breakoutResultOf,
  breakoutTickIntervalMs,
  BRICK_VISUAL,
  BREAKOUT_BRICK_W as BRICK_W,
  BREAKOUT_FIELD_H as FIELD_H,
  BREAKOUT_FIELD_W as FIELD_W,
  BREAKOUT_LEVEL_COUNT as LEVEL_COUNT,
  compareBreakoutRuns,
  createBreakout,
  nudgePaddle,
  PADDLE_Y,
  POWERUP_CATALOG,
  POWERUP_TYPES,
  setPaddleDir,
  spaceAction,
  stepBreakout,
  type BreakoutRunResult,
  type BreakoutState,
  type BrickKind,
} from "@x-arcade/shared";

import { centre, dim, reset, type Rgb } from "../term/ansi.js";
import { CellBuffer, stringWidth } from "../term/buffer.js";
import { onKey } from "../term/input.js";
import type { Screen } from "../term/screen.js";
import { toastFor, watchEvents } from "../events.js";

const RENDER_MS = 16; // ~60fps paint for smoother ball motion
const TOAST_MS = Number.POSITIVE_INFINITY;
/** Arrow hold window — terminals emit no key-up; refresh while held via key-repeat. */
const HOLD_MS = 120;

/**
 * Cap display scale so bricks (2 logical cells) stay small.
 * At 2×, each brick is ~4 terminal columns — classic Breakout size.
 */
const MAX_SCALE_X = 2;
const MAX_SCALE_Y = 1.5;

const P = {
  void: { r: 9, g: 11, b: 16 } satisfies Rgb,
  field: { r: 14, g: 16, b: 24 } satisfies Rgb,
  frame: { r: 48, g: 54, b: 76 } satisfies Rgb,
  text: { r: 208, g: 216, b: 236 } satisfies Rgb,
  faint: { r: 106, g: 116, b: 144 } satisfies Rgb,
  accent: { r: 122, g: 255, b: 186 } satisfies Rgb,
  amber: { r: 255, g: 194, b: 96 } satisfies Rgb,
  danger: { r: 255, g: 92, b: 92 } satisfies Rgb,
  paddle: { r: 180, g: 220, b: 255 } satisfies Rgb,
  ball: { r: 255, g: 255, b: 255 } satisfies Rgb,
  laser: { r: 255, g: 80, b: 100 } satisfies Rgb,
};

type Phase = "playing" | "level_clear" | "game_over" | "won";

interface Layout {
  /** Display cells per logical X (may be fractional). */
  scaleX: number;
  /** Display cells per logical Y (may be fractional). */
  scaleY: number;
  /** Character width of the playfield (no border). */
  boardW: number;
  /** Character height of the playfield (no border). */
  boardH: number;
  /** Full panel including borders. */
  panelW: number;
  /** Full panel including borders (not HUD). */
  panelH: number;
  /** Buffer rows: panel + HUD. */
  bufH: number;
}

function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function brickStyle(kind: BrickKind): { g0: string; g1: string; fg: Rgb; bold?: boolean } {
  const v = BRICK_VISUAL[kind];
  return {
    g0: v.glyph[0] ?? "█",
    g1: v.glyph[1] ?? v.glyph[0] ?? "█",
    fg: v.fg,
    bold: kind === "gold" || kind === "hard",
  };
}

/**
 * Landscape layout that fills the terminal.
 * Scale is continuous so mid-size windows grow past 1× without sparse integer jumps.
 * Y scale is kept modest so bricks stay short (small tiles).
 */
export function computeLayout(cols: number, rows: number): Layout {
  // Leave room for outer padding + hint; panel needs L/R borders + bottom HUD.
  const maxBoardW = Math.max(FIELD_W, cols - 4);
  const maxBoardH = Math.max(FIELD_H, rows - 5);

  let scaleX = Math.min(MAX_SCALE_X, maxBoardW / FIELD_W);
  let scaleY = Math.min(MAX_SCALE_Y, maxBoardH / FIELD_H);
  // Keep landscape: Y must not outrun X (tall bricks look wrong).
  if (scaleY > scaleX * 0.65) scaleY = scaleX * 0.65;
  scaleX = Math.max(1, scaleX);
  scaleY = Math.max(1, scaleY);

  const boardW = Math.max(FIELD_W, Math.floor(FIELD_W * scaleX));
  const boardH = Math.max(FIELD_H, Math.floor(FIELD_H * scaleY));
  // Re-derive exact scale from rounded board so mapping is consistent.
  scaleX = boardW / FIELD_W;
  scaleY = boardH / FIELD_H;

  const panelW = boardW + 2;
  const panelH = boardH + 2;
  return { scaleX, scaleY, boardW, boardH, panelW, panelH, bufH: panelH + 1 };
}

function layoutFits(layout: Layout, cols: number, rows: number): boolean {
  return layout.panelW <= cols && layout.bufH + 1 <= rows;
}

export interface BreakoutOptions {
  screen: Screen;
  onRunComplete: (run: BreakoutRunResult) => void;
  existing?: BreakoutRunResult[];
}

export function playBreakout(options: BreakoutOptions): Promise<void> {
  const { screen, onRunComplete, existing = [] } = options;

  return new Promise<void>((resolve) => {
    let state: BreakoutState = createBreakout(1);
    let layout = computeLayout(screen.cols, screen.rows);
    let buf = new CellBuffer(layout.panelW, layout.bufH, P.void);

    let phase: Phase = "playing";
    let startedAt = Date.now();
    let toast: { text: string; at: number } | null = null;
    let statusNote = "Space to launch";
    let lastPowerName = "";
    let runSubmitted = false;
    let prevPowerUpCount = 0;
    /** H toggles in-game help (pauses sim while open). */
    let showHelp = false;

    let holdDir: -1 | 0 | 1 = 0;
    let holdUntil = 0;

    let gameTimer: NodeJS.Timeout | undefined;
    let renderTimer: NodeJS.Timeout | undefined;

    const banked: BreakoutRunResult[] = [...existing];
    const best = (): BreakoutRunResult | undefined => [...banked].sort(compareBreakoutRuns)[0];

    function ensureBuffer(): void {
      const next = computeLayout(screen.cols, screen.rows);
      if (next.panelW !== layout.panelW || next.bufH !== layout.bufH || next.boardW !== layout.boardW || next.boardH !== layout.boardH) {
        layout = next;
        buf = new CellBuffer(layout.panelW, layout.bufH, P.void);
      } else {
        layout = next; // keep scale floats in sync
      }
    }

    /** Logical game x → column inside board (0-based, border offset applied later). */
    function gx(x: number): number {
      return Math.floor(x * layout.scaleX);
    }
    function gy(y: number): number {
      return Math.floor(y * layout.scaleY);
    }
    /** Round for the ball so it doesn't flicker between cells at low speed. */
    function ballCell(x: number, y: number): { x: number; y: number } {
      return {
        x: Math.max(0, Math.min(layout.boardW - 1, Math.round(x * layout.scaleX - 1e-6))),
        y: Math.max(0, Math.min(layout.boardH - 1, Math.round(y * layout.scaleY - 1e-6))),
      };
    }
    /** Inclusive span of logical [x0, x1) in display columns. */
    function gSpanX(x0: number, x1: number): { x: number; w: number } {
      const a = gx(x0);
      const b = Math.max(a + 1, gx(x1));
      return { x: a, w: b - a };
    }
    function gSpanY(y0: number, y1: number): { y: number; h: number } {
      const a = gy(y0);
      const b = Math.max(a + 1, gy(y1));
      return { y: a, h: b - a };
    }

    function setField(x: number, y: number, cell: { glyph: string; fg: Rgb; bg: Rgb; bold?: boolean }): void {
      if (x < 0 || y < 0 || x >= layout.boardW || y >= layout.boardH) return;
      buf.set(1 + x, 1 + y, cell);
    }

    function paintBoard(): void {
      const { boardW, boardH } = layout;

      for (let y = 0; y < boardH; y++) {
        for (let x = 0; x < boardW; x++) {
          setField(x, y, { glyph: " ", fg: P.field, bg: P.field });
        }
      }

      // Bricks: 2-cell tiles. Cap display width so scale never makes them fat bars.
      const maxBrickDisplayW = 4;
      for (const brick of state.bricks) {
        if (!brick.alive) continue;
        const style = brickStyle(brick.kind);
        const lx = brickWorldX(brick.col);
        const ly = brickWorldY(brick.row);
        const { x: wx, w: rawW } = gSpanX(lx, lx + BRICK_W);
        const bw = Math.min(maxBrickDisplayW, Math.max(2, rawW));
        const wy = gy(ly);
        for (let dx = 0; dx < bw; dx++) {
          setField(wx + dx, wy, {
            glyph: dx % 2 === 0 ? style.g0 : style.g1,
            fg: style.fg,
            bg: style.fg, // solid mini-block (reads smaller than hollow stretch)
            ...(style.bold ? { bold: true } : {}),
          });
        }
      }

      // Power-ups: single letter glyph only (no multi-cell blob).
      for (const p of state.powerUps) {
        const cat = POWERUP_CATALOG[p.type];
        setField(gx(p.x), gy(p.y), {
          glyph: cat.glyph,
          fg: cat.color,
          bg: P.field,
          bold: true,
        });
      }

      // Lasers: single column tip.
      for (const shot of state.lasers) {
        setField(gx(shot.x), gy(shot.y), { glyph: "│", fg: P.laser, bg: P.field, bold: true });
      }

      // Paddle: single row (double-row looked like two paddles).
      const pad = gSpanX(state.paddleX, state.paddleX + state.paddleW);
      const py = gy(PADDLE_Y);
      const paddleFg = state.laser ? P.laser : state.sticky ? { r: 200, g: 160, b: 255 } : P.paddle;
      for (let i = 0; i < pad.w; i++) {
        const ch = i === 0 ? "◄" : i === pad.w - 1 ? "►" : "▬";
        setField(pad.x + i, py, { glyph: ch, fg: paddleFg, bg: P.field, bold: true });
      }

      // Ball: single cell, rounded coords (floor-flicker was the visual wobble).
      for (const ball of state.balls) {
        const c = ballCell(ball.x, ball.y);
        setField(c.x, c.y, {
          glyph: state.through ? "◉" : "●",
          fg: state.through ? P.amber : P.ball,
          bg: P.field,
          bold: true,
        });
      }
    }

    function paintChrome(now: number): void {
      const { panelW, panelH, boardH } = layout;

      buf.set(0, 0, { glyph: "╭", fg: P.frame, bg: P.void });
      buf.set(panelW - 1, 0, { glyph: "╮", fg: P.frame, bg: P.void });
      for (let x = 1; x < panelW - 1; x++) buf.set(x, 0, { glyph: "─", fg: P.frame, bg: P.void });

      if (toast && now - toast.at < TOAST_MS) {
        for (let x = 0; x < panelW; x++) {
          buf.set(x, 0, { glyph: " ", fg: P.void, bg: P.amber });
        }
        const label = `▸  ${toast.text.toUpperCase()}  ·  any key`;
        buf.text(Math.max(1, Math.floor((panelW - label.length) / 2)), 0, label, P.void, {
          bold: true,
          bg: P.amber,
        });
      } else {
        buf.text(2, 0, " BREAKOUT ", P.text, { bold: true });
        const sx = layout.scaleX.toFixed(1);
        const sy = layout.scaleY.toFixed(1);
        const right = ` ${state.level.name} · L${state.levelIndex}/${LEVEL_COUNT} · ${sx}×${sy} `;
        buf.text(Math.max(12, panelW - 2 - right.length), 0, right, P.faint);
      }

      for (let row = 1; row <= boardH; row++) {
        buf.set(0, row, { glyph: "│", fg: P.frame, bg: P.void });
        buf.set(panelW - 1, row, { glyph: "│", fg: P.frame, bg: P.void });
      }

      const bottom = panelH - 1;
      buf.set(0, bottom, { glyph: "╰", fg: P.frame, bg: P.void });
      buf.set(panelW - 1, bottom, { glyph: "╯", fg: P.frame, bg: P.void });
      for (let x = 1; x < panelW - 1; x++) buf.set(x, bottom, { glyph: "─", fg: P.frame, bg: P.void });

      const hudRow = panelH;
      const lives = "♥".repeat(Math.max(0, Math.min(9, state.lives)));
      buf.text(1, hudRow, lives || "·", state.lives > 0 ? P.danger : P.faint);
      buf.text(1 + Math.max(3, Math.min(9, state.lives) * 2) + 1, hudRow, String(state.score).padStart(6), P.accent, {
        bold: true,
      });

      const flags: string[] = [];
      if (state.laser) flags.push("LASER");
      if (state.sticky) flags.push("CATCH");
      if (state.through) flags.push("THRU");
      if (state.magnet) flags.push("MAG");
      if (state.speedScale < 0.95) flags.push("SLOW");
      if (state.speedScale > 1.05) flags.push("FAST");
      const flagStr = flags.length ? flags.join(" ") : lastPowerName;
      if (flagStr) buf.text(16, hudRow, flagStr.slice(0, 18), P.amber);

      const b = best();
      const rightHud = `${b ? `best ${b.score} · ` : ""}${clock(Math.max(0, now - startedAt))}`;
      buf.text(Math.max(1, panelW - 1 - stringWidth(rightHud)), hudRow, rightHud, P.faint);
    }

    function paintHelp(): void {
      const { panelW, boardH } = layout;
      // Dim the field so help text is readable.
      for (let y = 1; y <= boardH; y++) {
        for (let x = 1; x < panelW - 1; x++) {
          const under = { glyph: " ", fg: P.void, bg: { r: 8, g: 10, b: 16 } };
          buf.set(x, y, under);
        }
      }

      const lines: string[] = [
        "BREAKOUT · HELP",
        "",
        "CONTROLS",
        "  ← → / a d     move paddle",
        "  Space          release ball · shoot lasers (with L)",
        "  H              toggle this help (pauses)",
        "  r              restart run",
        "  Esc            back to menu",
        "  q              quit",
        "",
        "POWER-UPS  (catch falling letters)",
      ];
      for (const t of POWERUP_TYPES) {
        const p = POWERUP_CATALOG[t];
        lines.push(`  ${p.glyph}  ${p.name.padEnd(12)} ${p.description}`);
      }
      lines.push("", "  H / Esc to close");

      const startY = Math.max(1, Math.floor((boardH - lines.length) / 2) + 1);
      const left = Math.max(2, Math.floor((panelW - 48) / 2));
      lines.forEach((line, i) => {
        const y = startY + i;
        if (y < 1 || y > boardH) return;
        const isTitle = i === 0 || line === "CONTROLS" || line.startsWith("POWER");
        buf.text(left, y, line.slice(0, panelW - left - 2), isTitle ? P.accent : P.text, {
          bold: isTitle,
          bg: P.void,
        });
      });
    }

    function overlay(): void {
      if (showHelp) {
        paintHelp();
        return;
      }
      const midY = 1 + Math.floor(layout.boardH / 2);
      if (phase === "level_clear") {
        buf.textCentred(midY - 1, "  LEVEL CLEAR  ", P.accent, { bold: true, bg: P.void });
        buf.textCentred(midY + 1, `  score ${state.score} · Enter next  `, P.text, { bg: P.void });
        return;
      }
      if (phase === "won") {
        buf.textCentred(midY - 2, "  YOU WIN  ", P.accent, { bold: true, bg: P.void });
        buf.textCentred(midY, `  final ${state.score}  `, P.text, { bg: P.void });
        buf.textCentred(midY + 2, "  r replay · Esc menu  ", P.faint, { bg: P.void });
        return;
      }
      if (phase === "game_over") {
        buf.textCentred(midY - 2, "  GAME OVER  ", P.danger, { bold: true, bg: P.void });
        buf.textCentred(midY, `  score ${state.score} · level ${state.levelIndex}  `, P.text, { bg: P.void });
        buf.textCentred(midY + 2, "  r retry · Esc menu  ", P.faint, { bg: P.void });
      }
    }

    function render(): void {
      const now = Date.now();
      ensureBuffer();

      if (!layoutFits(layout, screen.cols, screen.rows) || layout.scaleX < 1) {
        const needW = FIELD_W + 4;
        const needH = FIELD_H + 5;
        screen.render([
          "",
          centre(
            `${dim}x-arcade Breakout needs ~${needW}×${needH} — this terminal is ${screen.cols}×${screen.rows}${reset}`,
            screen.cols,
          ),
          centre(`${dim}resize and it'll scale up automatically${reset}`, screen.cols),
        ]);
        return;
      }

      buf.clear();
      paintBoard();
      paintChrome(now);
      overlay();

      const margin = " ".repeat(Math.max(0, Math.floor((screen.cols - layout.panelW) / 2)));
      const topPad = Math.max(0, Math.floor((screen.rows - layout.bufH - 2) / 2));
      let hint = "";
      if (showHelp) {
        hint = `${dim}H / Esc close help${reset}`;
      } else if (phase === "playing") {
        if (state.awaitingRelease) {
          hint = `${dim}←→ paddle · Space release · H help · Esc menu${reset}`;
        } else if (state.laser) {
          hint = `${dim}←→ paddle · Space shoot · H help · Esc menu${reset}`;
        } else {
          hint = `${dim}←→ paddle · Space · H help · Esc menu${statusNote ? ` · ${statusNote}` : ""}${reset}`;
        }
      }

      const lines: string[] = [];
      for (let i = 0; i < topPad; i++) lines.push("");
      lines.push(...buf.toLines().map((l) => margin + l));
      lines.push(centre(hint, screen.cols));
      screen.render(lines);
    }

    function submitIfNeeded(): void {
      if (runSubmitted) return;
      if (phase !== "game_over" && phase !== "won") return;
      runSubmitted = true;
      const run = breakoutResultOf(state, Date.now() - startedAt);
      banked.push(run);
      onRunComplete(run);
    }

    function tick(): void {
      if (phase !== "playing") return;
      // Freeze sim while help is open.
      if (showHelp) {
        gameTimer = setTimeout(tick, breakoutTickIntervalMs(state));
        return;
      }

      if (holdDir !== 0 && Date.now() > holdUntil) {
        holdDir = 0;
        setPaddleDir(state, 0);
      } else if (holdDir !== 0) {
        setPaddleDir(state, holdDir);
      }

      const beforeLives = state.lives;
      const beforeFlags = `${state.laser}${state.sticky}${state.through}${state.magnet}${state.speedScale}`;
      stepBreakout(state);

      if (state.powerUps.length < prevPowerUpCount) {
        lastPowerName = "POWER!";
      }
      prevPowerUpCount = state.powerUps.length;

      const afterFlags = `${state.laser}${state.sticky}${state.through}${state.magnet}${state.speedScale}`;
      if (afterFlags !== beforeFlags) {
        if (state.laser) lastPowerName = "LASER";
        else if (state.sticky) lastPowerName = "CATCH";
        else if (state.through) lastPowerName = "THRU";
        else if (state.magnet) lastPowerName = "MAG";
        else if (state.speedScale < 0.95) lastPowerName = "SLOW";
        else if (state.speedScale > 1.05) lastPowerName = "FAST";
        else lastPowerName = "POWER!";
      }

      if (state.lives < beforeLives) statusNote = "ball lost";

      if (state.status === "level_clear") {
        phase = "level_clear";
        clearTimeout(gameTimer);
        return;
      }
      if (state.status === "game_over") {
        phase = "game_over";
        clearTimeout(gameTimer);
        submitIfNeeded();
        return;
      }
      if (state.status === "won") {
        phase = "won";
        clearTimeout(gameTimer);
        submitIfNeeded();
        return;
      }

      gameTimer = setTimeout(tick, breakoutTickIntervalMs(state));
    }

    function beginRun(): void {
      clearTimeout(gameTimer);
      state = createBreakout(1);
      phase = "playing";
      startedAt = Date.now();
      runSubmitted = false;
      lastPowerName = "";
      statusNote = "Space to launch";
      holdDir = 0;
      prevPowerUpCount = 0;
      setPaddleDir(state, 0);
      tick();
    }

    function goNextLevel(): void {
      if (state.levelIndex >= LEVEL_COUNT) {
        state.status = "won";
        phase = "won";
        submitIfNeeded();
        return;
      }
      advanceLevel(state);
      phase = "playing";
      statusNote = "Space to launch";
      holdDir = 0;
      setPaddleDir(state, 0);
      tick();
    }

    const stopResize = screen.onResize(render);
    const stopEvents = watchEvents((event) => {
      toast = { text: toastFor(event), at: Date.now() };
    });

    const stopInput = onKey((key) => {
      if (toast) toast = null;

      // H is decoded as dir:left (hjkl) with raw "h"/"H" — claim it for help first.
      if (key.type === "dir" && key.raw && key.raw.toLowerCase() === "h") {
        showHelp = !showHelp;
        return;
      }
      if (key.type === "char" && (key.value === "h" || key.value === "H" || key.value === "?")) {
        showHelp = !showHelp;
        return;
      }

      if (showHelp) {
        if (key.type === "escape" || key.type === "enter" || key.type === "quit") {
          if (key.type === "quit") {
            screen.restore();
            process.exit(0);
          }
          showHelp = false;
        }
        return;
      }

      switch (key.type) {
        case "dir":
          if (phase !== "playing") break;
          if (key.dir === "left" || key.dir === "right") {
            // Ignore vertical / hjkl leftovers except a/d and arrows (raw a/d or no raw).
            if (key.raw && key.raw.toLowerCase() !== "a" && key.raw.toLowerCase() !== "d") break;
            const d = key.dir === "left" ? -1 : 1;
            holdDir = d;
            holdUntil = Date.now() + HOLD_MS;
            setPaddleDir(state, d);
            nudgePaddle(state, d);
          }
          break;
        case "char":
          if (key.value === " " && phase === "playing") {
            const beforeHeld = state.balls.some((b) => b.held);
            const hadLaser = state.laser;
            spaceAction(state);
            if (beforeHeld) statusNote = "ball released";
            else if (hadLaser) statusNote = "pew!";
          }
          break;
        case "enter":
          if (phase === "level_clear") goNextLevel();
          else if (phase === "game_over" || phase === "won") beginRun();
          break;
        case "restart":
          if (phase === "playing" && state.score > 0 && !runSubmitted) {
            phase = "game_over";
            state.status = "game_over";
            submitIfNeeded();
          }
          beginRun();
          break;
        case "escape":
          if (phase === "playing" && state.score > 0 && !runSubmitted) {
            phase = "game_over";
            state.status = "game_over";
            submitIfNeeded();
          }
          finish();
          break;
        case "quit":
          screen.restore();
          process.exit(0);
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
