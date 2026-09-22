-- Permanently purge live document data while retaining only transient object-cleanup work.
-- Rollback removes the RPC and queue table; deleted documents cannot be restored by this migration.
create table if not exists public.storage_purge_queue (
  object_key text primary key,
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text
);
alter table public.storage_purge_queue enable row level security;
revoke all on public.storage_purge_queue from public, anon, authenticated;
grant select, insert, update, delete on public.storage_purge_queue to service_role;

create or replace function public.permanently_delete_document(
  p_document_id uuid, p_user_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_capture_ids uuid[];
  v_asset_keys text[];
begin
  if not public.can_revise_document(p_document_id,p_user_id) then
    raise exception 'moderator or admin required';
  end if;

  select coalesce(array_agg(id),array[]::uuid[]) into v_capture_ids
    from public.capture_requests where document_id=p_document_id;

  insert into public.storage_purge_queue(object_key)
  select distinct block->>'assetKey'
  from public.document_versions v
  cross join lateral jsonb_array_elements(coalesce(v.evidence_map->'source_content'->'blocks','[]'::jsonb)) block
  where v.document_id=p_document_id and block ? 'assetKey'
  on conflict (object_key) do nothing;

  select coalesce(array_agg(object_key),array[]::text[]) into v_asset_keys
    from public.storage_purge_queue
    where object_key in (
      select block->>'assetKey'
      from public.document_versions v
      cross join lateral jsonb_array_elements(coalesce(v.evidence_map->'source_content'->'blocks','[]'::jsonb)) block
      where v.document_id=p_document_id and block ? 'assetKey'
    );

  update public.documents set replacement_document_id=null where replacement_document_id=p_document_id;
  update public.documents set current_published_version_id=null where id=p_document_id;
  delete from public.audit_events
    where (target_type='document' and target_id=p_document_id)
       or (target_type='capture_request' and target_id=any(v_capture_ids));
  delete from public.documents where id=p_document_id;
  delete from public.capture_requests where id=any(v_capture_ids);

  return jsonb_build_object('assetKeys',to_jsonb(v_asset_keys));
end $$;

revoke all on function public.permanently_delete_document(uuid,uuid) from public,anon,authenticated;
grant execute on function public.permanently_delete_document(uuid,uuid) to service_role;
