/**
 * Local state: `~/.x-arcade/state.json`.
 *
 * Part 1 is fully offline, so this is the whole persistence story for now. From
 * Part 2 the server becomes the source of truth for ranked scores and this
 * keeps only the handle, the device token, and a local mirror for offline play.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { RunResult } from "@x-arcade/shared";

export const STATE_DIR = join(homedir(), ".x-arcade");
const STATE_FILE = join(STATE_DIR, "state.json");

export interface ArcadeState {
  handle?: string;
  deviceToken?: string;
  /** Ranked Serpent runs, keyed by UTC day. At most 3 per day. */
  serpent: Record<string, RunResult[]>;
}

const EMPTY: ArcadeState = { serpent: {} };

export function loadState(): ArcadeState {
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Partial<ArcadeState>;
    return { ...EMPTY, ...parsed, serpent: parsed.serpent ?? {} };
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

/* ── profiles ───────────────────────────────────────────────────────────── */

const PROFILE_DIR = join(STATE_DIR, "profiles");

/**
 * Saved identities, one file per handle.
 *
 * Switching accounts used to be lossy: signing in as someone else overwrote
 * state.json, and since re-claiming a taken handle requires its device token,
 * your own handle became permanently unreachable. Keeping a copy per handle
 * makes switching reversible — log back in and the token comes with it.
 */
export function saveProfile(state: ArcadeState): void {
  if (!state.handle || !state.deviceToken) return;
  mkdirSync(PROFILE_DIR, { recursive: true });
  writeFileSync(
    join(PROFILE_DIR, `${state.handle}.json`),
    JSON.stringify({ handle: state.handle, deviceToken: state.deviceToken }, null, 2),
  );
}

/** The saved device token for a handle, if we have ever signed in as it here. */
export function tokenForHandle(handle: string): string | undefined {
  try {
    const saved = JSON.parse(readFileSync(join(PROFILE_DIR, `${handle}.json`), "utf8")) as {
      deviceToken?: string;
    };
    return saved.deviceToken;
  } catch {
    return undefined;
  }
}

export function listProfiles(): string[] {
  try {
    return readdirSync(PROFILE_DIR)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -5))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Sign out. Always banks the current profile first, so this can never be the
 * action that loses someone their handle.
 */
export function logout(): string | undefined {
  const state = loadState();
  if (!state.handle) return undefined;
  saveProfile(state);
  const { handle: _handle, deviceToken: _token, ...rest } = state;
  saveState(rest as ArcadeState);
  return state.handle;
}
