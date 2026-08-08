# X Arcade

**Daily mini-games for the dead minutes while your coding agent works.**

```bash
npx x-arcade
```

Your agent starts thinking. The arcade splits in beside it. You play. When the agent needs you, a toast appears — it never steals focus, you switch when you're ready.

Everyone plays the same maze and the same target image each UTC day, so the leaderboard compares something real.

**Live board:** https://grok-arcade-server-three.vercel.app

---

## The games

### Serpent
Snake as a daily speedrun. Same maze, same apple sequence, everyone. Best of 3 runs is your rank; tiebreak is fewest ticks. Fully playable offline once the day's config is fetched.

### Prompt Golf
A secret target image is generated each day. Recreate it with the shortest prompt you can. A vision jury compares your image to the target and scores fidelity 0–100; a length multiplier then scales it, so a short prompt that gets close beats a long one that gets slightly closer.

There is **no pass/fail bar** — that was the first design and playtesting killed it. Three faithful recreations scored 44, 52 and 55 against a bar of 70, and every one read as a failure with nothing to show. Ranking on length alone is the opposite failure: the empty prompt wins. The multiplier keeps both halves live.

You get 3 attempts a day. Other players' prompts stay hidden until you've used yours.

---

## Setup

```bash
npx x-arcade            # play
npx x-arcade login      # claim your X handle so runs count
npx x-arcade hook --install   # wire it into grok
```

Needs Node ≥ 20 and a terminal at least 84×27. Below that you get a "resize me" prompt rather than an error.

| Key | Action |
|---|---|
| arrows / `wasd` / `hjkl` | move |
| `Enter` | play / submit |
| `g` | ghosts (Golf) |
| `Esc` | back |
| `q` | quit |

---

## Agent integration

`arcade hook --install` writes `~/.grok/hooks/x-arcade.json`. Restart grok, then `/hooks` should list five entries.

| grok event | What happens |
|---|---|
| `UserPromptSubmit` | arcade splits in beside the agent |
| `Stop` | **agent ready** toast |
| `Notification` | **grok needs you — approval required** |
| `SubagentStop` / `StopFailure` | task complete / agent error |

**Auto-open needs cmux or tmux.** This is a hard platform limit, not a missing feature: on macOS Ghostty's only window CLI action is `+new-window`, which reports *"not supported on this platform"*; `new_split` exists solely as a keybinding action; and there's no IPC socket. **No external process can split a Ghostty window on macOS.** [cmux](https://github.com/manaflow-ai/cmux) is Ghostty underneath but exposes a Unix socket API, so it can — it's macOS-only. tmux is the cross-platform fallback.

Without either, everything else still works: open `arcade` in a pane yourself and the toast finds it.

Check what your setup supports:
```bash
arcade pane --debug
```

### Two hook systems — use the right one

grok has two, and picking wrong costs an afternoon:

| | `[[ui.notifications.hooks]]` in config.toml | `~/.grok/hooks/*.json` ← we use this |
|---|---|---|
| Focus gating | Two gates: global `condition` **and** per-hook `only_unfocused` | None |
| Visible to `/hooks` | No | Yes |
| File stability | grok rewrites config.toml through its own TOML serialiser, stripping comments | Ours alone |

We tried the notifications path first. It never fired, and worse, it was *unverifiable* — `/hooks` doesn't list it, so there was no way to distinguish "not loaded" from "loaded but gated".

---

## Development

```bash
npm install
npm run build
npm link --workspace packages/cli     # puts `arcade` on your PATH
npm test
```

**The server runs with zero configuration.** With no `DATABASE_URL` it uses an in-memory store implementing the same contract as Postgres, and with no `XAI_API_KEY` every provider falls back to a deterministic mock — so the entire Golf flow is exercisable offline and for free.

```bash
npm run dev --workspace packages/server   # http://localhost:3939
API_URL=http://localhost:3939 arcade
```

### Layout

```
packages/shared   pure rules — deterministic, no I/O, unit-tested
  serpent/        engine + six curated mazes (flood-fill verified)
  golf/           scoring: fidelity × brevity
packages/cli      raw-ANSI TUI, no framework
  term/           screen, cell buffer, input, Kitty images
  games/          serpent (quadrant renderer), golf
  pane.ts         cmux/tmux split-open
packages/server   Next.js — 9 routes, Postgres or in-memory
  lib/providers/  xAI image gen, vision jury, daily target pipeline
```

### Deploying

**Supabase** — put the connection URI in `packages/server/.env.local` as `DATABASE_URL`, using the **session** pooler (port 5432; advisory locks need a persistent session). Then:

```bash
npm run migrate --workspace packages/server
```

Every table has RLS on with **no policies** — only the API reaches the data.

**Vercel** — Root Directory `packages/server`. Env: `DATABASE_URL` (**transaction** pooler, port 6543 — serverless opens many short-lived connections), `SERVER_SALT`, `XAI_API_KEY`, `MAX_GENERATIONS_PER_DAY`.

The daily seed is `hash(day + SERVER_SALT)`. Without the salt, `seedForDay` — which ships inside the npm package — would let anyone compute next month's maze. **Set it once and never change it**; changing it mid-day re-rolls the maze and everyone's runs stop being comparable.

### Cost

~$0.16/player/day (3 images + 9 jury calls), plus ~$0.06/day for the target. `MAX_GENERATIONS_PER_DAY` is the global ceiling — per-handle limits cap individuals, only this caps the bill.

---

## Notes

Identity is honour-system: first claim on a handle wins and mints a device token, so nobody can overwrite your scores. X OAuth is the production path.

Run submission checks plausibility bounds only. A determined player can forge a believable score; the real fix is submitting the input log and replaying it server-side, which the engine is deterministic enough to support.

MIT.
