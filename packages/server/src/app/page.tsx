/**
 * The landing page: install command, plus today's boards.
 *
 * The product is the terminal — this exists so a link you post is worth
 * clicking. Someone who has not installed anything should be able to see that
 * real people played today and that the scores are real.
 *
 * Server-rendered with no caching: a leaderboard that is thirty seconds stale
 * is worse than no leaderboard, because it silently loses the run someone just
 * finished and came here to see.
 */

import { cardFor, dayKey, puzzleNumber, timeUntilNextPuzzle } from "@x-arcade/shared";

import Link from "next/link";

import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const C = {
  bg: "#0b0d12",
  panel: "#12141c",
  line: "#242938",
  text: "#cdd6ea",
  faint: "#6a7490",
  accent: "#7affba",
  amber: "#ffc260",
};

const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";

function Board({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        border: `1px solid ${C.line}`,
        borderRadius: 10,
        background: C.panel,
        padding: "1.1rem 1.3rem",
        minWidth: 320,
        flex: "1 1 340px",
      }}
    >
      <h2 style={{ margin: 0, fontSize: "0.95rem", letterSpacing: "0.12em" }}>{title}</h2>
      <p style={{ margin: "0.2rem 0 1rem", color: C.faint, fontSize: "0.78rem" }}>{subtitle}</p>
      {children}
    </section>
  );
}

function Row({ rank, handle, value, detail }: { rank: number; handle: string; value: string; detail: string }) {
  const medal = ["①", "②", "③"][rank - 1];
  return (
    <li
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: "0.6rem",
        padding: "0.42rem 0",
        borderTop: rank === 1 ? "none" : `1px solid ${C.line}`,
        fontSize: "0.88rem",
      }}
    >
      <span style={{ color: medal ? C.amber : C.faint, width: "1.4rem" }}>{medal ?? rank}</span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>@{handle}</span>
      <span style={{ color: C.accent }}>{value}</span>
      <span style={{ color: C.faint, fontSize: "0.76rem", minWidth: "5.5rem", textAlign: "right" }}>{detail}</span>
    </li>
  );
}

function Empty({ what }: { what: string }) {
  return <p style={{ color: C.faint, fontSize: "0.83rem", margin: 0 }}>nobody has played {what} yet — be first</p>;
}

export default async function Home() {
  const day = dayKey();
  const store = getStore();

  // Never let a database hiccup take the whole page down; the install command
  // is the point, and an empty board still communicates "this is live".
  const [serpent, golf, breakout] = await Promise.all([
    store.leaderboard(day, 10).catch(() => []),
    store.golfBoard(day, 10).catch(() => []),
    store.breakoutBoard(day, 10).catch(() => []),
  ]);

  return (
    <main style={{ fontFamily: mono, color: C.text, padding: "3rem 1.5rem", maxWidth: 860, width: "100%" }}>
      <header style={{ textAlign: "center", marginBottom: "2.5rem" }}>
        <h1 style={{ letterSpacing: "0.24em", fontSize: "1.7rem", margin: 0 }}>X ARCADE</h1>
        <p style={{ color: C.faint, margin: "0.6rem 0 1.6rem" }}>
          daily mini-games for the dead minutes while your agent works
        </p>
        {/* One command. It installs the agent hooks, and the arcade asks for
            your handle the first time it opens — no second setup step. */}
        <code
          style={{
            display: "inline-block",
            padding: "0.85rem 1.6rem",
            border: `1px solid ${C.accent}`,
            borderRadius: 8,
            background: C.panel,
            fontSize: "1.1rem",
            color: C.accent,
          }}
        >
          npx x-arcade hook --install
        </code>
        <p style={{ color: C.faint, margin: "0.9rem 0 0", fontSize: "0.8rem", lineHeight: 1.7 }}>
          that&apos;s the whole setup. restart your agent — the arcade opens beside it
          <br />
          and asks for your handle the first time.
          <br />
          <span style={{ opacity: 0.7 }}>
            just want a look? <code style={{ color: C.text }}>npx x-arcade</code> ·{" "}
            <Link href="/setup" style={{ color: C.accent }}>
              full setup guide →
            </Link>
          </span>
        </p>
        <p style={{ color: C.faint, marginTop: "1.4rem", fontSize: "0.8rem" }}>
          #{puzzleNumber()} · {day} · next puzzle in {timeUntilNextPuzzle()}
        </p>
      </header>

      <div style={{ display: "flex", gap: "1.1rem", flexWrap: "wrap" }}>
        <Board title="SERPENT" subtitle="same maze, same apples, everyone. best of 3 runs.">
          {serpent.length === 0 ? (
            <Empty what="Serpent" />
          ) : (
            <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {serpent.map((entry, i) => (
                <Row
                  key={entry.handle}
                  rank={i + 1}
                  handle={entry.handle}
                  value={`${entry.apples} 🍎`}
                  detail={`${entry.ticks} ticks`}
                />
              ))}
            </ol>
          )}
        </Board>

        <Board title="PROMPT GOLF" subtitle="recreate the day's image. shortest prompt that nails it wins.">
          {golf.length === 0 ? (
            <Empty what="Golf" />
          ) : (
            <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {golf.map((entry, i) => {
                const card = cardFor({ prompt: entry.prompt, score: entry.score });
                return (
                  <Row
                    key={entry.handle}
                    rank={i + 1}
                    handle={entry.handle}
                    value={String(card?.final ?? "-")}
                    detail={`${entry.strokes} chars`}
                  />
                );
              })}
            </ol>
          )}
        </Board>
        <Board title="BREAKOUT" subtitle="10 levels, 10 power-ups. best score of the day.">
          {breakout.length === 0 ? (
            <Empty what="Breakout" />
          ) : (
            <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {breakout.map((entry, i) => (
                <Row
                  key={entry.handle}
                  rank={i + 1}
                  handle={entry.handle}
                  value={`${entry.score.toLocaleString()}`}
                  detail={`L${entry.level}${entry.cleared ? " · cleared" : ""}`}
                />
              ))}
            </ol>
          )}
        </Board>
      </div>

      <footer style={{ textAlign: "center", marginTop: "2.5rem", color: C.faint, fontSize: "0.78rem" }}>
        <p style={{ margin: 0 }}>
          {/* Deliberately not showing prompts here — the terminal gates them until
              you have used your own attempts, and the website must not be the
              back door around that. */}
          boards reset at 00:00 UTC · prompts stay hidden until you have played
          <br />
          <span style={{ opacity: 0.75 }}>Breakout contributed by @damien-xai · PRs welcome</span>
          <br />
          <span style={{ opacity: 0.75 }}>
            auto-open needs cmux or tmux · everywhere else, open the arcade yourself and the toast still finds it
          </span>
        </p>
      </footer>
    </main>
  );
}
