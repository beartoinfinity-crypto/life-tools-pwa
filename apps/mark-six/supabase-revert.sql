-- ============================================================
-- REVERT: undo supabase-schema.sql
-- Run this ONLY on the database where the schema was created
-- by mistake. It DELETES the tables and ALL their data.
--
-- WARNING: if this database already had real Mark Six data
-- (draws / meta) BEFORE the accidental run, dropping those
-- tables destroys it. Check first:
--   select count(*) from public.draws;
-- ============================================================

-- RLS policies (dropped automatically with the tables, but be explicit)
drop policy if exists "allow all invites" on public.draws;
drop policy if exists "allow all meta" on public.meta;
drop policy if exists "allow all traffic news" on public.traffic_news;

-- Indexes (also dropped with the tables; listed for completeness)
drop index if exists public.idx_draws_date;
drop index if exists public.idx_draws_draw;
drop index if exists public.idx_traffic_news_posted;

-- Tables
drop table if exists public.draws cascade;
drop table if exists public.meta cascade;
drop table if exists public.traffic_news cascade;
