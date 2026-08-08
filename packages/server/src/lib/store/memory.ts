/**
 * In-memory store. The default when DATABASE_URL is unset.
 *
 * Not merely a stub — it implements the same contract as the Postgres store,
 * including the best-of-3 cap and leaderboard ordering, so the routes can be
 * tested end to end without a database anywhere near them.
 *
 * State lives on globalThis because Next dev-mode module reloading would
 * otherwise reset it on every edit, which looks exactly like a data-loss bug.
 */

import { randomBytes } from "node:crypto";

import { compareCards, cardOf } from "@x-arcade/shared";

import { RANKED_RUNS_PER_DAY } from "../rules";
import type {
  ClaimResult,
  GolfAttemptRow,
  GolfDailyRow,
  LeaderboardEntry,
  RateVerdict,
  RunRecord,
  StoredImage,
  Store,
} from "./types";

interface MemoryState {
  handles: Map<string, string>;
  runs: Map<string, RunRecord[]>;
  rates: Map<string, { windowStart: number; count: number }>;
  images: Map<string, StoredImage>;
  dailies: Map<string, GolfDailyRow>;
  attempts: Map<string, GolfAttemptRow>;
  budget: Map<string, number>;
}

const globalStore = globalThis as unknown as { __xArcadeMemory?: MemoryState };

function state(): MemoryState {
  globalStore.__xArcadeMemory ??= {
    handles: new Map(),
    runs: new Map(),
    rates: new Map(),
    images: new Map(),
    dailies: new Map(),
    attempts: new Map(),
    budget: new Map(),
  };
  return globalStore.__xArcadeMemory;
}

const runKey = (handle: string, day: string): string => `${day}:${handle}`;

export function createMemoryStore(): Store {
  return {
    async claimHandle(handle, token) {
      const s = state();
      const existing = s.handles.get(handle);
      if (!existing) {
        const minted = randomBytes(24).toString("base64url");
        s.handles.set(handle, minted);
        return { ok: true, token: minted };
      }
      if (token && token === existing) return { ok: true, token: existing };
      return { ok: false, reason: "taken" };
    },

    async verifyHandle(handle, token) {
      return state().handles.get(handle) === token;
    },

    async runsFor(handle, day) {
      return [...(state().runs.get(runKey(handle, day)) ?? [])];
    },

    async addRun(handle, day, run) {
      const s = state();
      const key = runKey(handle, day);
      const runs = s.runs.get(key) ?? [];
      if (runs.length >= RANKED_RUNS_PER_DAY) return;
      runs.push(run);
      s.runs.set(key, runs);
    },

    async leaderboard(day, limit) {
      const entries: LeaderboardEntry[] = [];
      for (const [key, runs] of state().runs) {
        if (!key.startsWith(`${day}:`) || runs.length === 0) continue;
        const best = [...runs].sort((a, b) => b.apples - a.apples || a.ticks - b.ticks)[0]!;
        entries.push({ handle: key.slice(day.length + 1), apples: best.apples, ticks: best.ticks, runs: runs.length });
      }
      return entries.sort((a, b) => b.apples - a.apples || a.ticks - b.ticks).slice(0, limit);
    },

    /* ── Golf ─────────────────────────────────────────────────────────── */

    async putImage(image) {
      state().images.set(image.id, image);
    },

    async getImage(id) {
      return state().images.get(id) ?? null;
    },

    async claimGolfDaily(day, staleMs) {
      const s = state();
      const existing = s.dailies.get(day);
      if (existing?.status === "ready") return { claimed: false, row: existing };
      // Reclaim a build that started but never finished — otherwise one crashed
      // request wedges the day permanently.
      if (existing && Date.now() - existing.claimedAt < staleMs) return { claimed: false, row: existing };
      const row: GolfDailyRow = { day, sourcePrompt: null, imageId: null, status: "pending", claimedAt: Date.now() };
      s.dailies.set(day, row);
      return { claimed: true, row };
    },

    async publishGolfDaily(day, sourcePrompt, imageId) {
      state().dailies.set(day, { day, sourcePrompt, imageId, status: "ready", claimedAt: Date.now() });
    },

    async getGolfDaily(day) {
      return state().dailies.get(day) ?? null;
    },

    async createAttempt(row) {
      state().attempts.set(row.id, { ...row, createdAt: Date.now() });
    },

    async updateAttempt(id, patch) {
      const s = state();
      const existing = s.attempts.get(id);
      if (existing) s.attempts.set(id, { ...existing, ...patch });
    },

    async getAttempt(id) {
      return state().attempts.get(id) ?? null;
    },

    async attemptsFor(handle, day) {
      return [...state().attempts.values()]
        .filter((a) => a.handle === handle && a.day === day)
        .sort((a, b) => a.createdAt - b.createdAt);
    },

    async golfBoard(day, limit) {
      const byHandle = new Map<string, GolfAttemptRow[]>();
      for (const attempt of state().attempts.values()) {
        if (attempt.day !== day || attempt.status !== "scored") continue;
        byHandle.set(attempt.handle, [...(byHandle.get(attempt.handle) ?? []), attempt]);
      }
      return [...byHandle.values()]
        .map((attempts) => {
          const card = cardOf(attempts.map((a) => ({ prompt: a.prompt, score: a.score })))!;
          const best = attempts.find((a) => a.strokes === card.strokes && a.score === card.score) ?? attempts[0]!;
          return { best, card };
        })
        .sort((a, b) => compareCards(a.card, b.card))
        .slice(0, limit)
        .map((entry) => entry.best);
    },

    async consumeBudget(day, limit) {
      const s = state();
      const used = s.budget.get(day) ?? 0;
      if (used >= limit) return false;
      s.budget.set(day, used + 1);
      return true;
    },

    /* ── shared ───────────────────────────────────────────────────────── */

    async rateLimit(key, limit, windowMs): Promise<RateVerdict> {
      const s = state();
      const now = Date.now();
      const windowStart = Math.floor(now / windowMs) * windowMs;
      const current = s.rates.get(key);
      const count = current && current.windowStart === windowStart ? current.count + 1 : 1;
      s.rates.set(key, { windowStart, count });
      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        retryAfterMs: windowStart + windowMs - now,
      };
    },
  } satisfies Store;
}

export type { ClaimResult };
