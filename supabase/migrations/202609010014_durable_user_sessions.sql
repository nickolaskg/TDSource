-- Durable, revocable user sessions. The browser holds only a random opaque
-- token; Webex credentials remain encrypted server-side. Current and previous
-- token hashes support safe periodic rotation without breaking concurrent
-- browser requests.
create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  current_token_hash text not null unique check (current_token_hash ~ '^[a-f0-9]{64}$'),
  previous_token_hash text unique check (previous_token_hash is null or previous_token_hash ~ '^[a-f0-9]{64}$'),
  previous_token_valid_until timestamptz,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text not null,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  webex_subject text not null,
  email text not null,
  display_name text not null,
  avatar_url text,
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  token_rotated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  refresh_claimed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email=lower(btrim(email))),
  check (idle_expires_at<=absolute_expires_at),
  check (access_expires_at<=refresh_expires_at),
  check ((previous_token_hash is null)=(previous_token_valid_until is null))
);

create index if not exists user_sessions_user_active_idx
  on public.user_sessions(user_id,absolute_expires_at)
  where revoked_at is null;
create index if not exists user_sessions_previous_token_idx
  on public.user_sessions(previous_token_hash)
  where previous_token_hash is not null;
create index if not exists user_sessions_expiration_idx
  on public.user_sessions(absolute_expires_at,idle_expires_at)
  where revoked_at is null;

alter table public.user_sessions enable row level security;
revoke all on public.user_sessions from anon,authenticated;

create or replace function public.claim_user_session_refresh(p_session_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_claimed boolean:=false;
begin
  update public.user_sessions
    set refresh_claimed_at=now(),updated_at=now()
    where id=p_session_id and revoked_at is null
      and idle_expires_at>now() and absolute_expires_at>now()
      and (refresh_claimed_at is null or refresh_claimed_at<now()-interval '2 minutes')
    returning true into v_claimed;
  return coalesce(v_claimed,false);
end $$;

revoke all on function public.claim_user_session_refresh(uuid) from public,anon,authenticated;
grant execute on function public.claim_user_session_refresh(uuid) to service_role;
