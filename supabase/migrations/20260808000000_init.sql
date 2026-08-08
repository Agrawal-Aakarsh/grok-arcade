-- X Arcade initial schema.
--
-- Every table is server-only: RLS is enabled with no policies at all, so the
-- anon and authenticated Supabase roles can reach none of it. All access goes
-- through the API routes using DATABASE_URL. This is the posture the reference
-- project arrived at after a leak, and it is cheaper to start here than to
-- retrofit.

create table if not exists handles (
  handle      text primary key,
  token       text not null,
  created_at  timestamptz not null default now()
);

alter table handles enable row level security; -- server-only

create table if not exists serpent_runs (
  id          bigint generated always as identity primary key,
  handle      text not null references handles (handle) on delete cascade,
  day         date not null,
  apples      int not null,
  ticks       int not null,
  elapsed_ms  int not null,
  created_at  timestamptz not null default now()
);

alter table serpent_runs enable row level security; -- server-only

-- Leaderboard ordering: apples desc, then fewest ticks. Ticks rather than
-- wall-clock because ticks are engine-deterministic, so a laggy terminal
-- cannot cost you the tiebreak.
create index if not exists serpent_runs_board_idx
  on serpent_runs (day, apples desc, ticks asc);

-- Cheap lookup for "how many runs have I banked today".
create index if not exists serpent_runs_handle_day_idx
  on serpent_runs (handle, day);

-- Fixed-window rate limiting. Self-healing: a stale window is overwritten on
-- the next hit, so no cleanup job is needed.
create table if not exists rate_limits (
  key           text primary key,
  window_start  bigint not null,
  count         int not null
);

alter table rate_limits enable row level security; -- server-only
