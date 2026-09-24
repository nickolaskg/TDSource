-- Activate versioned vector indexing without exposing chunks to browser roles.
-- Rollback: drop the trigger/function and replace_knowledge_chunks, then drop
-- the three metadata columns. Existing knowledge_chunks rows may be retained.

alter table public.knowledge_chunks
  add column if not exists embedding_model text,
  add column if not exists content_hash text,
  add column if not exists indexed_at timestamptz not null default now();

create table if not exists public.knowledge_index_jobs (
  document_version_id uuid primary key references public.document_versions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'indexed', 'failed')),
  content_hash text,
  embedding_provider text,
  embedding_model text,
  embedding_dimensions integer,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error_code text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  next_attempt_at timestamptz not null default now()
);

create index if not exists knowledge_index_jobs_pending_idx
  on public.knowledge_index_jobs(status, next_attempt_at, requested_at);
alter table public.knowledge_index_jobs enable row level security;
revoke all on public.knowledge_index_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.knowledge_index_jobs to service_role;

create or replace function public.enqueue_knowledge_index(p_document_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document public.documents%rowtype;
begin
  select * into v_document from public.documents where id = p_document_id;
  if v_document.id is null
     or v_document.workflow_state <> 'published'
     or v_document.knowledge_label not in ('verified', 'unresolved')
     or v_document.current_published_version_id is null then
    return null;
  end if;
  insert into public.knowledge_index_jobs (
    document_version_id, organization_id, document_id, status, requested_at,
    next_attempt_at, started_at, completed_at, last_error_code
  ) values (
    v_document.current_published_version_id, v_document.organization_id,
    v_document.id, 'pending', now(), now(), null, null, null
  ) on conflict (document_version_id) do update set
    status = 'pending', requested_at = now(), next_attempt_at = now(),
    started_at = null, completed_at = null, last_error_code = null,
    attempt_count = 0, embedding_provider = null, embedding_model = null;
  return v_document.current_published_version_id;
end;
$$;

create or replace function public.enqueue_current_knowledge_indexes(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  insert into public.knowledge_index_jobs (
    document_version_id, organization_id, document_id, status, requested_at,
    next_attempt_at, started_at, completed_at, last_error_code
  )
  select current_published_version_id, organization_id, id, 'pending', now(), now(), null, null, null
  from public.documents
  where organization_id = p_organization_id
    and workflow_state = 'published'
    and knowledge_label in ('verified', 'unresolved')
    and current_published_version_id is not null
  on conflict (document_version_id) do update set
    status = 'pending', requested_at = now(), next_attempt_at = now(),
    started_at = null, completed_at = null, last_error_code = null,
    attempt_count = 0, embedding_provider = null, embedding_model = null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.enqueue_knowledge_index(uuid) from public, anon, authenticated;
revoke all on function public.enqueue_current_knowledge_indexes(uuid) from public, anon, authenticated;
grant execute on function public.enqueue_knowledge_index(uuid) to service_role;
grant execute on function public.enqueue_current_knowledge_indexes(uuid) to service_role;

create or replace function public.claim_knowledge_index_jobs(p_limit integer default 1)
returns table (document_version_id uuid, organization_id uuid, document_id uuid, claim_started_at timestamptz)
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select j.document_version_id
    from public.knowledge_index_jobs j
    join public.documents d on d.id = j.document_id
    where ((j.status in ('pending', 'failed') and j.next_attempt_at <= now())
      or (j.status = 'processing' and j.started_at < now() - interval '10 minutes'))
      and j.attempt_count < 5
      and d.workflow_state = 'published'
      and d.knowledge_label in ('verified', 'unresolved')
      and d.current_published_version_id = j.document_version_id
    order by j.requested_at
    for update of j skip locked
    limit least(greatest(coalesce(p_limit, 1), 1), 5)
  )
  update public.knowledge_index_jobs j set
    status = 'processing',
    attempt_count = j.attempt_count + 1,
    started_at = now(),
    last_error_code = null
  from candidates c
  where j.document_version_id = c.document_version_id
  returning j.document_version_id, j.organization_id, j.document_id, j.started_at;
$$;

revoke all on function public.claim_knowledge_index_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_knowledge_index_jobs(integer) to service_role;

create or replace function public.replace_knowledge_chunks(
  p_organization_id uuid,
  p_document_id uuid,
  p_document_version_id uuid,
  p_claim_started_at timestamptz,
  p_embedding_provider text,
  p_embedding_model text,
  p_chunks jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if nullif(btrim(p_embedding_model), '') is null then
    raise exception 'embedding model required';
  end if;
  if jsonb_typeof(p_chunks) <> 'array' then
    raise exception 'chunks must be an array';
  end if;
  perform 1 from public.knowledge_index_jobs j
    where j.document_version_id = p_document_version_id
      and j.document_id = p_document_id
      and j.organization_id = p_organization_id
      and j.status = 'processing'
      and j.started_at = p_claim_started_at
    for update;
  if not found then
    raise exception 'active indexing claim required';
  end if;
  if not exists (
    select 1
    from public.documents d
    join public.document_versions v on v.id = p_document_version_id
    where d.id = p_document_id
      and d.organization_id = p_organization_id
      and d.workflow_state = 'published'
      and d.knowledge_label in ('verified', 'unresolved')
      and d.current_published_version_id = p_document_version_id
      and v.document_id = d.id
  ) then
    raise exception 'current published document version required';
  end if;

  delete from public.knowledge_chunks where document_id = p_document_id;

  insert into public.knowledge_chunks (
    organization_id, document_id, document_version_id, chunk_index, content,
    token_count, source_locator, embedding, embedding_model, content_hash, indexed_at
  )
  select
    p_organization_id,
    p_document_id,
    p_document_version_id,
    (item->>'chunk_index')::integer,
    btrim(item->>'content'),
    nullif(item->>'token_count', '')::integer,
    coalesce(item->'source_locator', '{}'::jsonb),
    ((item->'embedding')::text)::vector(768),
    btrim(p_embedding_model),
    nullif(btrim(item->>'content_hash'), ''),
    now()
  from jsonb_array_elements(p_chunks) item;

  get diagnostics v_count = row_count;
  update public.knowledge_index_jobs set
    status = 'indexed',
    embedding_provider = btrim(p_embedding_provider),
    embedding_model = btrim(p_embedding_model),
    embedding_dimensions = 768,
    last_error_code = null,
    completed_at = now()
  where document_version_id = p_document_version_id
    and status = 'processing'
    and started_at = p_claim_started_at;
  return v_count;
end;
$$;

revoke all on function public.replace_knowledge_chunks(uuid, uuid, uuid, timestamptz, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_knowledge_chunks(uuid, uuid, uuid, timestamptz, text, text, jsonb)
  to service_role;

drop function if exists public.search_knowledge_chunks(uuid, uuid, vector, integer, real);
create function public.search_knowledge_chunks(
  p_organization_id uuid,
  p_user_id uuid,
  p_query_embedding vector(768),
  p_embedding_model text,
  p_match_count integer default 8,
  p_min_similarity real default 0.35
) returns table (
  chunk_id uuid,
  document_id uuid,
  document_version_id uuid,
  chunk_index integer,
  content text,
  source_locator jsonb,
  similarity real
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.document_id, c.document_version_id, c.chunk_index, c.content,
    c.source_locator, (1 - (c.embedding <=> p_query_embedding))::real
  from public.knowledge_chunks c
  join public.documents d on d.id = c.document_id
  where c.organization_id = p_organization_id
    and d.organization_id = p_organization_id
    and c.document_version_id = d.current_published_version_id
    and c.embedding_model = p_embedding_model
    and d.knowledge_label in ('verified', 'unresolved')
    and public.can_read_published_knowledge(c.document_id, p_user_id)
    and 1 - (c.embedding <=> p_query_embedding) >= least(greatest(coalesce(p_min_similarity, 0), -1), 1)
  order by c.embedding <=> p_query_embedding
  limit least(greatest(coalesce(p_match_count, 8), 1), 50);
$$;

revoke all on function public.search_knowledge_chunks(uuid, uuid, vector, text, integer, real)
  from public, anon, authenticated;
grant execute on function public.search_knowledge_chunks(uuid, uuid, vector, text, integer, real)
  to service_role;

create or replace function public.cleanup_inactive_knowledge_chunks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.workflow_state <> 'published'
     or new.knowledge_label not in ('verified', 'unresolved') then
    delete from public.knowledge_chunks where document_id = new.id;
  elsif new.current_published_version_id is distinct from old.current_published_version_id then
    delete from public.knowledge_chunks
      where document_id = new.id
        and document_version_id <> new.current_published_version_id;
  end if;
  return new;
end;
$$;

drop trigger if exists documents_cleanup_inactive_knowledge_chunks on public.documents;
create trigger documents_cleanup_inactive_knowledge_chunks
after update of workflow_state, knowledge_label, current_published_version_id
on public.documents
for each row execute function public.cleanup_inactive_knowledge_chunks();
