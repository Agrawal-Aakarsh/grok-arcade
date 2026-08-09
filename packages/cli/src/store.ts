/**
 * Local state: `~/.x-arcade/state.json`.
 *
 * Part 1 is fully offline, so this is the whole persistence story for now. From
 * Part 2 the server becomes the source of truth for ranked scores and this
 * keeps only the handle, the device token, and a local mirror for offline play.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { BreakoutRunResult, RunResult } from "@x-arcade/shared";

export const STATE_DIR = join(homedir(), ".x-arcade");
const STATE_FILE = join(STATE_DIR, "state.json");

export interface ArcadeState {
  handle?: string;
  deviceToken?: string;
  /** Ranked Serpent runs, keyed by UTC day. At most 3 per day. */
  serpent: Record<string, RunResult[]>;
  /** Breakout high scores (local board), keyed by UTC day. */
  breakout: Record<string, BreakoutRunResult[]>;
}

const EMPTY: ArcadeState = { serpent: {}, breakout: {} };

export function loadState(): ArcadeState {
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Partial<ArcadeState>;
    return {
      ...EMPTY,
      ...parsed,
      serpent: parsed.serpent ?? {},
      breakout: parsed.breakout ?? {},
    };
  } catch {
    // Missing or corrupt: a fresh state is always better than a crash on boot.
    return { ...EMPTY };
  }
}

export function saveState(state: ArcadeState): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function recordRun(day: string, run: RunResult): ArcadeState {
  const state = loadState();
  const runs = state.serpent[day] ?? [];
  runs.push(run);
  state.serpent[day] = runs;
  saveState(state);
  return state;
}

export function runsForDay(day: string): RunResult[] {
  return loadState().serpent[day] ?? [];
}

export function recordBreakoutRun(day: string, run: BreakoutRunResult): ArcadeState {
  const state = loadState();
  const runs = state.breakout[day] ?? [];
  runs.push(run);
  // Keep a reasonable local history.
  state.breakout[day] = runs.slice(-50);
  saveState(state);
  return state;
}

export function breakoutRunsForDay(day: string): BreakoutRunResult[] {
  return loadState().breakout[day] ?? [];
}
