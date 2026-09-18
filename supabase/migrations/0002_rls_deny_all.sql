-- Enable Row Level Security with zero policies on every table.
-- No policy = no access, for every role except the service key. The
-- Edge Function is the only door in; the anon key the browser holds can
-- reach the database only through it, never directly via PostgREST.
-- This is the safest possible default and needs no upkeep as rules change
-- — application logic changes live in the Edge Function, not in policies
-- that would otherwise have to be kept in sync with it by hand.

alter table houses enable row level security;
alter table users enable row level security;
alter table bookings enable row level security;
