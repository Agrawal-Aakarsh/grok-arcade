#!/usr/bin/env node
/**
 * x-arcade entry point.
 *
 * The day's config comes from the server, whose salt keeps future mazes out of
 * the published npm package. When the server is unreachable we fall back to a
 * local, salt-free derivation: you still get a deterministic game, just an
 * unranked one. Serpent staying playable offline is deliberate — it is the safe
 * thing to open a demo with when the venue wifi is bad.
 */

import { dayKey, seedForDay, type DailyConfig, type RunResult } from "@x-arcade/shared";

import { ApiError, fetchDaily, login, offlineSafe, submitRun } from "./api.js";
import { emitEvent } from "./events.js";
import { playGolf } from "./games/golf.js";
import { playSerpent } from "./games/serpent.js";
import { installHook, printHookHelp, uninstallHook } from "./hook.js";
import { closePane, markRunning, openPane } from "./pane.js";
import { Screen } from "./term/screen.js";
import { showLeaderboard } from "./ui/leaderboard.js";
import { showMenu } from "./ui/menu.js";
import { promptLine } from "./ui/prompt.js";
import { loadState, recordRun, runsForDay, saveState } from "./store.js";

const HELP = `
  x-arcade — daily mini-games for the dead minutes while your agent works

  Usage
    arcade                 open the arcade menu
    arcade serpent         jump straight into today's Serpent
    arcade golf            today's Prompt Golf
    arcade login           claim your X handle for the leaderboard
    arcade board           today's leaderboard
    arcade hook            wire the agent-ready toast into grok
    arcade hook --install  install it   (--uninstall to remove)
    arcade notify          emit an agent event (grok calls this, not you)
    arcade pane            open the arcade beside your agent (grok calls this)
    arcade pane --where    show how the arcade would open here
    arcade pane --window   force a new terminal window
    arcade --help          this

  In game
    arrows / wasd / hjkl   move
    r                      end run (ranked) or restart (practice)
    Enter                  start the next run
    L                      leaderboard
    Esc                    back to the menu
    q                      quit
`;

/**
 * Invoked by grok's hook as its own process. It must stay silent and always
 * succeed — anything on stdout lands in the user's agent session, and a
 * non-zero exit makes grok report a broken hook.
 */
function notify(argv: string[]): void {
  const flagIndex = argv.indexOf("--event");
  const override = flagIndex >= 0 ? argv[flagIndex + 1] : undefined;
  try {
    emitEvent({
      event: override ?? process.env["GROK_EVENT"] ?? "turn_complete",
      ...(process.env["GROK_MESSAGE"] ? { message: process.env["GROK_MESSAGE"] } : {}),
      ...(process.env["GROK_SESSION_ID"] ? { session: process.env["GROK_SESSION_ID"] } : {}),
      at: Date.now(),
    });
  } catch {
    // No arcade running, unwritable home, whatever — never surface it.
  }
}

/** Claim a handle. Resolves true if the user is signed in when it returns. */
async function runLogin(screen: Screen): Promise<boolean> {
  const state = loadState();

  const handle = await promptLine({
    screen,
    title: "WHAT'S YOUR X HANDLE?",
    hint: "Enter to claim · Esc to skip",
    status: (value) => (value ? `will appear as @${value.replace(/^@/, "").toLowerCase()}` : "letters, digits, underscore"),
    validate: (value) =>
      /^@?[A-Za-z0-9_]{1,15}$/.test(value.trim()) ? null : "1-15 characters: letters, digits, underscore",
    maxLength: 16,
    ...(state.handle ? { initial: state.handle } : {}),
  });
  if (handle === null) return Boolean(state.handle);

  const cleaned = handle.trim().replace(/^@/, "").toLowerCase();

  // Deliberately not offlineSafe here. That helper collapses every failure into
  // null, which turned a 409 "handle already claimed" into "couldn't reach the
  // server" — the user then had no idea why their runs stopped counting. A
  // server that answered deserves to have its answer shown.
  let result: { handle: string; token: string };
  try {
    result = await login(cleaned, state.deviceToken);
  } catch (error) {
    if (error instanceof ApiError) {
      await showMessage(
        screen,
        error.status === 409 ? `@${cleaned} is taken` : "couldn't sign in",
        error.status === 409
          ? "someone claimed it, or you claimed it on another machine — pick another handle"
          : error.message,
      );
    } else {
      await showMessage(screen, "couldn't reach the server", "runs are saved locally; try signing in later");
    }
    return Boolean(state.handle);
  }

  saveState({ ...state, handle: result.handle, deviceToken: result.token });
  await showMessage(screen, `signed in as @${result.handle}`, "your daily runs now land on the shared board");
  return true;
}

/** A dismissable one-line notice. */
function showMessage(screen: Screen, title: string, detail: string): Promise<void> {
  return promptLine({
    screen,
    title,
    hint: "press Enter",
    status: () => detail,
    maxLength: 0,
  }).then(() => undefined);
}

async function main(): Promise<void> {
  const [, , command, flag] = process.argv;

  if (command === "notify") return notify(process.argv.slice(3));
  if (command === "pane") {
    // Called by grok's UserPromptSubmit hook, so the default path is silent and
    // always exits 0 — anything on stdout lands inside the user's agent
    // session. --debug prints the diagnosis, because a hook that fails quietly
    // is indistinguishable from one that never ran.
    if (flag === "--close") {
      closePane();
      return;
    }
    const result = openPane(flag === "--force");
    if (flag === "--debug" || flag === "--where") {
      process.stdout.write(
        `  host        ${result.host}\n` +
          `  opened      ${result.opened}\n` +
          `  reason      ${result.reason ?? "-"}\n` +
          `  CMUX_SURFACE_ID  ${process.env["CMUX_SURFACE_ID"] ?? "unset"}\n` +
          `  CMUX_SOCKET_PATH ${process.env["CMUX_SOCKET_PATH"] ? "set" : "unset"}\n` +
          `  TMUX             ${process.env["TMUX"] ? "set" : "unset"}\n`,
      );
    }
    return;
  }
  if (command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (command === "hook") {
    if (flag === "--install") installHook();
    else if (flag === "--uninstall") uninstallHook();
    else printHookHelp();
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("x-arcade needs an interactive terminal.\n");
    process.exitCode = 1;
    return;
  }

  // No hard size gate: screens render a "resize me" prompt and redraw on the
  // resize event, so a small window is a wait rather than a refusal.
  const screen = new Screen();
  // Record the pid so the UserPromptSubmit hook can tell an arcade is already
  // up and skip opening another one.
  markRunning();
  const day = dayKey();

  // Ask the server for today's board; fall back to an unranked local daily.
  const remote = await offlineSafe(fetchDaily);
  const config: DailyConfig = remote
    ? { seed: remote.serpent.seed, mazeIndex: remote.serpent.mazeIndex }
    : seedForDay(day);
  const ranked = remote !== null;

  screen.enter();
  try {
    const submit = async (run: RunResult): Promise<void> => {
      recordRun(day, run);
      const state = loadState();
      if (!ranked || !state.handle || !state.deviceToken) return;
      // Fire and forget: a failed submission must never interrupt play, and the
      // run is already banked locally either way.
      await offlineSafe(() => submitRun({ handle: state.handle!, token: state.deviceToken! }, day, run));
    };

    const playToday = (): Promise<void> =>
      playSerpent({ screen, config, day, existing: runsForDay(day), onRunComplete: (run) => void submit(run) });

    if (command === "serpent") return await playToday();
    if (command === "golf") return await playGolf({ screen });
    if (command === "login") {
      await runLogin(screen);
      return;
    }
    if (command === "board") {
      await showLeaderboard(screen, loadState().handle);
      return;
    }

    for (;;) {
      const choice = await showMenu({
        screen,
        day,
        serpentRuns: runsForDay(day),
        handle: loadState().handle,
        ranked,
      });
      if (choice === "quit") return;
      if (choice === "serpent") await playToday();
      if (choice === "golf") await playGolf({ screen });
      if (choice === "board") await showLeaderboard(screen, loadState().handle);
      if (choice === "login") await runLogin(screen);
    }
  } finally {
    screen.restore();
  }
}

await main();
