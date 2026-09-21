-- One replaceable organization capture identity for webhook-driven automation.
-- OAuth token values are encrypted by the Worker before they reach this table.

create table public.webex_capture_identities (
  organization_id uuid primary key references public.organizations(id),
  user_id uuid not null unique references public.users(id),
  access_token_ciphertext text not null,
  refresh_token_ciphertext text not null,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz,
  webhook_id text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.webex_capture_identities enable row level security;
revoke all on public.webex_capture_identities from anon, authenticated;

