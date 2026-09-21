-- RAG foundation. Chunks belong to a published document version and inherit
-- the document visibility/lifecycle policy through search_knowledge_chunks.
-- Rollback: drop search_knowledge_chunks, then drop knowledge_chunks and its indexes.

create extension if not exists vector;

create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  document_version_id uuid not null references public.document_versions(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null check (length(btrim(content)) > 0),
  token_count integer check (token_count is null or token_count > 0),
  source_locator jsonb not null default '{}'::jsonb,
  embedding vector(768) not null,
  created_at timestamptz not null default now(),
  unique (document_version_id, chunk_index)
);

create index if not exists knowledge_chunks_document_idx
  on public.knowledge_chunks(document_id, document_version_id, chunk_index);
create index if not exists knowledge_chunks_organization_idx
  on public.knowledge_chunks(organization_id, document_version_id);
create index if not exists knowledge_chunks_embedding_idx
  on public.knowledge_chunks using hnsw (embedding vector_cosine_ops);

alter table public.knowledge_chunks enable row level security;
revoke all on public.knowledge_chunks from public, anon, authenticated;
grant select, insert, update, delete on public.knowledge_chunks to service_role;

create or replace function public.search_knowledge_chunks(
  p_organization_id uuid,
  p_user_id uuid,
  p_query_embedding vector(768),
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
  select
    c.id,
    c.document_id,
    c.document_version_id,
    c.chunk_index,
    c.content,
    c.source_locator,
    (1 - (c.embedding <=> p_query_embedding))::real as similarity
  from public.knowledge_chunks c
  join public.documents d on d.id = c.document_id
  where c.organization_id = p_organization_id
    and d.organization_id = p_organization_id
    and c.document_version_id = d.current_published_version_id
    and d.knowledge_label in ('verified', 'unresolved')
    and public.can_read_published_knowledge(c.document_id, p_user_id)
    and 1 - (c.embedding <=> p_query_embedding) >= least(greatest(coalesce(p_min_similarity, 0), -1), 1)
  order by c.embedding <=> p_query_embedding asc
  limit least(greatest(coalesce(p_match_count, 8), 1), 50);
$$;

revoke all on function public.search_knowledge_chunks(uuid, uuid, vector, integer, real)
  from public, anon, authenticated;
grant execute on function public.search_knowledge_chunks(uuid, uuid, vector, integer, real)
  to service_role;
