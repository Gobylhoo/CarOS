-- ============================================================
-- CarOS — Supabase schema + Row Level Security
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query).
-- ============================================================

-- ---------- TABLES ----------
create table if not exists families (
  code                    text primary key,
  name                    text not null,
  combined_budget_monthly int  default 0,
  plan                    jsonb,
  api_key                 text,
  created_at              timestamptz default now()
);

create table if not exists members (
  id                     uuid primary key default gen_random_uuid(),
  family_code            text references families(code) on delete cascade,
  name                   text not null,
  age                    int,
  role                   text,
  can_drive              text,
  commute_miles_week     int,
  lease_vs_buy           text,
  insurance_tier         text,
  priorities             jsonb default '[]',
  preferences            text,
  personal_budget_monthly int,
  matched                jsonb default '[]',
  chat                   jsonb default '[]'
);

create table if not exists cars (
  id          uuid primary key default gen_random_uuid(),
  family_code text references families(code) on delete cascade,
  make        text,
  model       text,
  year        int,
  driver      text,
  mileage     int,
  condition   text,
  status      text default 'owned'
);

create index if not exists members_family_idx on members(family_code);
create index if not exists cars_family_idx    on cars(family_code);

-- ============================================================
-- ROW LEVEL SECURITY
--
-- The app sends the active family code in a request header
-- (x-family-code). These policies restrict every row to the
-- family whose code is in that header, so one family can never
-- read or write another family's data with the public anon key.
--
-- Helper: read the header off the PostgREST request context.
-- ============================================================
create or replace function current_family_code()
returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.headers', true)::json ->> 'x-family-code', ''),
    ''
  );
$$;

alter table families enable row level security;
alter table members  enable row level security;
alter table cars     enable row level security;

-- ---------- families ----------
-- Anyone may create a family (needed for first-time setup).
drop policy if exists families_insert on families;
create policy families_insert on families
  for insert with check (true);

-- You may read / update / delete only the family whose code you carry.
drop policy if exists families_rw on families;
create policy families_rw on families
  for select using (code = current_family_code());

drop policy if exists families_update on families;
create policy families_update on families
  for update using (code = current_family_code());

drop policy if exists families_delete on families;
create policy families_delete on families
  for delete using (code = current_family_code());

-- ---------- members ----------
drop policy if exists members_all on members;
create policy members_all on members
  for all
  using (family_code = current_family_code())
  with check (family_code = current_family_code());

-- ---------- cars ----------
drop policy if exists cars_all on cars;
create policy cars_all on cars
  for all
  using (family_code = current_family_code())
  with check (family_code = current_family_code());

-- ============================================================
-- NOTE on the "join by code" flow:
-- When a new person enters a family code on the landing page,
-- the app sets that code as the header and SELECTs the family.
-- The families_rw policy lets the read through because the
-- header matches the row's code. This is intentionally a
-- "shared secret" model — knowing the 6-char code grants access,
-- which suits a family tool. For stronger guarantees later,
-- add Supabase Auth and tie families to user IDs.
-- ============================================================

-- If you created the tables before api_key existed, run:
-- alter table families add column if not exists api_key text;
-- Budget feature columns (run if upgrading an existing DB):
alter table members add column if not exists costs jsonb default '{}';
alter table members add column if not exists want_monthly int;
