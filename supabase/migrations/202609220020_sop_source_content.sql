-- Preserve an uploaded SOP's structured presentation separately from its RAG text.
-- The existing 13-argument function remains available to older deployments.

create or replace function public.submit_sop_review(
  p_organization_id uuid,
  p_user_id uuid,
  p_team_id uuid,
  p_source_space_provider_id text,
  p_source_provider_id text,
  p_source_name text,
  p_source_markdown text,
  p_generated_at timestamptz,
  p_title text,
  p_problem text,
  p_summary text,
  p_steps jsonb,
  p_warnings jsonb,
  p_source_content jsonb
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_result jsonb;
  v_version_id uuid;
begin
  if p_source_content is null
    or jsonb_typeof(p_source_content) <> 'object'
    or jsonb_typeof(p_source_content->'blocks') <> 'array'
    or jsonb_typeof(p_source_content->'suggestions') <> 'array'
    or jsonb_typeof(p_source_content->'limitations') <> 'array'
    or jsonb_path_exists(p_source_content, '$.blocks[*].src') then
    raise exception 'valid source content without embedded image data is required';
  end if;

  v_result := public.submit_sop_review(
    p_organization_id,
    p_user_id,
    p_team_id,
    p_source_space_provider_id,
    p_source_provider_id,
    p_source_name,
    p_source_markdown,
    p_generated_at,
    p_title,
    p_problem,
    p_summary,
    p_steps,
    p_warnings
  );
  v_version_id := (v_result->>'versionId')::uuid;

  update public.document_versions
  set evidence_map = evidence_map || jsonb_build_object('source_content', p_source_content)
  where id = v_version_id;

  if not found then raise exception 'created SOP version was not found'; end if;
  return v_result;
end $$;

revoke all on function public.submit_sop_review(uuid, uuid, uuid, text, text, text, text, timestamptz, text, text, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_sop_review(uuid, uuid, uuid, text, text, text, text, timestamptz, text, text, text, jsonb, jsonb, jsonb)
  to service_role;
