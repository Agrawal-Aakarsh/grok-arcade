/**
 * Opening the arcade beside a working agent.
 *
 * A hook is a short-lived process with no windowing authority — it cannot
 * conjure a pane on its own. Something that already owns a window has to do it.
 *
 * **cmux is the supported host.** Ghostty on macOS is a dead end for this: its
 * only CLI action for windows is `+new-window`, which reports "not supported on
 * this platform" on macOS, `new_split` exists solely as a *keybinding* action,
 * and there is no IPC socket. No external process can ever split a Ghostty
 * window on macOS. cmux is Ghostty underneath but exposes a real Unix socket
 * API, so it can. tmux works too and is the cross-platform fallback.
 *
 * Neither cmux nor tmux can create a split that *runs a command* in one call,
 * so both do it in two steps: split, then type the command into the new pane.
 * Slightly indirect, entirely reliable.
 *
 * Deliberately NOT a PTY takeover (`arcade watch -- grok`): owning the agent's
 * terminal means handling alternate-screen switching, resize propagation and
 * escape passthrough, which is a day of work to reach "mostly fine".
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { STATE_DIR } from "./store.js";

const LOCK = join(STATE_DIR, "pane.json");

/** cmux ships its CLI inside the app bundle; it is usually not on PATH. */
const CMUX_BUNDLED = "/Applications/cmux.app/Contents/Resources/bin/cmux";

export type PaneHost = "cmux" | "tmux" | "none";

interface PaneLock {
  host: PaneHost;
  /** Surface/pane ref, so we can tell whether it is still alive. */
  ref?: string;
  at: number;
}

/** Absolute path to this entry point — a hook's PATH may not include `arcade`. */
function arcadeCommand(): string {
  const script = process.argv[1];
  return script ? `${process.execPath} ${script}` : "arcade";
}

function cmuxBinary(): string | null {
  if (existsSync(CMUX_BUNDLED)) return CMUX_BUNDLED;
  const found = spawnSync("command", ["-v", "cmux"], { encoding: "utf8", shell: true });
  return found.status === 0 ? found.stdout.trim() : null;
}

/**
 * cmux injects CMUX_* variables into every pane it spawns and protects them
 * from being overridden, so their presence is a reliable "we are inside cmux".
 */
function inCmux(): boolean {
  return Boolean(process.env["CMUX_SURFACE_ID"] || process.env["CMUX_WORKSPACE_ID"] || process.env["CMUX_SOCKET_PATH"]);
}

export function detectHost(): PaneHost {
  if (inCmux() && cmuxBinary()) return "cmux";
  // $TMUX is set for any process inside a tmux session, including a hook that
  // the agent spawned — which is exactly the case we care about.
  if (process.env["TMUX"]) return "tmux";
  return "none";
}

function cmux(args: string[]): { status: number; stdout: string; stderr: string } {
  const bin = cmuxBinary();
  if (!bin) return { status: 1, stdout: "", stderr: "cmux CLI not found" };
  // The socket is per-session and injected into the pane; passing it explicitly
  // means the hook does not depend on cmux's own default resolution.
  const socket = process.env["CMUX_SOCKET_PATH"];
  const result = spawnSync(bin, [...(socket ? ["--socket", socket] : []), ...args], { encoding: "utf8" });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function readLock(): PaneLock | null {
  try {
    return JSON.parse(readFileSync(LOCK, "utf8")) as PaneLock;
  } catch {
    return null;
  }
}

function writeLock(lock: PaneLock): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(LOCK, JSON.stringify(lock));
}

/** Is the pane we opened still on screen? */
function paneAlive(lock: PaneLock | null): boolean {
  if (!lock?.ref) return false;
  if (lock.host === "tmux") {
    return spawnSync("tmux", ["list-panes", "-a", "-F", "#{pane_id}"], { encoding: "utf8" }).stdout?.includes(lock.ref) ?? false;
  }
  if (lock.host === "cmux") {
    const listed = cmux(["list-pane-surfaces"]);
    // If we cannot ask, assume it is gone rather than refusing to ever reopen.
    return listed.status === 0 && listed.stdout.includes(lock.ref);
  }
  return false;
}

export interface OpenResult {
  opened: boolean;
  host: PaneHost;
  reason?: string;
}

/** Pull a `surface:N` / `pane:N` / uuid ref out of CLI output. */
function parseRef(output: string): string | undefined {
  return (
    output.match(/\b(?:surface|pane):\d+\b/)?.[0] ??
    output.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)?.[0]
  );
}

/**
 * Open the arcade next to the agent. Idempotent: a second call while one is
 * already up does nothing, so submitting five prompts does not stack five
 * arcades.
 */
export function openPane(force = false): OpenResult {
  const host = detectHost();
  if (host === "none") {
    return { opened: false, host, reason: "not inside cmux or tmux" };
  }

  const existing = readLock();
  if (!force && existing?.host === host && paneAlive(existing)) {
    return { opened: false, host, reason: "already open" };
  }

  const command = arcadeCommand();

  if (host === "cmux") {
    // --focus false: the arcade must never steal attention mid-thought. You
    // turn to it when you are ready; that is the entire premise.
    const split = cmux(["new-split", "right", "--focus", "false"]);
    if (split.status !== 0) {
      return { opened: false, host, reason: split.stderr.trim() || "cmux new-split failed" };
    }

    // new-split does not take a command, so type it into the new surface.
    // Without a ref we would send to $CMUX_SURFACE_ID — the *agent's* pane —
    // and inject a stray command into the user's grok session.
    const ref = parseRef(split.stdout);
    if (!ref) {
      return { opened: false, host, reason: `could not read the new surface ref from: ${split.stdout.trim()}` };
    }

    const sent = cmux(["send", "--surface", ref, "--", `${command}\\n`]);
    if (sent.status !== 0) {
      return { opened: false, host, reason: sent.stderr.trim() || "cmux send failed" };
    }
    writeLock({ host, ref, at: Date.now() });
    return { opened: true, host };
  }

  // tmux can do it in one call, since split-window takes the command directly.
  const result = spawnSync(
    "tmux",
    ["split-window", "-h", "-d", "-p", "45", "-P", "-F", "#{pane_id}", command],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    return { opened: false, host, reason: result.stderr?.trim() || "tmux split failed" };
  }
  writeLock({ host, ref: result.stdout.trim(), at: Date.now() });
  return { opened: true, host };
}

/** Close the pane we opened. */
export function closePane(): void {
  const lock = readLock();
  if (lock?.ref && paneAlive(lock)) {
    if (lock.host === "tmux") spawnSync("tmux", ["kill-pane", "-t", lock.ref]);
    if (lock.host === "cmux") cmux(["close-surface", "--surface", lock.ref]);
  }
  if (existsSync(LOCK)) writeFileSync(LOCK, JSON.stringify({ host: "none", at: 0 }));
}
