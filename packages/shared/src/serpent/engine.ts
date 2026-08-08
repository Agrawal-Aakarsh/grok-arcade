/**
 * Serpent engine — pure, deterministic, no I/O.
 *
 * Seed in, state out. Nothing here reads the clock, the filesystem, or the
 * network, so a run can be replayed exactly from `(seed, mazeIndex, inputs)`.
 * That is what makes the daily leaderboard meaningful and what will make
 * server-side run verification possible later without rewriting the game.
 *
 * State is mutated in place rather than rebuilt each tick. At 15+ ticks/sec a
 * fresh snake array per frame is pure garbage-collector churn for no benefit;
 * the reference project's engine makes the same trade.
 */

import { createRng, hashString } from "../rng.js";
import { buildMaze, MAZE_COUNT, type Maze } from "./mazes.js";

export type Dir = "up" | "down" | "left" | "right";
export type Status = "playing" | "dead";

export interface Point {
  x: number;
  y: number;
}

export interface SerpentState {
  readonly maze: Maze;
  /** Head first. */
  snake: Point[];
  dir: Dir;
  /** Turns buffered but not yet committed. See `turn` for why this exists. */
  queued: Dir[];
  apple: Point;
  apples: number;
  ticks: number;
  status: Status;
  /** Segments still owed from the last apple. */
  grow: number;
  /** Pre-drawn candidate cells — the shared "apple sequence". */
  readonly candidates: readonly number[];
  cursor: number;
}

const DELTAS: Record<Dir, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE: Record<Dir, Dir> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

/** Segments gained per apple. */
const GROWTH_PER_APPLE = 3;

/** How many apple positions to pre-draw. No run will ever eat this many. */
const CANDIDATE_COUNT = 4096;

export interface DailyConfig {
  /** Numeric seed; derive with `seedForDay`. */
  seed: number;
  /** Which curated motif to use. */
  mazeIndex: number;
}

/**
 * Derive the day's config from its key. In production the salt comes from the
 * server so the maze cannot be datamined out of the published npm package —
 * offline/practice play falls back to an empty salt.
 */
export function seedForDay(dayKey: string, salt = ""): DailyConfig {
  const seed = hashString(`${dayKey}:${salt}`);
  return { seed, mazeIndex: seed % MAZE_COUNT };
}

/**
 * The apple sequence is drawn up front rather than per-spawn.
 *
 * Drawing lazily would make apple positions depend on where the snake happens
 * to be, which depends on how the player moved — so two players on the same
 * seed would diverge and "same apples for everyone" would be a lie. Instead we
 * fix the sequence and, at each spawn, walk it until a cell is free. Only the
 * skips differ between players; the order never does.
 */
function drawCandidates(seed: number, cells: number): readonly number[] {
  const rng = createRng(seed);
  const out: number[] = new Array(CANDIDATE_COUNT);
  for (let i = 0; i < CANDIDATE_COUNT; i++) out[i] = rng.int(cells);
  return out;
}

function occupied(state: SerpentState, x: number, y: number): boolean {
  return state.snake.some((s) => s.x === x && s.y === y);
}

/** Advance the cursor to the next candidate cell that is neither wall nor snake. */
function spawnApple(state: SerpentState): void {
  const { maze, candidates } = state;
  for (let n = 0; n < candidates.length; n++) {
    const cell = candidates[(state.cursor + n) % candidates.length]!;
    const x = cell % maze.width;
    const y = Math.floor(cell / maze.width);
    if (!maze.walls[cell] && !occupied(state, x, y)) {
      state.cursor = (state.cursor + n + 1) % candidates.length;
      state.apple = { x, y };
      return;
    }
  }
  // Unreachable in practice (4096 draws over ~700 open cells), but a board with
  // no free cell at all is a win, not a crash.
  state.status = "dead";
}

export function createGame(config: DailyConfig): SerpentState {
  const maze = buildMaze(config.mazeIndex);
  const midY = Math.floor(maze.height / 2);

  const state: SerpentState = {
    maze,
    // Spawns horizontally in the middle-left, already 3 long and moving right.
    snake: [
      { x: 5, y: midY },
      { x: 4, y: midY },
      { x: 3, y: midY },
    ],
    dir: "right",
    queued: [],
    apple: { x: 0, y: 0 },
    apples: 0,
    ticks: 0,
    status: "playing",
    grow: 0,
    candidates: drawCandidates(config.seed, maze.width * maze.height),
    cursor: 0,
  };

  spawnApple(state);
  return state;
}

/**
 * Buffer a turn.
 *
 * Applying input directly would let a fast player kill themselves: pressing
 * `up` then `left` inside a single tick would validate `left` against the old
 * `right`, reverse the snake into its own neck, and read as a broken game
 * rather than a mistake. Turns are queued and committed one per tick, each
 * validated against the direction actually in effect when it lands.
 *
 * The queue is capped at two — deeper buffering makes the snake feel like it is
 * driving itself.
 */
export function turn(state: SerpentState, dir: Dir): void {
  if (state.status !== "playing" || state.queued.length >= 2) return;
  const last = state.queued.at(-1) ?? state.dir;
  if (dir === last || dir === OPPOSITE[last]) return;
  state.queued.push(dir);
}

/** Advance one tick. */
export function step(state: SerpentState): void {
  if (state.status !== "playing") return;

  const next = state.queued.shift();
  if (next && next !== OPPOSITE[state.dir]) state.dir = next;

  const delta = DELTAS[state.dir];
  const head = state.snake[0]!;
  const nx = head.x + delta.x;
  const ny = head.y + delta.y;

  if (nx < 0 || ny < 0 || nx >= state.maze.width || ny >= state.maze.height) {
    state.status = "dead";
    return;
  }
  if (state.maze.walls[ny * state.maze.width + nx]) {
    state.status = "dead";
    return;
  }

  // The tail vacates this tick unless we are still growing, so it is not a
  // collision — without this exception every turn into your own tail is a death.
  const ignoreTail = state.grow === 0;
  const body = ignoreTail ? state.snake.slice(0, -1) : state.snake;
  if (body.some((s) => s.x === nx && s.y === ny)) {
    state.status = "dead";
    return;
  }

  state.snake.unshift({ x: nx, y: ny });
  if (state.grow > 0) {
    state.grow--;
  } else {
    state.snake.pop();
  }

  if (nx === state.apple.x && ny === state.apple.y) {
    state.apples++;
    state.grow += GROWTH_PER_APPLE;
    spawnApple(state);
  }

  state.ticks++;
}

/** Difficulty tier, one per 5 apples. */
export function tierOf(state: SerpentState): number {
  return Math.floor(state.apples / 5);
}

/**
 * Milliseconds between ticks. Starts comfortable and floors at 60ms — below
 * that the input buffer stops being able to save you and it reads as unfair.
 */
export function tickIntervalMs(state: SerpentState): number {
  return Math.max(60, 130 - tierOf(state) * 9);
}

export interface RunResult {
  apples: number;
  ticks: number;
  elapsedMs: number;
}

/**
 * A finished run. Ranking is apples desc, then ticks asc.
 *
 * Ticks rather than wall-clock: ticks are engine-deterministic, so two players
 * who ate the same apples in the same number of moves genuinely tie, and a
 * laggy terminal cannot cost you the tiebreak.
 */
export function resultOf(state: SerpentState, elapsedMs: number): RunResult {
  return { apples: state.apples, ticks: state.ticks, elapsedMs };
}

export function compareRuns(a: RunResult, b: RunResult): number {
  return b.apples - a.apples || a.ticks - b.ticks;
}
