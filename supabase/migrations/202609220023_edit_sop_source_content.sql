-- Preserve structured SOP edits while keeping existing revision callers compatible.

create or replace function public.revise_document_draft(
  p_document_id uuid,p_user_id uuid,p_title text,p_problem text,p_summary text,
  p_steps jsonb,p_warnings jsonb,p_source_content jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_version uuid;
begin
  if p_source_content is not null and (
    jsonb_typeof(p_source_content) <> 'object'
    or jsonb_typeof(p_source_content->'blocks') <> 'array'
    or jsonb_typeof(p_source_content->'suggestions') <> 'array'
    or jsonb_typeof(p_source_content->'limitations') <> 'array'
    or jsonb_path_exists(p_source_content, '$.blocks[*].src')
  ) then raise exception 'valid source content without embedded image data is required'; end if;
  v_version := public.revise_document_draft(p_document_id,p_user_id,p_title,p_problem,p_summary,p_steps,p_warnings);
  if p_source_content is not null then
    update public.document_versions set evidence_map=evidence_map || jsonb_build_object('source_content',p_source_content) where id=v_version;
  end if;
  return v_version;
end $$;

create or replace function public.revise_published_document(
  p_document_id uuid,p_user_id uuid,p_title text,p_problem text,p_summary text,
  p_steps jsonb,p_warnings jsonb,p_source_content jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_version uuid;
begin
  if p_source_content is not null and (
    jsonb_typeof(p_source_content) <> 'object'
    or jsonb_typeof(p_source_content->'blocks') <> 'array'
    or jsonb_typeof(p_source_content->'suggestions') <> 'array'
    or jsonb_typeof(p_source_content->'limitations') <> 'array'
    or jsonb_path_exists(p_source_content, '$.blocks[*].src')
  ) then raise exception 'valid source content without embedded image data is required'; end if;
  v_version := public.revise_published_document(p_document_id,p_user_id,p_title,p_problem,p_summary,p_steps,p_warnings);
  if p_source_content is not null then
    update public.document_versions set evidence_map=evidence_map || jsonb_build_object('source_content',p_source_content) where id=v_version;
  end if;
  return v_version;
end $$;

revoke all on function public.revise_document_draft(uuid,uuid,text,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.revise_document_draft(uuid,uuid,text,text,text,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.revise_published_document(uuid,uuid,text,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.revise_published_document(uuid,uuid,text,text,text,jsonb,jsonb,jsonb) to service_role;
