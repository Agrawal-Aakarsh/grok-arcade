/**
 * Curated maze motifs.
 *
 * v2 of the spec had Grok generating obstacle layouts with a flood-fill repair
 * loop. That was cut: Grok is already in the loop twice for Golf, and
 * generate-verify-repair on snake walls is a redundant pitch line that costs a
 * real hour. These are parametric instead of hand-drawn ASCII so the set stays
 * small and every motif is guaranteed symmetric.
 *
 * Every motif is still verified by `isPlayable` (see mazes.test.ts) — the
 * reachability guarantee survived the cut, only the LLM did not.
 */

export const GRID_WIDTH = 40;
export const GRID_HEIGHT = 20;

/** Row-major grid of wall flags, `y * width + x`. */
export type Maze = {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly walls: readonly boolean[];
};

type Motif = {
  name: string;
  /** Returns true if (x, y) should be a wall, borders excluded. */
  fill: (x: number, y: number, w: number, h: number) => boolean;
};

/**
 * The snake spawns horizontally in the middle-left, so no motif may place walls
 * in rows h/2 for x < 12 — `SPAWN_CLEARANCE` is asserted in the tests rather
 * than encoded here, so a bad motif fails loudly instead of being silently
 * carved around.
 */
const MOTIFS: Motif[] = [
  {
    // Day one should be legible: nothing but the border.
    name: "open",
    fill: () => false,
  },
  {
    name: "pillars",
    // Never flush against the border: a pillar one cell from the wall seals a
    // 1-cell dead end behind it, which reads as a bug rather than a hazard.
    fill: (x, y, w, h) => x % 7 === 3 && y % 5 === 2 && x < w - 3 && y < h - 2,
  },
  {
    name: "lanes",
    // Staggered bars, detached from BOTH borders. Running a bar into the wall
    // turns the row behind it into a dead-end corridor you can only die in.
    // The stagger (long gap right, then long gap left) is what forces the weave.
    fill: (x, y, w) => {
      if (y % 5 !== 2) return false; // y = 2, 7, 12, 17 — never the spawn row
      return y % 10 === 2 ? x >= 4 && x <= w - 11 : x >= 10 && x <= w - 5;
    },
  },
  {
    name: "corners",
    // Four L-brackets. The obvious version — two full verticals plus two full
    // horizontals — silently closes into a rectangle and seals the middle off
    // entirely, so each arm is explicitly bounded to `ARM` cells.
    fill: (x, y, w, h) => {
      const ARM = 5;
      const insetX = 5;
      const insetY = 4;
      const onVertical = x === insetX || x === w - 1 - insetX;
      const onHorizontal = y === insetY || y === h - 1 - insetY;
      const inVerticalArm = (y >= insetY && y < insetY + ARM) || (y <= h - 1 - insetY && y > h - 1 - insetY - ARM);
      const inHorizontalArm = (x >= insetX && x < insetX + ARM) || (x <= w - 1 - insetX && x > w - 1 - insetX - ARM);
      return (onVertical && inVerticalArm) || (onHorizontal && inHorizontalArm);
    },
  },
  {
    name: "diamond",
    fill: (x, y, w, h) => {
      const d = Math.abs(x - (w - 1) / 2) / 2 + Math.abs(y - (h - 1) / 2);
      // A ring, not a solid — and punctured on the axes so it is never a prison.
      return d > 6.4 && d < 7.6 && x !== Math.floor(w / 2) && y !== Math.floor(h / 2);
    },
  },
  {
    name: "gates",
    // Two vertical walls with central doorways: fast lanes, punishing turns.
    fill: (x, y, _w, h) => (x === 13 || x === 26) && Math.abs(y - (h - 1) / 2) > 2.5,
  },
];

/** Build one maze by name-index. Borders are always solid. */
export function buildMaze(index: number, width = GRID_WIDTH, height = GRID_HEIGHT): Maze {
  const motif = MOTIFS[((index % MOTIFS.length) + MOTIFS.length) % MOTIFS.length]!;
  const walls: boolean[] = new Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      walls[y * width + x] = border || motif.fill(x, y, width, height);
    }
  }
  return { name: motif.name, width, height, walls };
}

export const MAZE_COUNT = MOTIFS.length;

/**
 * Flood fill from the spawn cell.
 *
 * A maze is playable when ≥85% of open cells are reachable and none of them is a
 * one-cell pocket (a dead end with a single neighbour is a guaranteed death that
 * looks like a bug rather than a challenge).
 */
export function isPlayable(maze: Maze): { ok: boolean; reachable: number; open: number; pockets: number } {
  const { width, height, walls } = maze;
  const open = walls.reduce((n, isWall) => (isWall ? n : n + 1), 0);
  const start = Math.floor(height / 2) * width + 2;

  const seen = new Set<number>();
  const queue = [start];
  if (!walls[start]) seen.add(start);
  while (queue.length) {
    const cell = queue.pop()!;
    const x = cell % width;
    const y = Math.floor(cell / width);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (walls[next] || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }

  let pockets = 0;
  for (const cell of seen) {
    const x = cell % width;
    const y = Math.floor(cell / width);
    let exits = 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (!walls[ny * width + nx]) exits++;
    }
    if (exits <= 1) pockets++;
  }

  return { ok: seen.size >= open * 0.85 && pockets === 0, reachable: seen.size, open, pockets };
}
