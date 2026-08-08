# X Arcade

Terminal-native daily mini-games for the dead minutes while your coding agent works.

Everyone plays the same maze and the same apple sequence each UTC day, so the leaderboard actually compares something.

**Status:** Part 1 of 6. Serpent is playable and fully offline. Prompt Golf, the hosted leaderboard, and the `grok` hook integration are still to come — see `SPEC.md`.

---

## Try it

```bash
npm install
npm run build
npm link --workspace packages/cli   # puts `arcade` on your PATH
```

Then:

```bash
arcade              # menu
arcade serpent      # straight into today's Serpent
arcade hook         # wire the agent-ready toast into grok
```

Without the `npm link` step there is no `arcade` command — use `node packages/cli/dist/index.js` instead. Undo it with `npm unlink -g x-arcade`.

Needs Node ≥ 20 and a terminal at least **84×27**. Below that you get a "resize me" prompt that redraws automatically rather than an error.

### Controls

| Key | Action |
|---|---|
| arrows / `wasd` / `hjkl` | move |
| `r` | end run (ranked) or restart (practice) |
| `Enter` | start the next run |
| `Esc` | back to the menu |
| `q` / Ctrl-C | quit |

Your first **3 runs** each day are ranked; best of the three counts. Everything after that is unranked practice. Local scores live in `~/.x-arcade/state.json` — delete it to reset your day.

---

## What to look for when testing

Run it in **Ghostty**, not the VS Code terminal — Part 4 depends on the Kitty graphics protocol and it's worth confirming the colours look right in the terminal that will host the real thing.

- Each game cell is **two characters wide by one tall**, carrying a 2×2 quadrant glyph — a 4×2 subpixel mask per cell. Cells should look roughly square, and the snake should read as a continuous ribbon: rounded on the outside of every turn, tapered at the tail, with a nose on the head.
- The snake should fade from bright green at the head to dark at the tail.
- Speed should step up noticeably every 5 apples, and the segment bar in the HUD should light up with it.
- Eating should fire a shockwave ring and a floating `+1`. Dying should strobe the body white/red and shake the panel.
- `Esc` and `q` must always return your shell to normal — cursor visible, no leftover colour. If the terminal is ever left broken, that's a bug worth reporting immediately.
- Today's maze is printed in the header next to the date.

There are six curated mazes (`open`, `pillars`, `lanes`, `corners`, `diamond`, `gates`); the day's seed picks one. To preview them all:

```bash
node --input-type=module -e "
import {buildMaze,MAZE_COUNT,isPlayable} from './packages/shared/dist/index.js';
for(let i=0;i<MAZE_COUNT;i++){const m=buildMaze(i);console.log(m.name,JSON.stringify(isPlayable(m)));}
"
```

---

## The server

Four routes, in `packages/server`:

| Route | Purpose |
|---|---|
| `POST /api/login` | Claim an X handle, mint a device token |
| `GET /api/daily` | Today's seed + maze index |
| `POST /api/serpent/run` | Submit a ranked run (best of 3/day) |
| `GET /api/leaderboard` | Today's board |

**It runs with zero configuration.** With no `DATABASE_URL` it uses an in-memory store implementing the same contract as the Postgres one — so the whole API is testable without a database anywhere near it.

```bash
npm run dev --workspace packages/server     # http://localhost:3939
API_URL=http://localhost:3939 arcade        # point the CLI at it
```

The daily seed is `hash(day + SERVER_SALT)`, and the salt lives only on the server. Without it the CLI can derive a deterministic board but not *the* board — that's what stops future mazes being datamined out of the published npm package. You can see it working: locally the CLI picks maze `gates`, against the server it picks `corners`.

Serpent stays fully playable offline. If the server is unreachable the CLI falls back to a local salt-free daily and marks the session unranked, rather than refusing to start.

### Deploying

**Supabase** — create a free project, then put the connection URI in `.env.local` at the repo root:

```
DATABASE_URL=postgresql://...
```

Use the **session** pooler (port 5432) for migrations; the transaction pooler (6543) is for runtime, which is why the store sets `prepare: false`. Then:

```bash
npm run migrate --workspace packages/server           # apply
node scripts/migrate.mjs --check                      # CI drift guard
```

Migrations are plain SQL applied in filename order, tracked in `schema_migrations`, serialised behind an advisory lock — Vercel can build two deploys concurrently and they'd otherwise race. Not the Supabase CLI, so nothing needs installing but Node.

Every table has RLS enabled with **no policies at all**, so the anon and authenticated roles reach none of it. All access goes through the API with `DATABASE_URL`.

**Vercel** — import the repo and set **Root Directory → `packages/server`** (the setting people miss in a monorepo). Add `DATABASE_URL` and `SERVER_SALT` (any random string) as env vars. Then bake the deployed URL into `API_URL` in `packages/cli/src/api.ts`.

## The grok toast

When your agent finishes a turn or needs approval, a toast appears on the arcade's top border. Any key dismisses it. It never steals focus and never interrupts a run.

```bash
arcade hook              # status + the JSON that gets written
arcade hook --install    # writes ~/.grok/hooks/x-arcade.json
arcade hook --uninstall
```

Restart grok afterwards (hooks load at session start), then run `/hooks` inside grok — the Hooks tab should list four entries.

**Test it without grok:** run `arcade`, then from another window:

```bash
arcade notify --event approval_required
```

The toast shows on both the menu and the Serpent panel.

### Use the lifecycle hooks, not the notification hooks

grok has **two independent hook systems** and picking the wrong one costs an afternoon:

| | `[[ui.notifications.hooks]]` in config.toml | `~/.grok/hooks/*.json` ← we use this |
|---|---|---|
| Focus gating | Two gates: global `condition` **and** per-hook `only_unfocused` | None |
| Visible to `/hooks` | No | Yes |
| File stability | grok rewrites config.toml through its own TOML serialiser, stripping comments | Ours alone |
| Trust | n/a | Global hooks always trusted |

We tried the notifications path first and it never fired. Worse, it was unverifiable: `/hooks` doesn't list it, so there was no way to tell "not loaded" from "loaded but gated". The lifecycle path is verifiable, which matters more than elegance.

Events mapped: `Stop` → agent ready, `Notification` → approval required, `SubagentStop` → task complete, `StopFailure` → agent error.

**Absolute, unquoted paths.** `arcade notify` only resolves if the package is globally installed, grok's hook environment may not carry nvm's `node`, and the command isn't guaranteed to be shell-evaluated — so quoting can break it. The installer writes the full path to the entry point.

The transport is a file append (`~/.x-arcade/events`) polled by the running arcade — no daemon, no socket, no port, and a no-op when no arcade is running.

## Tests

```bash
npm test        # engine determinism, maze reachability, input buffering
npm run build   # typecheck both packages
```

The maze tests are load-bearing: they assert every motif is ≥85% reachable with zero one-cell dead ends, and that none of them walls off the spawn lane. All three caught real bugs during the first build.

---

## API keys

**You do not need one to play, and neither will anyone else.**

Serpent is pure local computation — no key, no network. Prompt Golf (Part 3) needs xAI for image generation and vision judging, but those calls happen **server-side only**: one key on the server pays for every player, so `npx x-arcade` stays a zero-config install for your friends.

For local server dev and `npm run smoke`, the key is read straight from your shell environment, exactly like `grok` does:

```bash
XAI_API_KEY=... npm run smoke
```

`.env.example` documents the server's variables; it is a reference, not a required setup step. Nothing reads a key from disk unless you choose to create `.env.local`, and `.env*` is gitignored.

---

## Layout

```
packages/shared   pure engine — deterministic, no I/O, unit-tested
  rng.ts            seeded PRNG + FNV-1a hashing
  day.ts            UTC day math
  serpent/mazes.ts  six curated motifs + flood-fill playability check
  serpent/engine.ts the game rules

packages/cli      the TUI — raw ANSI, no framework
  term/ansi.ts     escape sequences
  term/screen.ts   alt screen, raw mode, guaranteed teardown
  term/buffer.ts   cell buffer with double-width character handling
  term/input.ts    key decoding
  games/render.ts  quadrant-subpixel board renderer + palette
  games/serpent.ts loop, input, chrome, best-of-3
  ui/menu.ts       the arcade menu
  events.ts        grok hook → running arcade (file append + poll)
  hook.ts          `arcade hook [--install]`
  store.ts         ~/.x-arcade/state.json

scripts/smoke.mjs live xAI API contract check (Part 0)
SPEC.md           the full build plan
```
