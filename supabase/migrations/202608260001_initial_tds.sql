-- TDS MVP foundation. The browser never receives the service-role key.
-- All application access flows through the API, which evaluates team-specific authorization.

create extension if not exists pgcrypto;

create type public.account_status as enum ('inactive', 'active', 'suspended');
create type public.team_role as enum ('basic', 'moderator', 'admin');
create type public.team_status as enum ('active', 'archived');
create type public.workflow_state as enum (
  'captured', 'processing', 'processing_failed', 'awaiting_review',
  'published', 'rejected', 'archived'
);
create type public.knowledge_label as enum ('verified', 'unresolved', 'outdated', 'deprecated');
create type public.capture_command as enum ('document', 'update');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  webex_person_id text not null,
  email text not null,
  display_name text not null,
  status public.account_status not null default 'inactive',
  last_signed_in_at timestamptz,
  session_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, webex_person_id),
  unique (organization_id, email)
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  status public.team_status not null default 'active',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.team_memberships (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role public.team_role not null,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table public.source_spaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  provider text not null,
  provider_space_id text not null,
  display_name text not null,
  is_group_space boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, provider, provider_space_id)
);

create table public.team_space_policies (
  team_id uuid not null references public.teams(id) on delete cascade,
  source_space_id uuid not null references public.source_spaces(id) on delete cascade,
  basic_user_visibility boolean not null default false,
  staff_visibility boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (team_id, source_space_id),
  check (staff_visibility)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  source_space_id uuid not null references public.source_spaces(id),
  workflow_state public.workflow_state not null default 'captured',
  knowledge_label public.knowledge_label,
  transcript_visible_to_basic boolean not null default false,
  current_published_version_id uuid,
  rejected_at timestamptz,
  scheduled_purge_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.document_teams (
  document_id uuid not null references public.documents(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  primary key (document_id, team_id)
);

create table public.capture_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  document_id uuid references public.documents(id) on delete set null,
  source_space_id uuid not null references public.source_spaces(id),
  requested_by_user_id uuid not null references public.users(id),
  command public.capture_command not null,
  provider_event_id text not null,
  root_provider_message_id text not null,
  idempotency_key text not null,
  status text not null,
  safe_error_code text,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create table public.source_snapshots (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  capture_request_id uuid not null references public.capture_requests(id),
  sequence integer not null,
  transcript_sha256 text not null,
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (document_id, sequence)
);

create table public.source_messages (
  id uuid primary key default gen_random_uuid(),
  source_snapshot_id uuid not null references public.source_snapshots(id) on delete cascade,
  provider_message_id text not null,
  parent_provider_message_id text,
  author_provider_id text not null,
  author_display_name text not null,
  source_markdown text not null,
  sent_at timestamptz not null,
  ordinal integer not null,
  unique (source_snapshot_id, provider_message_id),
  unique (source_snapshot_id, ordinal)
);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  source_snapshot_id uuid not null references public.source_snapshots(id),
  version_number integer not null,
  title text not null,
  problem text not null,
  summary text not null,
  steps jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  evidence_map jsonb not null default '{}'::jsonb,
  moderator_notes text not null default '',
  created_by_user_id uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  unique (document_id, version_number)
);

alter table public.documents
  add constraint documents_current_version_fk
  foreign key (current_published_version_id) references public.document_versions(id);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  source_message_id uuid references public.source_messages(id) on delete set null,
  display_name text not null,
  storage_key text not null unique,
  mime_type text not null,
  byte_size bigint not null check (byte_size between 1 and 26214400),
  sha256 text not null,
  security_status text not null default 'pending_scan',
  removed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.favorites (
  user_id uuid not null references public.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, document_id)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  actor_user_id uuid references public.users(id),
  action text not null,
  target_type text not null,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index documents_library_idx on public.documents (organization_id, workflow_state, updated_at desc);
create index document_teams_team_idx on public.document_teams (team_id, document_id);
create index team_memberships_user_idx on public.team_memberships (user_id, team_id, role);
create index source_messages_search_idx on public.source_messages using gin (to_tsvector('english', source_markdown));
create index document_versions_search_idx on public.document_versions using gin (
  to_tsvector('english', title || ' ' || problem || ' ' || summary)
);

-- Direct table access is denied to browser roles. The API uses the server-only service role,
-- re-checks account status and team grants for every resource, and returns only allowed fields.
alter table public.organizations enable row level security;
alter table public.users enable row level security;
alter table public.teams enable row level security;
alter table public.team_memberships enable row level security;
alter table public.source_spaces enable row level security;
alter table public.team_space_policies enable row level security;
alter table public.documents enable row level security;
alter table public.document_teams enable row level security;
alter table public.capture_requests enable row level security;
alter table public.source_snapshots enable row level security;
alter table public.source_messages enable row level security;
alter table public.document_versions enable row level security;
alter table public.attachments enable row level security;
alter table public.favorites enable row level security;
alter table public.audit_events enable row level security;

revoke all on all tables in schema public from anon, authenticated;

