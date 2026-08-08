# X Arcade — Build Spec v3

Terminal-native daily mini-games for the dead minutes while a coding agent works.
Two games: **Serpent** (the product) and **Prompt Golf** (the demo). X-handle leaderboards, date-seeded so everyone plays the same content.

`npx x-arcade` is the entire install story. (`x-arcade` is free on npm; `arcade` is taken.)

---

## Context: what changed from v2

Three findings reshaped the plan.

1. **`grok` already has hooks.** v2 §6 step 8 specced a node-pty wrapper to detect agent state. Unnecessary — `grok` ships notification hooks (`turn_complete`, `approval_required`, `session_ready`, `task_complete`, `agent_error`) plus a 14-event lifecycle system. Integration is ~6 lines of TOML and a `arcade notify` subcommand. **The PTY wrapper is deleted from scope.**
2. **Golf scoring switched to bar + strokes.** v2's `jury × clamp(1.25 − chars/320, …)` had three constants to tune. The reference project already ships the better rule: the jury only decides whether you **cleared a bar**, and among those who cleared, **fewest characters wins**. One constant, truer metaphor, better stage line — *"a 71 in 17 strokes beats a 98 in 62."*
3. **xAI image URLs are temporary.** Docs: *"URLs are temporary, so download or process promptly."* Ghosts need images alive for a full day, so generation must request `b64_json` and persist to Supabase Storage. This was not in v2 and is load-bearing.

---

## API facts (verified against docs.x.ai)

**Image generation** — `POST https://api.x.ai/v1/images/generations`

| | |
|---|---|
| Models | `grok-imagine-image` ($0.02/img) · `grok-imagine-image-quality` ($0.05/img) |
| Params | `model`, `prompt`, `n` (≤10), `aspect_ratio`, `resolution` (`1k`\|`2k`), `response_format` (`url`\|`b64_json`) |
| Response | `{ data: [{ url }] }` or `{ data: [{ b64_json }] }` |
| ⚠️ | **URLs are temporary.** Always request `b64_json`, persist to Supabase Storage. |

**Vision (jury)** — `grok-4.5`, 20MiB/image, jpg+png, at `https://api.x.ai/v1`.
Both `/chat/completions` (classic `image_url`) and `/responses` (`input_image`) work. Use `/chat/completions` — that's what the reference jury already speaks.

**No SDK, and nothing named OpenAI in the tree.** There is no official xAI TypeScript SDK: `@xai-org/sdk` doesn't exist, `xai-sdk` on npm is a 306-byte alpha squatted by a private individual, and `xai` is an xAI-owned name reservation reading "coming soon". The official SDK is Python-only. So every call is raw `fetch` against `api.x.ai` — which is also exactly what the reference project does (its deps are fal, supabase, stripe, postgres, posthog; **no `openai` package is installed there either**).

"OpenAI-compatible" in xAI's docs describes a *wire format* — `/v1/chat/completions` accepts the same JSON body shape — not a dependency. The reference project's env vars are merely *named* `OPENAI_*` as legacy. **Rename on port:** `XAI_API_KEY`, `XAI_BASE_URL=https://api.x.ai/v1`, `JUDGE_MODEL=grok-4.5`, `IMAGE_MODEL=grok-imagine-image`. Net result: 100% xAI endpoints, 100% xAI models, zero third-party AI dependencies.

**Structured outputs** — `response_format: {type:"json_schema", json_schema:{strict:true,…}}` supported on grok-4.5. Supports a *practical subset* of JSON Schema: `maxLength` ≤2048, `maxItems` ≤256, limited regex (no lookahead/backrefs), and `not`/`if-then-else`/multi-`allOf` accepted but **not enforced**. Keep `VERDICT_SCHEMA` flat.

**Cost model** — ~$0.16/player/day (3 images @ $0.02 + 9 jury votes) + ~$0.06/day flat for the daily target. 50 players ≈ $8/day.
→ Ship a global daily generation budget kill-switch (`MAX_GENERATIONS_PER_DAY`). Per-handle limits don't cap the total; this does.

---

## Key handling (non-negotiable)

The xAI key is **server-side only** and never enters the repo, the client, or this chat.

- Every provider defaults to `mock` (copied from the reference project's discipline). `npm run dev` with zero env is a fully working game with deterministic fake images and a hash-based fake jury. All development and all tests run on mocks.
- The real key lives in exactly two places, both operator-entered: `.env.local` (gitignored) and Vercel env vars.
- Live checks that need a real call are run by the operator, who reports the **response shape**, not the key.

---

## Architecture

```
npx x-arcade (npm, TS, ESM)  ──HTTPS──>  Next.js API routes on Vercel
  packages/cli                              packages/server
    · raw-ANSI TUI shell                      · Supabase Postgres (game data via postgres.js)
    · Serpent renderer + input                · Supabase Storage (image persistence)
    · kitty graphics + ASCII fallback         · xAI key lives HERE ONLY
    · arcade notify (hook receiver)           · grok-4.5 (jury vision, daily authoring)
  packages/shared                             · grok-imagine-image (targets + attempts)
    · Serpent engine (pure, seed→state)
    · scoring rules, day math, types
```

**Decisions locked:**

- **Raw ANSI, no Ink.** Kitty graphics escape sequences inside a React reconciler is a fight (Ink redraws clobber the image placement). A 40×20 half-block grid plus a few text screens is ~200 lines of a tiny `Screen` abstraction with full control over the alternate screen buffer, cursor positioning, and image passthrough. Input via `readline` raw mode.
- **npm workspaces**, not pnpm (not installed; one less dependency).
- **Serverless → async Golf attempts.** `POST /golf/attempt` inserts `status=pending`, returns `{id}`; generation + judging run in `after()`; client polls `GET /golf/attempt/:id` every 2s. All 3 jury votes in parallel.
- **Dev against the deployed URL from Part 2 onward**, so deployment is never a surprise at the end. `API_URL` env-overridable.
- **Identity:** `arcade login` takes an X handle + mints a random device token. First claim wins; later logins to a claimed handle need the token. Honor system, documented as such. README notes X OAuth as the production path.

**Lifted wholesale from `prompt-duel-selfhosted-main`** (paths relative to its root):

| What | Where | Notes |
|---|---|---|
| Vision jury | `src/lib/providers/jury.ts` (613 lines, self-contained, raw `fetch`, has tests) | Port = point its base URL at `api.x.ai/v1`, set `grok-4.5`, and rename its `OPENAI_*` env vars to `XAI_*`. Keeps: 3 votes @ temp 0.6, per-criterion median, anchored rubric, defect penalties, retry ladder, `spread`. |
| Golf rules | `src/lib/game/engine/scoring.ts` | `strokesOf`, `golfWinner`, `golfCardOf`, `SCORE_BAR = 70` |
| Daily claim pattern | `src/lib/providers/daily.ts`, `src/lib/store/postgres/daily.ts` | First request of the day claims the row (`on conflict do nothing returning`), others poll; stale claims reclaimed at 45s; `warmNextDay` pre-resolves tomorrow. **No cron.** |
| `after()` job discipline | `src/lib/game/service.ts:193` | A dangling `void runJob()` is not tracked by `waitUntil` → instance freezes → chained jobs stall. Every job goes through `after()`. |
| Rate limiter | `src/lib/store/postgres/misc.ts:89`, `src/lib/api/helpers.ts` | Atomic fixed-window upsert. Keyed on IP + userId, **deliberately not** the client-supplied id (rotatable). Fails open. |
| Migration runner | `scripts/migrate.mjs` | Plain SQL files + `schema_migrations` + advisory lock. Not the Supabase CLI. |
| RLS posture | `20260721000000_lockdown_client_grants.sql` | Server-only tables: RLS on, zero policies. Column-level grants elsewhere. |

**Not lifted:** rooms, matchmaking, ELO, wagering, Stripe, the tick loop. Golf here is async daily, not 1v1.

---

## Games

### Serpent — the product
Snake as a daily speedrun; same maze and apple sequence for everyone.
- 40×20 logical grid, half-block rendering, arrows/WASD/hjkl, `r` = instant restart.
- Daily seed = `hash(date + server_salt)` from the server → deterministic PRNG drives the apple sequence. Walls arrive resolved from the server.
- Speed +1 tier per 5 apples. Score = apples, tiebreak elapsed asc. **Best of 3 runs** = your daily rank. Practice after, unranked.
- **Curated maze list from day one.** v2 specced Grok-generated mazes with a flood-fill verifier; cut. Grok is already in the loop twice for Golf, and generate→verify→repair on snake walls is a redundant pitch line costing a real hour.
- Fully offline after the daily fetch — the safe demo opener if wifi is shaky.

### Prompt Golf — the demo
Recreate the daily target image with the shortest prompt.
- **Flow:** target renders inline → prompt editor with live stroke counter → `POST /golf/attempt` → generate → jury → result screen beside the target.
- **Scoring:** jury `total` ≥ `SCORE_BAR` (70) = **cleared**. Among cleared, fewest characters wins. Nobody cleared → closest to the pin. 70 sits above the rubric's 41–60 "wrong scene" band and below 81–95 "faithful", so clearing means something.
- **3 attempts/day**, sequential, best counts. This is also the cost ceiling.
- **Daily target:** grok-4.5 authors a secret source prompt (1 subject, 1–2 style attrs, no text/people/IP) → `grok-imagine-image-quality` renders once → grok-4.5 vision sanity-checks the render against its own prompt (regen if not) → persisted to Storage, canonical for everyone. Source prompt never exposed.
- **Ghosts:** after your 3 attempts, browse others' best (image + prompt + strokes) beside the target. This is the multiplayer. Make it the polished screen.
- Latency 10–30s → spinner with rotating status lines, inside the game panel only.

---

## Build parts

Each part ends with something demonstrable. Parts 0–1 are keyless and unblocked.

### Part 0 — Scaffold + live-API smoke test
Monorepo (`packages/{cli,server,shared}`), TS strict, ESM, vitest, `.gitignore` covering `.env*`.
Ship `scripts/smoke.mjs` — reads `XAI_API_KEY` from the operator's env, makes one image call and one vision call, prints **response shapes only, key never echoed**.
*Operator runs it and reports back.* Confirms: model ids, b64 round-trip, structured-output conformance, real latency.
**Done when:** smoke output confirms both calls, or names the exact failure.

### Part 1 — Serpent, fully local, keyless
Pure engine in `shared` (seed in → state out, no I/O, unit-tested). Renderer + input + local score screen in `cli`. Curated mazes.
**Done when:** `node packages/cli/dist/index.js serpent` is a playable, deterministic game.

### Part 2 — Server, deployed, Serpent ranked
Next.js + Supabase schema (`handles`, `dailies`, `serpent_runs`) + migration runner. Routes: `POST /login`, `GET /daily`, `POST /serpent/run`, `GET /leaderboard`. Rate limiter. **Deploy to Vercel immediately**; client points at the deployed URL from here on.
**Done when:** two handles on two machines appear on one board.

### Part 3 — Golf backend (mocks first, then live)
Provider abstraction (`generate.ts` with `mock` | `xai`, forcing `b64_json` → Supabase Storage). Jury ported. Daily target pipeline with the claim pattern. Async attempt: insert pending → `after()` → poll. 3 votes parallel. Kill-switch.
**Done when:** the full attempt lifecycle works over curl against the deployed server.

### Part 4 — Golf TUI
Kitty graphics with capability detection + ASCII-luminance fallback + open-in-browser URL. Prompt editor with stroke counter. Result screen showing cleared/strokes.
⚠️ Must be verified in Ghostty — this dev environment is `TERM_PROGRAM=vscode`, no kitty support.
**Done when:** a full Golf round is playable end to end in Ghostty.

### Part 5 — Ship
Ghosts screen → `arcade notify` + hooks TOML → share cards → publish to npm → verify `npx x-arcade` in a clean container.

**Cut order if behind:** share cards → ghosts → hooks integration (README split-pane note is the acceptable floor).
**Never cut:** date-seeding, the shared hosted leaderboard, Golf's 3-attempt flow, the inline-image moment.

---

## grok integration (was §6 step 8, now ~6 lines)

```toml
# ~/.grok/config.toml
[[ui.notifications.hooks]]
command = "arcade notify"
events = ["turn_complete", "approval_required", "task_complete", "agent_error"]
only_unfocused = true
```

Hook env: `$GROK_EVENT`, `$GROK_MESSAGE`, `$GROK_SESSION_ID`. `idle_threshold_secs` (default 3) gates on terminal focus loss.
`arcade notify` appends one line to `~/.x-arcade/events`; the running TUI tails it and draws the toast. Never steals focus, dismissed by any key. In tmux, the hook command can run `tmux split-window` itself — pane behavior comes free.

Prior art worth citing on stage: `grok` ships `/gboom`, a DOOM raycaster streaming kitty-graphics frames at ~30fps inside its pager. Its source also documents the one terminal-game gotcha — terminals emit no key-release events, so it uses a 0.16s hold window. Serpent dodges this (discrete turns), but any continuous-movement game hits it.

---

## Risks

| Risk | Mitigation |
|---|---|
| xAI image URLs expire before ghosts render | `b64_json` → Supabase Storage at generation time. Designed in, not bolted on. |
| Kitty rendering unverifiable in this dev env | Build the ASCII fallback first and well; operator verifies Ghostty at Part 4. |
| Jury latency blows the demo | `after()` + polling means the TUI never blocks. Pre-test the demo attempt that morning. |
| Cost runaway | 3/day per handle + IP rate limit + global `MAX_GENERATIONS_PER_DAY` kill-switch. |
| Daily target is bad/ugly | Vision sanity-check with regen. Reserve daily behind `USE_RESERVE=1`. |
| Network dies on stage | Serpent is fully offline after fetch — open with it. Phone hotspot backup. |
