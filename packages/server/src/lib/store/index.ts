import { createMemoryStore } from "./memory";
import { createPostgresStore } from "./postgres";
import type { Store } from "./types";

/**
 * Postgres when DATABASE_URL is set, memory otherwise.
 *
 * Defaulting to memory rather than throwing is what makes `npm run dev` work
 * with no setup at all — the same reason every provider in the reference
 * project defaults to a mock.
 *
 * Deliberately NOT cached on globalThis. An earlier version was, and the cached
 * object outlived Next's hot reload — so every edit to a store method appeared
 * to do nothing until the dev server was restarted, which reads exactly like a
 * query that isn't working. Nothing is saved by caching it: the store object is
 * stateless, and the two things that genuinely must persist across reloads (the
 * postgres connection, the in-memory data) each keep themselves on globalThis.
 */
export function getStore(): Store {
  return process.env["DATABASE_URL"] ? createPostgresStore() : createMemoryStore();
}

export const isPersistent = (): boolean => Boolean(process.env["DATABASE_URL"]);

export type { LeaderboardEntry, RunRecord, Store } from "./types";
