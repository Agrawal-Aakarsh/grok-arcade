/**
 * Breakout engine — pure, deterministic, no I/O.
 *
 * Clock lives at the play-loop boundary. Unit tests step frames with scripted
 * inputs and assert state transitions directly.
 */

import {
  BRICK_COLS,
  BRICK_H,
  BRICK_ROWS,
  BRICK_W,
  BRICK_VISUAL,
  FIELD_H,
  FIELD_W,
  getLevel,
  hitsFor,
  LEVEL_COUNT,
  pointsFor,
  type BrickKind,
  type LevelDef,
} from "./levels.js";
import {
  POWERUP_CATALOG,
  POWERUP_TYPES,
  powerUpForBrick,
  type PowerUpType,
} from "./powerups.js";

export type BreakoutStatus = "playing" | "level_clear" | "game_over" | "won";

export interface Brick {
  /** Current visual kind (may downgrade as multi-hit bricks take damage). */
  kind: BrickKind;
  /** Original kind — used for scoring so visual downgrades never change points. */
  baseKind: BrickKind;
  col: number;
  row: number;
  hits: number; // remaining; Infinity for steel
  alive: boolean;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Stuck to paddle until release. */
  held: boolean;
  /** Offset from paddle left when held. */
  holdOffset: number;
}

export interface FallingPowerUp {
  type: PowerUpType;
  x: number;
  y: number;
  vy: number;
}

export interface LaserShot {
  x: number;
  y: number;
  vy: number;
}

export interface BreakoutState {
  levelIndex: number; // 1-based
  level: LevelDef;
  bricks: Brick[];
  balls: Ball[];
  paddleX: number;
  paddleW: number;
  /** -1 left, 0 none, 1 right — held between steps. */
  paddleDir: number;
  score: number;
  lives: number;
  status: BreakoutStatus;
  ticks: number;
  /** Ball still on paddle at level start. */
  awaitingRelease: boolean;
  powerUps: FallingPowerUp[];
  lasers: LaserShot[];
  /** Active timed/state power-up flags. */
  sticky: boolean;
  laser: boolean;
  through: boolean;
  magnet: boolean;
  /** Speed scale applied to ball velocities (1 = normal). */
  speedScale: number;
  /** Bricks broken this run (for drop rate). */
  bricksBroken: number;
  /** Max lives cap. */
  maxLives: number;
}

export const PADDLE_Y = FIELD_H - 2;
export const PADDLE_BASE_W = 16;
export const PADDLE_MIN_W = 8;
export const PADDLE_MAX_W = 32;
/** Cells per tick while holding left/right — small for fluid motion. */
export const PADDLE_SPEED = 0.65;
export const START_LIVES = 3;
export const POWERUP_FALL_SPEED = 0.055;
export const LASER_SPEED = 0.22;
export const DROP_EVERY_N = 4; // every Nth broken brick may drop
/** One-shot nudge on keypress (small; hold drives continuous motion). */
export const PADDLE_NUDGE = 0.65;

const BRICK_ORIGIN_X = 0;
const BRICK_ORIGIN_Y = 2;

export function brickWorldX(col: number): number {
  return BRICK_ORIGIN_X + col * BRICK_W;
}

export function brickWorldY(row: number): number {
  return BRICK_ORIGIN_Y + row * BRICK_H;
}

function clampPaddle(state: BreakoutState): void {
  state.paddleX = Math.max(0, Math.min(FIELD_W - state.paddleW, state.paddleX));
}

function makeBallOnPaddle(state: BreakoutState): Ball {
  const offset = state.paddleW / 2;
  return {
    x: state.paddleX + offset,
    y: PADDLE_Y - 1,
    vx: 0,
    vy: 0,
    held: true,
    holdOffset: offset,
  };
}

function syncHeldBalls(state: BreakoutState): void {
  for (const ball of state.balls) {
    if (!ball.held) continue;
    ball.x = state.paddleX + ball.holdOffset;
    ball.y = PADDLE_Y - 1;
  }
}

/** Deterministic launch (no Math.random). */
function launchVelocityDet(level: LevelDef, scale: number, side: 1 | -1 = 1): { vx: number; vy: number } {
  const speed = level.ballSpeed * scale;
  const angle = -Math.PI / 3;
  return {
    vx: Math.abs(Math.cos(angle) * speed) * side,
    vy: Math.sin(angle) * speed,
  };
}

export function createBreakout(levelIndex = 1, lives = START_LIVES, score = 0): BreakoutState {
  const level = getLevel(levelIndex);
  const bricks: Brick[] = level.bricks.map((b) => ({
    kind: b.kind,
    baseKind: b.kind,
    col: b.col,
    row: b.row,
    hits: hitsFor(b.kind),
    alive: true,
  }));

  const state: BreakoutState = {
    levelIndex: level.index,
    level,
    bricks,
    balls: [],
    paddleX: (FIELD_W - PADDLE_BASE_W) / 2,
    paddleW: PADDLE_BASE_W,
    paddleDir: 0,
    score,
    lives,
    status: "playing",
    ticks: 0,
    awaitingRelease: true,
    powerUps: [],
    lasers: [],
    sticky: false,
    laser: false,
    through: false,
    magnet: false,
    speedScale: 1,
    bricksBroken: 0,
    maxLives: 9,
  };
  state.balls = [makeBallOnPaddle(state)];
  return state;
}

/** Set paddle movement direction for subsequent steps. */
export function setPaddleDir(state: BreakoutState, dir: -1 | 0 | 1): void {
  if (state.status !== "playing") return;
  state.paddleDir = dir;
}

/** Instant nudge (one keypress = a small step; hold uses PADDLE_SPEED). */
export function nudgePaddle(state: BreakoutState, dir: -1 | 1): void {
  if (state.status !== "playing") return;
  state.paddleX += dir * PADDLE_NUDGE;
  clampPaddle(state);
  syncHeldBalls(state);
}

export function releaseBall(state: BreakoutState): boolean {
  if (state.status !== "playing") return false;
  let released = false;
  for (const ball of state.balls) {
    if (!ball.held) continue;
    const side: 1 | -1 = ball.x < FIELD_W / 2 ? 1 : -1;
    const v = launchVelocityDet(state.level, state.speedScale, side);
    ball.vx = v.vx;
    ball.vy = v.vy;
    ball.held = false;
    released = true;
  }
  if (released) state.awaitingRelease = false;
  return released;
}

/** Space: release held balls, or fire lasers if laser power-up is active. */
export function spaceAction(state: BreakoutState): void {
  if (state.status !== "playing") return;
  const anyHeld = state.balls.some((b) => b.held);
  if (anyHeld) {
    releaseBall(state);
    return;
  }
  if (state.laser) fireLaser(state);
}

export function fireLaser(state: BreakoutState): void {
  if (state.status !== "playing" || !state.laser) return;
  // Two barrels at paddle ends.
  state.lasers.push(
    { x: state.paddleX + 0.5, y: PADDLE_Y - 1, vy: -LASER_SPEED },
    { x: state.paddleX + state.paddleW - 0.5, y: PADDLE_Y - 1, vy: -LASER_SPEED },
  );
  // Cap active shots.
  if (state.lasers.length > 12) state.lasers.splice(0, state.lasers.length - 12);
}

function breakableRemaining(state: BreakoutState): number {
  return state.bricks.filter((b) => b.alive && b.kind !== "steel").length;
}

function maybeDrop(state: BreakoutState, brick: Brick): void {
  state.bricksBroken++;
  if (state.bricksBroken % DROP_EVERY_N !== 0) return;
  const type = powerUpForBrick(brick.col, brick.row, state.levelIndex);
  state.powerUps.push({
    type,
    x: brickWorldX(brick.col) + BRICK_W / 2,
    y: brickWorldY(brick.row) + BRICK_H,
    vy: POWERUP_FALL_SPEED,
  });
}

function damageBrick(state: BreakoutState, brick: Brick): boolean {
  if (!brick.alive || brick.baseKind === "steel" || brick.kind === "steel") return false;
  if (Number.isFinite(brick.hits)) brick.hits -= 1;
  else return false;
  if (brick.hits <= 0) {
    brick.alive = false;
    // Score from baseKind — visual kind may already be soft after prior hits.
    state.score += pointsFor(brick.baseKind) * state.level.scoreMul;
    maybeDrop(state, brick);
    return true;
  }
  // Downgrade visual kind by remaining hits for partial damage (scoring unchanged).
  if (brick.hits === 2) brick.kind = "medium";
  else if (brick.hits === 1 && brick.baseKind !== "gold") brick.kind = "soft";
  return false;
}

function findBrickAt(state: BreakoutState, x: number, y: number): Brick | null {
  for (const b of state.bricks) {
    if (!b.alive) continue;
    const bx = brickWorldX(b.col);
    const by = brickWorldY(b.row);
    if (x >= bx && x < bx + BRICK_W && y >= by && y < by + BRICK_H) return b;
  }
  return null;
}

/** Keep a minimum |vx| so the ball never crawls nearly vertical (reads as a wobble). */
function stabilizeVelocity(ball: Ball, minSpeed: number): void {
  const minVx = Math.max(0.035, minSpeed * 0.28);
  if (Math.abs(ball.vx) < minVx) {
    ball.vx = minVx * (ball.vx < 0 ? -1 : 1);
  }
  // Re-normalize to preserve overall speed after the clamp.
  const sp = Math.hypot(ball.vx, ball.vy);
  if (sp > 1e-6 && minSpeed > 0) {
    const target = Math.max(sp, minSpeed * 0.85);
    const k = target / sp;
    ball.vx *= k;
    ball.vy *= k;
  }
}

function bounceBallOffBrick(ball: Ball, brick: Brick, prevX: number, prevY: number, minSpeed: number): void {
  const bx = brickWorldX(brick.col);
  const by = brickWorldY(brick.row);
  // Which side did we enter from? Prefer axis of greater penetration from previous pos.
  const enteredFromLeft = prevX < bx;
  const enteredFromRight = prevX >= bx + BRICK_W;
  const enteredFromTop = prevY < by;
  const enteredFromBottom = prevY >= by + BRICK_H;

  if (enteredFromLeft || enteredFromRight) {
    ball.vx = -ball.vx;
    ball.x = enteredFromLeft ? bx - 0.05 : bx + BRICK_W + 0.05;
  } else if (enteredFromTop || enteredFromBottom) {
    ball.vy = -ball.vy;
    ball.y = enteredFromTop ? by - 0.05 : by + BRICK_H + 0.05;
  } else {
    // Fallback: reverse the dominant axis only (avoids double-flip wobble).
    if (Math.abs(ball.vx) > Math.abs(ball.vy)) {
      ball.vx = -ball.vx;
      ball.x = prevX;
    } else {
      ball.vy = -ball.vy;
      ball.y = prevY;
    }
  }
  stabilizeVelocity(ball, minSpeed);
}

function moveBall(state: BreakoutState, ball: Ball): void {
  if (ball.held) return;

  const minSpeed = state.level.ballSpeed * state.speedScale;
  const prevX = ball.x;
  const prevY = ball.y;
  ball.x += ball.vx;
  ball.y += ball.vy;

  // Walls — push clear of the edge so the next tick cannot re-collide (wobble).
  if (ball.x <= 0) {
    ball.x = 0.08;
    ball.vx = Math.abs(ball.vx) || minSpeed * 0.5;
    stabilizeVelocity(ball, minSpeed);
  } else if (ball.x >= FIELD_W - 0.01) {
    ball.x = FIELD_W - 0.08;
    ball.vx = -(Math.abs(ball.vx) || minSpeed * 0.5);
    stabilizeVelocity(ball, minSpeed);
  }
  if (ball.y <= 0) {
    ball.y = 0.08;
    ball.vy = Math.abs(ball.vy) || minSpeed * 0.5;
    stabilizeVelocity(ball, minSpeed);
  }

  // Paddle (only while moving downward; place firmly above so we don't multi-hit)
  if (
    ball.vy > 0 &&
    ball.y >= PADDLE_Y - 0.45 &&
    ball.y <= PADDLE_Y + 0.35 &&
    ball.x >= state.paddleX - 0.15 &&
    ball.x <= state.paddleX + state.paddleW + 0.15
  ) {
    if (state.sticky) {
      ball.held = true;
      ball.holdOffset = Math.max(0, Math.min(state.paddleW, ball.x - state.paddleX));
      ball.vx = 0;
      ball.vy = 0;
      state.awaitingRelease = true;
    } else {
      // Angle by hit position on paddle; clamp so corners still have upward loft.
      const rel = Math.max(0, Math.min(1, (ball.x - state.paddleX) / state.paddleW));
      const angle = -Math.PI * (0.72 - rel * 0.44); // ~-130° … ~-50°
      const speed = Math.max(Math.hypot(ball.vx, ball.vy), minSpeed);
      ball.vx = Math.cos(angle) * speed;
      ball.vy = Math.sin(angle) * speed;
      if (ball.vy > 0) ball.vy = -Math.abs(ball.vy);
      ball.y = PADDLE_Y - 0.85;
      stabilizeVelocity(ball, minSpeed);
    }
  }

  // Bricks — one hit response per tick (no multi-sample double bounce)
  const brick =
    findBrickAt(state, ball.x, ball.y) ??
    findBrickAt(state, prevX, ball.y) ??
    findBrickAt(state, ball.x, prevY);
  if (brick) {
    if (brick.kind === "steel") {
      bounceBallOffBrick(ball, brick, prevX, prevY, minSpeed);
    } else if (state.through) {
      damageBrick(state, brick);
    } else {
      damageBrick(state, brick);
      bounceBallOffBrick(ball, brick, prevX, prevY, minSpeed);
    }
  }
}

function collectPowerUp(state: BreakoutState, type: PowerUpType): void {
  applyPowerUp(state, type);
}

/**
 * Apply a power-up effect. Exported so unit tests can exercise each type
 * without waiting for a random drop.
 */
export function applyPowerUp(state: BreakoutState, type: PowerUpType): void {
  switch (type) {
    case "multi": {
      const free = state.balls.filter((b) => !b.held);
      const source = free[0] ?? state.balls[0];
      if (!source) break;
      const clones: Ball[] = [
        {
          x: source.x,
          y: source.y,
          vx: -Math.abs(source.vx || state.level.ballSpeed) * 0.9,
          vy: source.vy || -state.level.ballSpeed,
          held: false,
          holdOffset: 0,
        },
        {
          x: source.x,
          y: source.y,
          vx: Math.abs(source.vx || state.level.ballSpeed) * 0.9,
          vy: source.vy || -state.level.ballSpeed,
          held: false,
          holdOffset: 0,
        },
      ];
      // If source was held, launch the clones free.
      if (source.held) {
        for (const c of clones) {
          const v = launchVelocityDet(state.level, state.speedScale, c.vx < 0 ? -1 : 1);
          c.vx = v.vx;
          c.vy = v.vy;
        }
      }
      state.balls.push(...clones);
      if (state.balls.length > 8) state.balls = state.balls.slice(0, 8);
      break;
    }
    case "expand":
      state.paddleW = Math.min(PADDLE_MAX_W, state.paddleW + 4);
      clampPaddle(state);
      break;
    case "shrink":
      state.paddleW = Math.max(PADDLE_MIN_W, state.paddleW - 3);
      clampPaddle(state);
      break;
    case "catch":
      state.sticky = true;
      break;
    case "slow":
      state.speedScale = Math.max(0.5, state.speedScale * 0.7);
      for (const b of state.balls) {
        if (b.held) continue;
        b.vx *= 0.7;
        b.vy *= 0.7;
      }
      break;
    case "fast":
      state.speedScale = Math.min(2, state.speedScale * 1.35);
      for (const b of state.balls) {
        if (b.held) continue;
        b.vx *= 1.35;
        b.vy *= 1.35;
      }
      break;
    case "laser":
      state.laser = true;
      break;
    case "life":
      state.lives = Math.min(state.maxLives, state.lives + 1);
      break;
    case "through":
      state.through = true;
      break;
    case "magnet":
      state.magnet = true;
      break;
  }
}

function advancePowerUps(state: BreakoutState): void {
  const next: FallingPowerUp[] = [];
  for (const p of state.powerUps) {
    if (state.magnet) {
      // Pull toward paddle center.
      const target = state.paddleX + state.paddleW / 2;
      p.x += (target - p.x) * 0.08;
    }
    p.y += p.vy;
    // Collect
    if (
      p.y >= PADDLE_Y - 0.5 &&
      p.y <= PADDLE_Y + 1 &&
      p.x >= state.paddleX - 0.5 &&
      p.x <= state.paddleX + state.paddleW + 0.5
    ) {
      collectPowerUp(state, p.type);
      continue;
    }
    if (p.y < FIELD_H) next.push(p);
  }
  state.powerUps = next;
}

function advanceLasers(state: BreakoutState): void {
  const next: LaserShot[] = [];
  for (const shot of state.lasers) {
    shot.y += shot.vy;
    if (shot.y < 0) continue;
    const brick = findBrickAt(state, shot.x, shot.y);
    if (brick) {
      if (brick.kind !== "steel") damageBrick(state, brick);
      continue; // shot consumed
    }
    next.push(shot);
  }
  state.lasers = next;
}

function loseLife(state: BreakoutState): void {
  state.lives -= 1;
  // Clear power-up flags that would be unfair to keep after a miss.
  state.sticky = false;
  state.laser = false;
  state.through = false;
  state.magnet = false;
  state.speedScale = 1;
  state.powerUps = [];
  state.lasers = [];
  state.paddleW = PADDLE_BASE_W;
  state.paddleX = (FIELD_W - state.paddleW) / 2;

  if (state.lives <= 0) {
    state.status = "game_over";
    state.balls = [];
    return;
  }
  state.balls = [makeBallOnPaddle(state)];
  state.awaitingRelease = true;
}

/** Advance one simulation tick. */
export function step(state: BreakoutState): void {
  if (state.status !== "playing") return;

  // Paddle motion
  if (state.paddleDir !== 0) {
    state.paddleX += state.paddleDir * PADDLE_SPEED;
    clampPaddle(state);
    syncHeldBalls(state);
  }

  for (const ball of state.balls) moveBall(state, ball);

  // Cull balls that fell off the bottom
  const before = state.balls.length;
  state.balls = state.balls.filter((b) => b.held || b.y < FIELD_H);
  if (state.balls.length === 0 && before > 0) {
    loseLife(state);
    state.ticks++;
    return;
  }

  advancePowerUps(state);
  advanceLasers(state);

  if (breakableRemaining(state) === 0) {
    state.status = "level_clear";
  }

  state.ticks++;
}

/** Load next level keeping score/lives; returns false if all 10 cleared (won). */
export function advanceLevel(state: BreakoutState): boolean {
  if (state.levelIndex >= LEVEL_COUNT) {
    state.status = "won";
    return false;
  }
  const next = createBreakout(state.levelIndex + 1, state.lives, state.score);
  // Mutate in place so callers keep the same reference.
  Object.assign(state, next);
  return true;
}

export function resultOf(state: BreakoutState, elapsedMs: number): BreakoutRunResult {
  return {
    score: state.score,
    level: state.levelIndex,
    lives: state.lives,
    ticks: state.ticks,
    elapsedMs,
    cleared: state.status === "won" || state.levelIndex > 1,
  };
}

export interface BreakoutRunResult {
  score: number;
  level: number;
  lives: number;
  ticks: number;
  elapsedMs: number;
  cleared: boolean;
}

/** Ranking: score desc, then level desc, then ticks asc. */
export function compareBreakoutRuns(a: BreakoutRunResult, b: BreakoutRunResult): number {
  return b.score - a.score || b.level - a.level || a.ticks - b.ticks;
}

export function tickIntervalMs(state: BreakoutState): number {
  // ~80–100 Hz sim with small per-tick deltas for fluid feel.
  return Math.max(10, 12 - Math.floor(state.levelIndex / 5));
}

// Re-exports for convenience
export {
  FIELD_W,
  FIELD_H,
  BRICK_COLS,
  BRICK_ROWS,
  BRICK_W,
  BRICK_H,
  BRICK_VISUAL,
  LEVEL_COUNT,
  getLevel,
  allLevels,
  difficultyOf,
  hitsFor,
  pointsFor,
  type BrickKind,
  type LevelDef,
} from "./levels.js";
export {
  POWERUP_CATALOG,
  POWERUP_TYPES,
  POWERUP_COUNT,
  powerUpForBrick,
  type PowerUpType,
} from "./powerups.js";
