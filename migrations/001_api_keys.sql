-- Phase 1: API key infrastructure
-- Run against your Supabase project via the SQL editor or migration tool.

-- API keys table: stores hashed keys + plan metadata
create table if not exists api_keys (
  id                    uuid primary key default gen_random_uuid(),
  key_hash              text unique not null,        -- sha256(raw_key)
  key_prefix            text not null,               -- first 12 chars of raw key (for display)
  plan                  text not null default 'free',
  monthly_limit         integer not null default 1000,
  created_at            timestamptz default now(),
  revoked_at            timestamptz,
  stripe_customer_id    text,
  stripe_subscription_id text
);

-- Monthly usage tracking: one row per (key, month)
create table if not exists usage_monthly (
  key_id        uuid references api_keys(id) on delete cascade,
  month         text not null,    -- YYYY-MM
  request_count integer not null default 0,
  primary key (key_id, month)
);

-- Index for fast lookups by key_hash
create index if not exists idx_api_keys_key_hash on api_keys(key_hash);

-- Atomic usage increment: upsert row with server-side counter increment.
-- Called async (non-blocking) after each authenticated request.
create or replace function increment_usage(p_key_id uuid, p_month text)
returns void
language sql
as $$
  insert into usage_monthly (key_id, month, request_count)
  values (p_key_id, p_month, 1)
  on conflict (key_id, month)
  do update set request_count = usage_monthly.request_count + 1;
$$;

-- Row-Level Security: api_keys and usage_monthly should only be accessible
-- via service role key in the auth middleware. Enable RLS and deny anon access.
alter table api_keys enable row level security;
alter table usage_monthly enable row level security;

-- No anon policies — service role bypasses RLS automatically.
-- Add policies here if you need authenticated user access in future.
