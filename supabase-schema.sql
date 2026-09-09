-- ============================================================
-- Supabase schema for Mark Six PWA
-- Run this in the Supabase SQL Editor (Dashboard -> SQL Editor)
-- ============================================================

-- Draws table: stores each draw result
create table if not exists public.draws (
  id bigint generated always as identity primary key,
  draw text not null unique,          -- e.g. "26/089"
  date text not null,                 -- ISO date "2026-08-15"
  numbers text not null,              -- JSON array of 6 main numbers
  special integer,                    -- extra number
  source text,                        -- "lotteryextreme", "lottery.hk", "github"
  created_at timestamptz not null default now()
);

create index if not exists idx_draws_date on public.draws (date);
create index if not exists idx_draws_draw on public.draws (draw);

-- Meta table: key/value store (e.g. lastRefresh timestamp)
create table if not exists public.meta (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- Row Level Security (RLS)
-- The app uses the anon key (read/write). For a personal app
-- with only the publishable key, allow all operations on these
-- tables. If you switch to a service_role key, keep RLS off.
-- ============================================================

alter table public.draws enable row level security;
alter table public.meta enable row level security;

create policy "allow all invites" on public.draws
  for all using (true) with check (true);

create policy "allow all meta" on public.meta
  for all using (true) with check (true);
