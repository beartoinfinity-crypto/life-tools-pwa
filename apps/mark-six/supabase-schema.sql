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

-- Traffic news table: cached items scraped from news.routejam.com
create table if not exists public.traffic_news (
  id text primary key,                -- routejam item id (md5 / RD# / IN- / DS-)
  posted_at timestamptz,              -- "2026年9月11日 下午02:58" -> ISO (HK, +08:00)
  category text,                      -- e.g. "道路事故-交通意外"
  status text,                        -- "最新情況" or "完結"
  location text,                      -- e.g. "西九龍公路,奧運港鐵站 [往西隧]" (can be empty)
  detail text,                        -- full message body
  source text,                       -- e.g. "香港電台" / "Routejam"
  lat double precision,               -- map marker (null when routejam has none)
  lng double precision,
  created_at timestamptz not null default now()
);

create index if not exists idx_traffic_news_posted on public.traffic_news (posted_at desc);

-- Music trend table: cached Apple Music chart playlists.
-- Each row is one playlist for one country, keyed "<cc>:<list>"
-- (e.g. 'hk:trending', 'tw:cantonese').
create table if not exists public.music_trend (
  list text primary key,                -- '<cc>:trending' | '<cc>:cantonese' | '<cc>:chinese'
  chart_title text,                     -- e.g. "熱門歌曲"
  updated_at_src text,                  -- Apple feed "updated" timestamp
  songs jsonb not null,                 -- [{rank,id,name,artist,artwork,...}]
  refreshed_at timestamptz,             -- when we scraped it
  created_at timestamptz not null default now()
);

-- My-playlist sync: user playlist name is the key, so the same name typed on
-- another device reloads the same songs (cross-device sync).
create table if not exists public.music_user_playlists (
  name text primary key,                -- user-chosen name of the playlist
  songs jsonb not null,                 -- [{rank,id,name,artist,artwork,youtubeId,...}]
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- ============================================================
-- Row Level Security (RLS)
-- The app uses the anon key (read/write). For a personal app
-- with only the publishable key, allow all operations on these
-- tables. If you switch to a service_role key, keep RLS off.
-- ============================================================

alter table public.draws enable row level security;
alter table public.meta enable row level security;
alter table public.traffic_news enable row level security;
alter table public.music_trend enable row level security;
alter table public.music_user_playlists enable row level security;

create policy "allow all invites" on public.draws
  for all using (true) with check (true);

create policy "allow all meta" on public.meta
  for all using (true) with check (true);

create policy "allow all traffic news" on public.traffic_news
  for all using (true) with check (true);

create policy "allow all music trend" on public.music_trend
  for all using (true) with check (true);

create policy "allow all music user playlists" on public.music_user_playlists
  for all using (true) with check (true);
