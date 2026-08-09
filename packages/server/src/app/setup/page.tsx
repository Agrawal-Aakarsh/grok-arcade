/**
 * Setup instructions.
 *
 * Written for someone who has never seen the project and is deciding in about
 * fifteen seconds whether to bother. So: the one command first, what to expect
 * second, and troubleshooting only after — the order people actually need it,
 * not the order it was built in.
 */

import Link from "next/link";

export const metadata = {
  title: "Setup · X Arcade",
  description: "Get X Arcade running beside your coding agent.",
};

const C = {
  panel: "#12141c",
  line: "#242938",
  text: "#cdd6ea",
  faint: "#6a7490",
  accent: "#7affba",
  amber: "#ffc260",
};

const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";

function Cmd({ children, accent }: { children: string; accent?: boolean }) {
  return (
    <pre
      style={{
        background: C.panel,
        border: `1px solid ${accent ? C.accent : C.line}`,
        borderRadius: 8,
        padding: "0.8rem 1.1rem",
        margin: "0.7rem 0",
        overflowX: "auto",
        color: accent ? C.accent : C.text,
        fontSize: "0.92rem",
      }}
    >
      <code>{children}</code>
    </pre>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", gap: "1rem", marginBottom: "2rem" }}>
      <div
        style={{
          flex: "0 0 1.9rem",
          height: "1.9rem",
          borderRadius: "50%",
          border: `1px solid ${C.line}`,
          display: "grid",
          placeItems: "center",
          color: C.amber,
          fontSize: "0.85rem",
        }}
      >
        {n}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 style={{ margin: "0.2rem 0 0.5rem", fontSize: "1rem" }}>{title}</h2>
        <div style={{ color: C.faint, fontSize: "0.87rem", lineHeight: 1.75 }}>{children}</div>
      </div>
    </section>
  );
}

export default function Setup() {
  return (
    <main style={{ fontFamily: mono, color: C.text, padding: "3rem 1.5rem", maxWidth: 720, width: "100%" }}>
      <Link href="/" style={{ color: C.faint, fontSize: "0.8rem", textDecoration: "none" }}>
        ← back to the boards
      </Link>

      <h1 style={{ letterSpacing: "0.2em", fontSize: "1.4rem", margin: "1.4rem 0 0.4rem" }}>SETUP</h1>
      <p style={{ color: C.faint, margin: "0 0 2.5rem", fontSize: "0.87rem" }}>
        About a minute. Needs Node 20+ and a terminal at least 84×27.
      </p>

      <Step n={1} title="Install">
        <Cmd accent>npx x-arcade hook --install</Cmd>
        That&apos;s the whole install. It copies the arcade to <code>~/.x-arcade/bin/</code> and wires it into your
        agent&apos;s hooks, so it keeps working after npm clears its cache. Nothing is installed globally.
      </Step>

      <Step n={2} title="Restart your agent">
        Hooks load when a session starts, so an already-running agent won&apos;t see them. Inside grok, run{" "}
        <code style={{ color: C.text }}>/hooks</code> to confirm — you should see five x-arcade entries.
      </Step>

      <Step n={3} title="Give it a task">
        The arcade opens beside your agent and asks for your X handle the first time. That handle is how you appear on
        the boards.
        <br />
        <br />
        When the agent finishes or needs approval, an amber bar appears in the arcade. It never steals focus — press any
        key to dismiss it and switch over when you&apos;re ready.
      </Step>

      <hr style={{ border: "none", borderTop: `1px solid ${C.line}`, margin: "2.5rem 0" }} />

      <h2 style={{ fontSize: "1rem", margin: "0 0 0.8rem" }}>If the pane doesn&apos;t open</h2>
      <p style={{ color: C.faint, fontSize: "0.87rem", lineHeight: 1.75, margin: 0 }}>
        Auto-open needs <a href="https://github.com/manaflow-ai/cmux" style={{ color: C.accent }}>cmux</a> (macOS) or
        tmux. This is a platform limit rather than a missing feature: on macOS, Ghostty exposes no way for an external
        process to split an existing window — no IPC, and its split action is keybinding-only. cmux is Ghostty
        underneath but adds a socket API, so it can.
        <br />
        <br />
        Everything else still works without them. Open the arcade yourself in any pane and the toast will still find it,
        because the two talk through a file rather than the terminal.
      </p>
      <Cmd>arcade pane --debug</Cmd>
      <p style={{ color: C.faint, fontSize: "0.87rem", margin: "0 0 2.5rem" }}>
        Prints what it detected and why it did or didn&apos;t open. Past attempts are logged to{" "}
        <code style={{ color: C.text }}>~/.x-arcade/pane.log</code>.
      </p>

      <h2 style={{ fontSize: "1rem", margin: "0 0 0.8rem" }}>Just want to play?</h2>
      <Cmd>npx x-arcade</Cmd>
      <p style={{ color: C.faint, fontSize: "0.87rem", margin: "0 0 2.5rem" }}>
        No agent, no hooks. Serpent works fully offline once the day&apos;s board is fetched.
      </p>

      <h2 style={{ fontSize: "1rem", margin: "0 0 0.8rem" }}>The rules</h2>
      <p style={{ color: C.faint, fontSize: "0.87rem", lineHeight: 1.75, margin: 0 }}>
        <strong style={{ color: C.text }}>Serpent</strong> — everyone gets the same maze and the same apple sequence
        each UTC day. Best of 3 runs; ties break on fewest ticks.
        <br />
        <br />
        <strong style={{ color: C.text }}>Prompt Golf</strong> — a secret target image is generated daily. Recreate it
        with the shortest prompt you can. A vision jury scores how close you got, then length scales it: a short prompt
        that gets close beats a long one that gets slightly closer. Three attempts a day. Other players&apos; prompts
        stay hidden until you&apos;ve used yours.
        <br />
        <br />
        Boards reset at 00:00 UTC.
      </p>

      <p style={{ color: C.faint, fontSize: "0.8rem", marginTop: "3rem" }}>
        <a href="https://github.com/Agrawal-Aakarsh/grok-arcade" style={{ color: C.accent }}>
          source
        </a>{" "}
        ·{" "}
        <a href="https://www.npmjs.com/package/x-arcade" style={{ color: C.accent }}>
          npm
        </a>
      </p>
    </main>
  );
}
