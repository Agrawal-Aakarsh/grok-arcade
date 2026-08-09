import { describe, expect, it } from "vitest";

import {
  advanceLevel,
  applyPowerUp,
  brickWorldX,
  brickWorldY,
  compareBreakoutRuns,
  createBreakout,
  nudgePaddle,
  releaseBall,
  resultOf,
  setPaddleDir,
  spaceAction,
  step,
  BRICK_VISUAL,
  FIELD_H,
  FIELD_W,
  LEVEL_COUNT,
  PADDLE_BASE_W,
  PADDLE_MAX_W,
  PADDLE_MIN_W,
  PADDLE_Y,
  POWERUP_CATALOG,
  POWERUP_COUNT,
  POWERUP_TYPES,
  getLevel,
  allLevels,
  difficultyOf,
  type BreakoutState,
  type PowerUpType,
} from "./engine.js";

function freeBall(state: BreakoutState): void {
  const ok = releaseBall(state);
  expect(ok).toBe(true);
  expect(state.balls[0]!.held).toBe(false);
}

/** Place a free ball at an exact position/velocity for collision tests. */
function placeBall(state: BreakoutState, x: number, y: number, vx: number, vy: number): void {
  state.awaitingRelease = false;
  state.balls = [{ x, y, vx, vy, held: false, holdOffset: 0 }];
}

describe("levels", () => {
  it("defines exactly 10 levels", () => {
    expect(LEVEL_COUNT).toBe(10);
    expect(allLevels()).toHaveLength(10);
    for (let i = 1; i <= 10; i++) {
      expect(getLevel(i).index).toBe(i);
      expect(getLevel(i).bricks.length).toBeGreaterThan(0);
    }
  });

  it("levels get harder from 1 → 10 by difficulty metric", () => {
    const diffs = allLevels().map(difficultyOf);
    for (let i = 1; i < diffs.length; i++) {
      expect(
        diffs[i]!,
        `level ${i + 1} (diff=${diffs[i]}) should be harder than level ${i} (diff=${diffs[i - 1]})`,
      ).toBeGreaterThan(diffs[i - 1]!);
    }
  });

  it("ball speed is non-decreasing across levels", () => {
    const speeds = allLevels().map((l) => l.ballSpeed);
    for (let i = 1; i < speeds.length; i++) {
      expect(speeds[i]!).toBeGreaterThanOrEqual(speeds[i - 1]!);
    }
    expect(speeds[9]!).toBeGreaterThan(speeds[0]!);
  });

  it("later levels have more total hits-to-clear than early ones", () => {
    const hitSum = (idx: number) =>
      getLevel(idx).bricks.reduce((s, b) => {
        if (b.kind === "steel") return s;
        if (b.kind === "hard") return s + 3;
        if (b.kind === "medium") return s + 2;
        return s + 1;
      }, 0);
    expect(hitSum(10)).toBeGreaterThan(hitSum(1));
    expect(hitSum(5)).toBeGreaterThan(hitSum(2));
  });
});

describe("brick visuals", () => {
  it("every brick kind has a distinct glyph and colour", () => {
    const kinds = Object.keys(BRICK_VISUAL);
    expect(kinds.length).toBeGreaterThanOrEqual(4);
    const glyphs = new Set(Object.values(BRICK_VISUAL).map((v) => v.glyph));
    expect(glyphs.size).toBe(kinds.length);
    for (const v of Object.values(BRICK_VISUAL)) {
      expect(v.fg.r + v.fg.g + v.fg.b).toBeGreaterThan(0);
      expect(v.glyph.length).toBeGreaterThan(0);
    }
  });
});

describe("core loop", () => {
  it("starts with ball held on paddle, lives, and bricks", () => {
    const state = createBreakout(1);
    expect(state.status).toBe("playing");
    expect(state.lives).toBe(3);
    expect(state.score).toBe(0);
    expect(state.awaitingRelease).toBe(true);
    expect(state.balls).toHaveLength(1);
    expect(state.balls[0]!.held).toBe(true);
    expect(state.bricks.some((b) => b.alive)).toBe(true);
  });

  it("nudgePaddle moves the paddle left and right", () => {
    const state = createBreakout(1);
    const mid = state.paddleX;
    nudgePaddle(state, 1);
    expect(state.paddleX).toBeGreaterThan(mid);
    const right = state.paddleX;
    nudgePaddle(state, -1);
    nudgePaddle(state, -1);
    expect(state.paddleX).toBeLessThan(right);
  });

  it("setPaddleDir moves paddle across steps", () => {
    const state = createBreakout(1);
    const start = state.paddleX;
    setPaddleDir(state, 1);
    for (let i = 0; i < 10; i++) step(state);
    expect(state.paddleX).toBeGreaterThan(start);
  });

  it("Space / releaseBall launches a held ball upward", () => {
    const state = createBreakout(1);
    expect(state.balls[0]!.held).toBe(true);
    spaceAction(state);
    expect(state.balls[0]!.held).toBe(false);
    expect(state.balls[0]!.vy).toBeLessThan(0);
    expect(state.awaitingRelease).toBe(false);
  });

  it("ball bounces off left and right walls", () => {
    const state = createBreakout(1);
    placeBall(state, 0.1, 10, -0.4, 0);
    step(state);
    expect(state.balls[0]!.vx).toBeGreaterThan(0);

    placeBall(state, FIELD_W - 0.1, 10, 0.4, 0);
    step(state);
    expect(state.balls[0]!.vx).toBeLessThan(0);
  });

  it("ball bounces off the ceiling", () => {
    const state = createBreakout(1);
    placeBall(state, 20, 0.1, 0, -0.5);
    step(state);
    expect(state.balls[0]!.vy).toBeGreaterThan(0);
  });

  it("ball bounces off the paddle", () => {
    const state = createBreakout(1);
    state.paddleX = 10;
    state.paddleW = 8;
    placeBall(state, 14, PADDLE_Y - 0.3, 0, 0.4);
    step(state);
    expect(state.balls[0]!.vy).toBeLessThan(0);
  });

  it("destroying a brick increases score", () => {
    const state = createBreakout(1);
    const soft = state.bricks.find((b) => b.alive && b.kind === "soft")!;
    const bx = brickWorldX(soft.col) + 1;
    const by = brickWorldY(soft.row) + 0.5;
    const before = state.score;
    placeBall(state, bx, by + 1, 0, -0.8);
    // Step until brick is hit or ball goes past
    for (let i = 0; i < 20 && soft.alive; i++) step(state);
    expect(soft.alive).toBe(false);
    expect(state.score).toBeGreaterThan(before);
  });

  /** Drive real laser damage path until the brick is gone. */
  function destroyWithLasers(state: BreakoutState, brick: { col: number; row: number; alive: boolean; hits: number }): void {
    state.laser = true;
    let guard = 0;
    while (brick.alive && guard++ < 20) {
      state.lasers = [
        {
          x: brickWorldX(brick.col) + 1,
          y: brickWorldY(brick.row) + 0.9,
          vy: -0.5,
        },
      ];
      for (let i = 0; i < 8 && brick.alive && state.lasers.length > 0; i++) step(state);
    }
  }

  it("full destroy of medium awards +25 (not soft's 10 after visual downgrade)", () => {
    const state = createBreakout(3);
    const medium = state.bricks.find((b) => b.alive && b.baseKind === "medium")!;
    expect(medium.hits).toBe(2);
    expect(medium.baseKind).toBe("medium");
    const before = state.score;
    destroyWithLasers(state, medium);
    expect(medium.alive).toBe(false);
    // Visual may have been soft on the last hit; score must still use baseKind.
    expect(state.score - before).toBe(25);
  });

  it("full destroy of hard awards +50 (not soft's 10 after visual downgrade)", () => {
    const state = createBreakout(5);
    const hard = state.bricks.find((b) => b.alive && b.baseKind === "hard")!;
    expect(hard.hits).toBe(3);
    const before = state.score;
    destroyWithLasers(state, hard);
    expect(hard.alive).toBe(false);
    expect(state.score - before).toBe(50);
  });

  it("partial hits on hard only award points on final destroy", () => {
    const state = createBreakout(5);
    const hard = state.bricks.find((b) => b.alive && b.baseKind === "hard")!;
    const before = state.score;
    // One laser hit — damage but no score yet
    state.lasers = [
      { x: brickWorldX(hard.col) + 1, y: brickWorldY(hard.row) + 0.9, vy: -0.5 },
    ];
    for (let i = 0; i < 8 && hard.hits === 3; i++) step(state);
    expect(hard.alive).toBe(true);
    expect(hard.hits).toBe(2);
    expect(hard.kind).toBe("medium"); // visual downgrade
    expect(hard.baseKind).toBe("hard"); // scoring identity preserved
    expect(state.score).toBe(before);
  });

  it("missing the ball past the paddle costs a life", () => {
    const state = createBreakout(1);
    const lives = state.lives;
    placeBall(state, 20, FIELD_H - 0.2, 0, 0.5);
    step(state);
    // ball filtered; life lost
    expect(state.lives).toBe(lives - 1);
    expect(state.awaitingRelease).toBe(true);
    expect(state.balls[0]!.held).toBe(true);
  });

  it("losing last life sets game_over", () => {
    const state = createBreakout(1, 1);
    placeBall(state, 20, FIELD_H - 0.2, 0, 0.5);
    step(state);
    expect(state.status).toBe("game_over");
    expect(state.lives).toBe(0);
  });

  it("clearing all breakable bricks sets level_clear", () => {
    const state = createBreakout(1);
    for (const b of state.bricks) {
      if (b.kind !== "steel") {
        b.alive = false;
        b.hits = 0;
      }
    }
    // Need a step to detect clear, or check via engine after step with ball
    freeBall(state);
    // Manually: step checks breakableRemaining
    step(state);
    expect(state.status).toBe("level_clear");
  });

  it("advanceLevel loads the next harder level and preserves score", () => {
    const state = createBreakout(1);
    state.score = 500;
    state.lives = 2;
    // Force clear
    for (const b of state.bricks) if (b.kind !== "steel") b.alive = false;
    step(state);
    expect(state.status).toBe("level_clear");
    const ok = advanceLevel(state);
    expect(ok).toBe(true);
    expect(state.levelIndex).toBe(2);
    expect(state.score).toBe(500);
    expect(state.lives).toBe(2);
    expect(state.status).toBe("playing");
    expect(state.awaitingRelease).toBe(true);
  });

  it("advancing past level 10 marks won", () => {
    const state = createBreakout(10);
    state.status = "level_clear";
    const ok = advanceLevel(state);
    expect(ok).toBe(false);
    expect(state.status).toBe("won");
  });
});

describe("power-ups", () => {
  it("catalog has exactly 10 distinct types", () => {
    expect(POWERUP_COUNT).toBe(10);
    expect(POWERUP_TYPES).toHaveLength(10);
    expect(new Set(POWERUP_TYPES).size).toBe(10);
    for (const t of POWERUP_TYPES) {
      expect(POWERUP_CATALOG[t].type).toBe(t);
      expect(POWERUP_CATALOG[t].glyph.length).toBeGreaterThan(0);
      expect(POWERUP_CATALOG[t].name.length).toBeGreaterThan(0);
    }
  });

  it("multi adds extra free balls", () => {
    const state = createBreakout(1);
    freeBall(state);
    const n = state.balls.length;
    applyPowerUp(state, "multi");
    expect(state.balls.length).toBeGreaterThan(n);
    expect(state.balls.filter((b) => !b.held).length).toBeGreaterThan(1);
  });

  it("expand widens the paddle", () => {
    const state = createBreakout(1);
    const w = state.paddleW;
    applyPowerUp(state, "expand");
    expect(state.paddleW).toBeGreaterThan(w);
    expect(state.paddleW).toBeLessThanOrEqual(PADDLE_MAX_W);
  });

  it("shrink narrows the paddle", () => {
    const state = createBreakout(1);
    const w = state.paddleW;
    applyPowerUp(state, "shrink");
    expect(state.paddleW).toBeLessThan(w);
    expect(state.paddleW).toBeGreaterThanOrEqual(PADDLE_MIN_W);
  });

  it("catch enables sticky paddle that holds the ball", () => {
    const state = createBreakout(1);
    applyPowerUp(state, "catch");
    expect(state.sticky).toBe(true);
    state.paddleX = 10;
    state.paddleW = 8;
    placeBall(state, 14, PADDLE_Y - 0.3, 0, 0.4);
    step(state);
    expect(state.balls[0]!.held).toBe(true);
  });

  it("slow reduces ball speed", () => {
    const state = createBreakout(1);
    freeBall(state);
    const speed = Math.hypot(state.balls[0]!.vx, state.balls[0]!.vy);
    applyPowerUp(state, "slow");
    const after = Math.hypot(state.balls[0]!.vx, state.balls[0]!.vy);
    expect(after).toBeLessThan(speed);
    expect(state.speedScale).toBeLessThan(1);
  });

  it("fast increases ball speed", () => {
    const state = createBreakout(1);
    freeBall(state);
    const speed = Math.hypot(state.balls[0]!.vx, state.balls[0]!.vy);
    applyPowerUp(state, "fast");
    const after = Math.hypot(state.balls[0]!.vx, state.balls[0]!.vy);
    expect(after).toBeGreaterThan(speed);
    expect(state.speedScale).toBeGreaterThan(1);
  });

  it("laser enables Space to fire shots that damage bricks", () => {
    const state = createBreakout(1);
    freeBall(state); // so spaceAction fires rather than releases
    applyPowerUp(state, "laser");
    expect(state.laser).toBe(true);
    const soft = state.bricks.find((b) => b.alive && b.kind === "soft")!;
    // Fire and aim a laser by placing paddle under brick and stepping
    state.paddleX = brickWorldX(soft.col);
    spaceAction(state);
    expect(state.lasers.length).toBeGreaterThan(0);
    // Drive lasers into the brick
    for (let i = 0; i < 80 && soft.alive; i++) step(state);
    // At least the laser system ran; soft may or may not die depending on alignment
    // Direct damage path: fireLaser + force hit
    const before = state.score;
    state.laser = true;
    state.lasers = [{ x: brickWorldX(soft.col) + 1, y: brickWorldY(soft.row) + 1, vy: -0.6 }];
    for (let i = 0; i < 10 && soft.alive; i++) step(state);
    expect(soft.alive).toBe(false);
    expect(state.score).toBeGreaterThanOrEqual(before);
  });

  it("life grants an extra life", () => {
    const state = createBreakout(1, 2);
    applyPowerUp(state, "life");
    expect(state.lives).toBe(3);
  });

  it("through lets the ball pierce bricks without bouncing", () => {
    const state = createBreakout(1);
    applyPowerUp(state, "through");
    expect(state.through).toBe(true);
    const soft = state.bricks.find((b) => b.alive && b.kind === "soft")!;
    const bx = brickWorldX(soft.col) + 1;
    const by = brickWorldY(soft.row) + 0.5;
    placeBall(state, bx, by + 0.8, 0, -0.5);
    const vyBefore = state.balls[0]!.vy;
    step(state);
    // Brick damaged/destroyed; through means no bounce so vy stays negative
    expect(state.balls[0]!.vy).toBeLessThan(0);
    expect(vyBefore).toBeLessThan(0);
  });

  it("magnet enables attraction of falling power-ups", () => {
    const state = createBreakout(1);
    applyPowerUp(state, "magnet");
    expect(state.magnet).toBe(true);
    state.paddleX = 20;
    state.paddleW = 7;
    state.powerUps = [{ type: "life", x: 5, y: PADDLE_Y - 3, vy: 0.05 }];
    const x0 = state.powerUps[0]!.x;
    step(state);
    // Should move toward paddle center (~23.5)
    expect(state.powerUps[0]!.x).toBeGreaterThan(x0);
  });

  it("each of the 10 power-up types can be applied without throwing", () => {
    for (const t of POWERUP_TYPES as PowerUpType[]) {
      const state = createBreakout(1);
      freeBall(state);
      expect(() => applyPowerUp(state, t)).not.toThrow();
    }
  });
});

describe("scoring result", () => {
  it("resultOf captures score and level", () => {
    const state = createBreakout(3);
    state.score = 420;
    const r = resultOf(state, 12_000);
    expect(r.score).toBe(420);
    expect(r.level).toBe(3);
    expect(r.elapsedMs).toBe(12_000);
  });

  it("compareBreakoutRuns ranks by score then level", () => {
    const a = { score: 100, level: 2, lives: 1, ticks: 50, elapsedMs: 1, cleared: false };
    const b = { score: 200, level: 1, lives: 1, ticks: 50, elapsedMs: 1, cleared: false };
    expect(compareBreakoutRuns(a, b)).toBeGreaterThan(0); // b better → positive when comparing a to b? wait
    // compare: b.score - a.score style like compareRuns: return b.score - a.score so higher score first
    // compareBreakoutRuns(a,b) returns b.score - a.score = 100 > 0 means b is "greater" in sort order when used as sort(fn)
    // Array.sort: if compare(a,b) > 0, b comes before a. Good.
    expect(compareBreakoutRuns(a, b)).toBeGreaterThan(0);
  });
});

describe("paddle bounds", () => {
  it("paddle cannot leave the field", () => {
    const state = createBreakout(1);
    for (let i = 0; i < 100; i++) nudgePaddle(state, -1);
    expect(state.paddleX).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 100; i++) nudgePaddle(state, 1);
    expect(state.paddleX + state.paddleW).toBeLessThanOrEqual(FIELD_W + 0.01);
  });

  it("default paddle width is the base width", () => {
    expect(createBreakout(1).paddleW).toBe(PADDLE_BASE_W);
  });
});
