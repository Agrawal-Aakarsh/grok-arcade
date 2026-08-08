/**
 * The bridge between `grok` and a running arcade.
 *
 * grok's notification hooks fire a *command*, not a message to an existing
 * process, so `arcade notify` runs as its own short-lived process and has to
 * hand the event to whatever arcade is already on screen. A file append is the
 * whole mechanism: no daemon, no socket to leak, no port to collide, and it
 * degrades to a no-op when no arcade is running.
 *
 * Reading is by polling rather than fs.watch — fs.watch semantics differ across
 * platforms and silently miss appends on some of them, and a stat every 400ms
 * costs nothing next to a 30fps render loop.
 */

import { appendFileSync, mkdirSync, openSync, readSync, closeSync, statSync } from "node:fs";
import { join } from "node:path";

import { STATE_DIR } from "./store.js";

const EVENT_FILE = join(STATE_DIR, "events");
const POLL_MS = 400;

export interface AgentEvent {
  /** grok's event name: turn_complete, approval_required, task_complete, agent_error… */
  event: string;
  message?: string;
  session?: string;
  at: number;
}

/** Called by `arcade notify`, from inside grok's hook. */
export function emitEvent(event: AgentEvent): void {
  mkdirSync(STATE_DIR, { recursive: true });
  appendFileSync(EVENT_FILE, `${JSON.stringify(event)}\n`);
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/**
 * Watch for events appended after this call. Starts from the current end of
 * file so a stale backlog never fires a toast the moment you open the arcade.
 */
export function watchEvents(handler: (event: AgentEvent) => void): () => void {
  let offset = sizeOf(EVENT_FILE);

  const timer = setInterval(() => {
    const size = sizeOf(EVENT_FILE);
    if (size === offset) return;
    // Truncated or rotated underneath us: resync rather than read garbage.
    if (size < offset) {
      offset = size;
      return;
    }

    let fd: number | undefined;
    try {
      fd = openSync(EVENT_FILE, "r");
      const buffer = Buffer.alloc(size - offset);
      readSync(fd, buffer, 0, buffer.length, offset);
      offset = size;
      for (const line of buffer.toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          handler(JSON.parse(line) as AgentEvent);
        } catch {
          // A malformed line is not worth killing the game over.
        }
      }
    } catch {
      // File vanished between stat and open; next tick will resync.
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }, POLL_MS);

  timer.unref?.();
  return () => clearInterval(timer);
}

/** Player-facing toast copy for each grok event. */
export function toastFor(event: AgentEvent): string {
  switch (event.event) {
    case "approval_required":
      return "grok needs you — approval required";
    case "agent_error":
      return "grok hit an error";
    case "task_complete":
      return "task complete";
    case "session_ready":
      return "grok is ready";
    case "turn_complete":
    default:
      return "agent ready";
  }
}
