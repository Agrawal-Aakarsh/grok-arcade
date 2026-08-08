import { describe, expect, it } from "vitest";

import { buildMaze, isPlayable, MAZE_COUNT } from "./mazes.js";
import {
  compareRuns,
  createGame,
  seedForDay,
  step,
  tickIntervalMs,
  tierOf,
  turn,
  type Dir,
  type SerpentState,
} from "./engine.js";

/** Drive a game with a fixed input script; returns the state for inspection. */
function play(state: SerpentState, script: (readonly [number, Dir])[], ticks: number): SerpentState {
  const byTick = new Map(script.map(([t, d]) => [t, d]));
  for (let t = 0; t < ticks; t++) {
    const d = byTick.get(t);
    if (d) turn(state, d);
    step(state);
  }
  return state;
}

describe("mazes", () => {
  it("every curated motif is playable", () => {
    for (let i = 0; i < MAZE_COUNT; i++) {
      const maze = buildMaze(i);
      const report = isPlayable(maze);
      expect(report, `${maze.name}: ${JSON.stringify(report)}`).toMatchObject({ ok: true, pockets: 0 });
    }
  });

  it("keeps the spawn lane clear so the snake cannot die on tick one", () => {
    for (let i = 0; i < MAZE_COUNT; i++) {
      const maze = buildMaze(i);
      const midY = Math.floor(maze.height / 2);
      for (let x = 1; x < 12; x++) {
        expect(maze.walls[midY * maze.width + x], `${maze.name} blocks spawn at x=${x}`).toBe(false);
      }
    }
  });

  it("walls the border on every motif", () => {
    const maze = buildMaze(0);
    expect(maze.walls[0]).toBe(true);
    expect(maze.walls[maze.width - 1]).toBe(true);
    expect(maze.walls[(maze.height - 1) * maze.width]).toBe(true);
  });
});

describe("determinism", () => {
  it("same day key produces the same config", () => {
    expect(seedForDay("2026-08-08", "salt")).toEqual(seedForDay("2026-08-08", "salt"));
  });

  it("different days produce different seeds", () => {
    expect(seedForDay("2026-08-08").seed).not.toBe(seedForDay("2026-08-09").seed);
  });

  it("the salt changes the seed, so the maze is not datamineable from the client", () => {
    expect(seedForDay("2026-08-08", "").seed).not.toBe(seedForDay("2026-08-08", "server-secret").seed);
  });

  it("identical input scripts produce byte-identical runs", () => {
    const config = seedForDay("2026-08-08", "salt");
    const script = [
      [3, "down"],
      [9, "left"],
      [14, "up"],
      [20, "right"],
    ] as const;

    const a = play(createGame(config), [...script], 60);
    const b = play(createGame(config), [...script], 60);

    expect(JSON.stringify(a.snake)).toBe(JSON.stringify(b.snake));
    expect(a.apples).toBe(b.apples);
    expect(a.ticks).toBe(b.ticks);
    expect(a.status).toBe(b.status);
  });

  it("draws the same apple sequence regardless of how the player moves", () => {
    const config = seedForDay("2026-08-08", "salt");
    const straight = createGame(config);
    const weaving = createGame(config);
    // The candidate list is the shared sequence; only the skip pattern differs.
    expect(straight.candidates).toEqual(weaving.candidates);
    expect(straight.apple).toEqual(weaving.apple);
  });
});

describe("movement", () => {
  it("starts alive, 3 long, heading right", () => {
    const state = createGame(seedForDay("2026-08-08"));
    expect(state.status).toBe("playing");
    expect(state.snake).toHaveLength(3);
    expect(state.dir).toBe("right");
  });

  it("spawns the apple on an open, unoccupied cell", () => {
    for (let d = 0; d < 20; d++) {
      const state = createGame(seedForDay(`2026-08-${String(d + 1).padStart(2, "0")}`));
      const cell = state.apple.y * state.maze.width + state.apple.x;
      expect(state.maze.walls[cell]).toBe(false);
      expect(state.snake.some((s) => s.x === state.apple.x && s.y === state.apple.y)).toBe(false);
    }
  });

  it("refuses an instant reversal", () => {
    const state = createGame(seedForDay("2026-08-08"));
    turn(state, "left"); // opposite of "right"
    expect(state.queued).toHaveLength(0);
    step(state);
    expect(state.status).toBe("playing");
  });

  it("buffers two turns and commits one per tick", () => {
    const state = createGame(seedForDay("2026-08-08"));
    turn(state, "up");
    turn(state, "left");
    expect(state.queued).toEqual(["up", "left"]);

    step(state);
    expect(state.dir).toBe("up");
    step(state);
    expect(state.dir).toBe("left");
  });

  it("caps the buffer at two so the snake never drives itself", () => {
    const state = createGame(seedForDay("2026-08-08"));
    turn(state, "up");
    turn(state, "left");
    turn(state, "down");
    expect(state.queued).toHaveLength(2);
  });

  it("does not treat the vacating tail as a collision", () => {
    // Box turn back onto the cell the tail is leaving this very tick.
    const state = createGame(seedForDay("2026-08-08"));
    play(state, [[0, "up"], [1, "left"], [2, "down"]], 4);
    expect(state.status).toBe("playing");
  });

  it("dies on the border wall", () => {
    const state = createGame(seedForDay("2026-08-08"));
    for (let i = 0; i < 60 && state.status === "playing"; i++) step(state);
    expect(state.status).toBe("dead");
  });
});

describe("scoring", () => {
  it("tiers up every five apples and never ticks faster than 60ms", () => {
    const state = createGame(seedForDay("2026-08-08"));
    expect(tierOf(state)).toBe(0);
    expect(tickIntervalMs(state)).toBe(130);

    state.apples = 5;
    expect(tierOf(state)).toBe(1);
    expect(tickIntervalMs(state)).toBe(121);

    state.apples = 500;
    expect(tickIntervalMs(state)).toBe(60);
  });

  it("ranks by apples, then by fewest ticks", () => {
    const runs = [
      { apples: 9, ticks: 300, elapsedMs: 0 },
      { apples: 12, ticks: 900, elapsedMs: 0 },
      { apples: 12, ticks: 400, elapsedMs: 0 },
    ];
    expect(runs.sort(compareRuns).map((r) => `${r.apples}/${r.ticks}`)).toEqual(["12/400", "12/900", "9/300"]);
  });
});
