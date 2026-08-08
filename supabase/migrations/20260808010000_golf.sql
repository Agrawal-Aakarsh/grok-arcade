-- Prompt Golf.
--
-- Same posture as the initial schema: every table has RLS on with no policies,
-- so only the API (via DATABASE_URL) can reach any of it.

-- Generated images, stored as bytes rather than provider URLs.
--
-- xAI's docs are explicit that image URLs are temporary ("download or process
-- promptly"), and ghosts need yesterday's attempts to still render. Storing the
-- bytes is the only thing that actually survives. Supabase Storage would be the
-- scale answer; at three images per player per day, a bytea column costs one
-- fewer moving part and serves the Kitty protocol the raw bytes it needs.
create table if not exists images (
  id          text primary key,
  bytes       bytea not null,
  mime        text not null default 'image/jpeg',
  created_at  timestamptz not null default now()
);

alter table images enable row level security; -- server-only

-- One target per UTC day, shared by everyone.
create table if not exists golf_dailies (
  day            date primary key,
  -- The prompt Grok authored to make the target. Never exposed to players:
  -- it is the answer key.
  source_prompt  text,
  image_id       text references images (id),
  status         text not null default 'pending',
  claimed_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

alter table golf_dailies enable row level security; -- server-only

create table if not exists golf_attempts (
  id           text primary key,
  handle       text not null references handles (handle) on delete cascade,
  day          date not null,
  prompt       text not null,
  strokes      int not null,
  -- pending -> generating -> judging -> scored | failed
  status       text not null default 'pending',
  image_id     text references images (id),
  score        int,
  cleared      boolean,
  jury         jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  scored_at    timestamptz
);

alter table golf_attempts enable row level security; -- server-only

create index if not exists golf_attempts_handle_day_idx on golf_attempts (handle, day);

-- Ghost browsing and the daily board both want "best cleared attempt per player,
-- fewest strokes first".
create index if not exists golf_attempts_board_idx
  on golf_attempts (day, cleared, strokes asc, score desc)
  where status = 'scored';

-- Global spend ceiling. One row per UTC day, incremented before every paid
-- call. Per-handle limits cap individuals; this caps the bill.
create table if not exists generation_budget (
  day    date primary key,
  used   int not null default 0
);

alter table generation_budget enable row level security; -- server-only
