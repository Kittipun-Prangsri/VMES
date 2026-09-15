-- VMES Supabase schema setup — run this ONCE in the Supabase SQL Editor
-- (Dashboard → SQL Editor → paste this whole file → Run)
--
-- Creates one JSONB document table per Firestore collection this app used,
-- so the backend can keep treating each row as a schemaless document keyed
-- by its original id/code field — no relational redesign needed.
-- RLS is enabled with zero policies (default-deny) on every table: only the
-- service_role key (used exclusively by the Vercel backend) can read/write,
-- mirroring the old firestore.rules posture of "no direct client access".

do $$
declare
  t text;
begin
  foreach t in array array[
    'vehicles','usage','maintenance','fuel','fuelQuota',
    'equipment','equipmentCategory','borrowing','users','drivers',
    'booking','inspection','notifications','audit','settings',
    'departments','userCredentials','serviceRequests','wifiQrLogs',
    'satisfactionRatings','attendance'
  ]
  loop
    execute format(
      'create table if not exists public.%I (
         id text primary key,
         data jsonb not null default ''{}''::jsonb,
         updated_at timestamptz not null default now()
       )', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
