/**
 * grok integration.
 *
 * The v2 spec budgeted a day for a node-pty wrapper that would spawn the agent
 * and classify its state from the output stream. Unnecessary — grok fires
 * lifecycle hooks, so the integration is one JSON file.
 *
 * grok has *two* independent hook systems and picking the wrong one costs a
 * debugging session:
 *
 *   1. `[[ui.notifications.hooks]]` in config.toml — part of the notification
 *      subsystem, gated behind BOTH a global `condition` and a per-hook
 *      `only_unfocused`, invisible to `/hooks`, and grok rewrites the file
 *      through its own TOML serialiser (stripping comments). We tried this
 *      first. It never fired.
 *   2. Lifecycle hooks in `~/.grok/hooks/*.json` — always trusted, no focus
 *      gating, and listed by `/hooks` so you can actually verify an install.
 *      This is what we use.
 *
 * Docs: ~/.grok/docs/user-guide/10-hooks.md
 */

import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { STATE_DIR } from "./store.js";

const GROK_DIR = join(homedir(), ".grok");
const HOOKS_DIR = join(GROK_DIR, "hooks");
const HOOK_FILE = join(HOOKS_DIR, "x-arcade.json");
const LEGACY_CONFIG = join(GROK_DIR, "config.toml");

/** Where we keep a copy of ourselves that hooks can rely on forever. */
const STABLE_BIN = join(STATE_DIR, "bin", "arcade.mjs");

/**
 * Resolve a path the hook can still call in a month.
 *
 * Baking in `process.argv[1]` breaks for the most common install route. Under
 * `npx x-arcade` that path lives in `~/.npm/_npx/<hash>/`, which npm garbage
 * collects — the hook fires happily today and silently stops firing later,
 * which is the worst failure shape there is.
 *
 * The published CLI is a single bundled file with zero runtime dependencies, so
 * the fix is to copy it somewhere permanent and point the hook at the copy.
 * That makes `npx x-arcade hook --install` genuinely durable, with no global
 * install required.
 *
 * A dev checkout is not bundled — its dist imports @x-arcade/shared through
 * node_modules — so the copy is verified by running it before being trusted,
 * and we fall back to the original path when it cannot stand alone.
 */
function stableCommand(): string {
  const script = process.argv[1];
  if (!script) return "arcade";
  if (script === STABLE_BIN) return `${process.execPath} ${STABLE_BIN}`;

  try {
    mkdirSync(join(STATE_DIR, "bin"), { recursive: true });
    copyFileSync(script, STABLE_BIN);
    chmodSync(STABLE_BIN, 0o755);
    // Prove the copy stands alone before betting the integration on it.
    const check = spawnSync(process.execPath, [STABLE_BIN, "--help"], { encoding: "utf8", timeout: 15_000 });
    if (check.status === 0) return `${process.execPath} ${STABLE_BIN}`;
  } catch {
    /* fall through */
  }
  return `${process.execPath} ${script}`;
}

function notifyCommand(event: string): string {
  return `${stableCommand()} notify --event ${event}`;
}

function paneCommand(): string {
  return `${stableCommand()} pane`;
}

function hookDocument(): unknown {
  const entry = (event: string): unknown => ({
    hooks: [{ type: "command", command: notifyCommand(event) }],
  });
  return {
    hooks: {
      // UserPromptSubmit is the moment the agent starts working — the dead
      // minutes begin here, so this is when the arcade should appear.
      UserPromptSubmit: [{ hooks: [{ type: "command", command: paneCommand() }] }],
      // Stop = "an agent turn ends on a genuine completion (not on a user
      // interrupt)", which is exactly the moment worth surfacing.
      Stop: [entry("turn_complete")],
      Notification: [entry("approval_required")],
      SubagentStop: [entry("task_complete")],
      StopFailure: [entry("agent_error")],
    },
  };
}

export function hookStatus(): { installed: boolean; stale: boolean } {
  if (!existsSync(HOOK_FILE)) return { installed: false, stale: false };
  try {
    const current = readFileSync(HOOK_FILE, "utf8");
    return { installed: true, stale: current.trim() !== JSON.stringify(hookDocument(), null, 2).trim() };
  } catch {
    return { installed: true, stale: true };
  }
}

/** True if the abandoned notifications-based hook is still in config.toml. */
function hasLegacyConfigHook(): boolean {
  if (!existsSync(LEGACY_CONFIG)) return false;
  try {
    return readFileSync(LEGACY_CONFIG, "utf8")
      .split("\n")
      .some((line) => line.trimStart().startsWith("command =") && /arcade/i.test(line) && /notify/.test(line));
  } catch {
    return false;
  }
}

const TEST =
  `  Verify:\n\n` +
  `    /hooks          inside grok — the Hooks tab lists them\n` +
  `    arcade notify   from any shell — fires a toast by hand\n\n`;

export function printHookHelp(): void {
  const { installed, stale } = hookStatus();

  if (installed && !stale) {
    process.stdout.write(
      `\n  ✓ x-arcade is hooked into grok.\n\n` +
        `    ${HOOK_FILE}\n` +
        `    Delete that file to uninstall. Restart grok to pick up changes.\n\n` +
        (hasLegacyConfigHook()
          ? `  ! An old notifications hook is still in config.toml. It never fired;\n` +
            `    remove the [[ui.notifications.hooks]] block that mentions arcade.\n\n`
          : "") +
        TEST,
    );
    return;
  }

  process.stdout.write(
    `\n  ${stale ? "Your hook file is out of date." : "Wire the agent-ready toast into grok:"}\n\n` +
      `    arcade hook --install\n\n` +
      `  Writes ${HOOK_FILE}:\n\n` +
      `${JSON.stringify(hookDocument(), null, 2)
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n")}\n\n` +
      `  Global hooks in ~/.grok/hooks/ are always trusted — no /hooks-trust needed.\n` +
      `  Restart grok afterwards; hooks load at session start.\n\n` +
      TEST,
  );
}

export function installHook(): void {
  const { installed, stale } = hookStatus();
  if (installed && !stale) {
    process.stdout.write(`\n  Already installed — nothing to do.\n  ${HOOK_FILE}\n\n`);
    return;
  }

  mkdirSync(HOOKS_DIR, { recursive: true });
  // Our own file, so a whole-file write is safe — unlike config.toml, which
  // holds the user's settings and can only ever be appended to.
  writeFileSync(HOOK_FILE, `${JSON.stringify(hookDocument(), null, 2)}\n`);

  process.stdout.write(
    `\n  ✓ ${stale ? "Updated" : "Installed"} ${HOOK_FILE}\n\n` +
      `    Restart grok, then run \`/hooks\` to confirm it loaded.\n\n` +
      (hasLegacyConfigHook()
        ? `  ! An old notifications hook is still in config.toml. It never fired;\n` +
          `    remove the [[ui.notifications.hooks]] block that mentions arcade\n` +
          `    (and the [ui.notifications] condition/idle_threshold_secs lines if\n` +
          `    you did not set those yourself).\n\n`
        : "") +
      TEST,
  );
}

export function uninstallHook(): void {
  if (!existsSync(HOOK_FILE)) {
    process.stdout.write(`\n  Not installed.\n\n`);
    return;
  }
  rmSync(HOOK_FILE);
  process.stdout.write(`\n  ✓ Removed ${HOOK_FILE}\n    Restart grok to apply.\n\n`);
}
