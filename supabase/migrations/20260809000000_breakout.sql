-- Breakout scores, shared rather than local-only.
--
-- The game arrived via PR storing runs in ~/.x-arcade/state.json, which is why
-- its in-game board is labelled "LOCAL". Same server-only posture as every
-- other table: RLS on, no policies, reachable only through the API.
--
-- Deliberately no runs-per-day cap. Serpent caps at 3 because everyone plays an
-- identical maze, so unlimited attempts would just reward whoever grinds
-- longest. Breakout is not date-seeded — there is no shared board to protect —
-- so the honest ranking is simply your best score of the day.

create table if not exists breakout_runs (
  id          bigint generated always as identity primary key,
  handle      text not null references handles (handle) on delete cascade,
  day         date not null,
  score       int not null,
  level       int not null,
  ticks       int not null,
  elapsed_ms  int not null,
  cleared     boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table breakout_runs enable row level security; -- server-only

-- Board ordering, matching compareBreakoutRuns in @x-arcade/shared:
-- score desc, then level desc, then fewest ticks.
create index if not exists breakout_runs_board_idx
  on breakout_runs (day, score desc, level desc, ticks asc);

create index if not exists breakout_runs_handle_day_idx
  on breakout_runs (handle, day);
