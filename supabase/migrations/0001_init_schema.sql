-- Shared House Booking Calendar — initial Postgres schema
-- ---------------------------------------------------------
-- Mirrors the current Google Sheet (Houses / Users / Bookings) but with
-- real types and constraints instead of parsed spreadsheet strings.
--
-- Access model: this schema is intentionally NOT exposed directly to the
-- browser. RLS is enabled with zero policies (see 0002_rls_deny_all.sql),
-- so the anon/authenticated Postgres roles can do nothing at all. Every
-- read and write goes through the Edge Function in
-- supabase/functions/api/, which holds the service-role key and performs
-- the exact same authorization checks Code.gs used to do (see
-- authenticate_() there). This keeps the migration close to a mechanical
-- port of working, already-tested logic, rather than a redesign around
-- Supabase's own JWT-based auth — see MIGRATION_README.md for why, and
-- how to switch to native Supabase Auth later if you want to.

create extension if not exists "pgcrypto"; -- for gen_random_uuid()

create table houses (
  id text primary key,               -- was HouseID, e.g. 'house1'
  name text not null
);

create table users (
  id uuid primary key default gen_random_uuid(),
  house_id text references houses(id),   -- null for admins, matching today's model
  name text not null unique,
  pin text not null,                     -- still plain text, intentionally — see Project brief.MD
  color text not null default '#6b6b6b',
  is_admin boolean not null default false,
  quota_nights integer not null default 0,
  email text unique,
  created_at timestamptz not null default now()
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  house_id text not null references houses(id),
  user_name text not null references users(name),  -- matches today's join-by-name model
  start_date date not null,
  end_date date not null,
  nights integer generated always as (end_date - start_date + 1) stored,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text not null default '',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  notified_at timestamptz,
  constraint min_nights check (end_date >= start_date + 6),   -- 7-night minimum
  constraint dates_sane check (end_date >= start_date)
);

create index bookings_house_status_idx on bookings (house_id, status);
create index bookings_user_idx on bookings (user_name);
create index bookings_dates_idx on bookings (start_date, end_date);

-- Exclusion constraint: the database itself refuses two active (pending or
-- approved) bookings in the same house with overlapping dates — the same
-- rule requestBooking() used to check in application code, now guaranteed
-- at the data layer too, even for a bug in the Edge Function.
create extension if not exists btree_gist;
alter table bookings add constraint no_overlapping_active_bookings
  exclude using gist (
    house_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status <> 'rejected');
