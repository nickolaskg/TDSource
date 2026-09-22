-- Atomically persist a locally generated SOP as an awaiting-review document.
-- Uploaded binaries are intentionally not accepted or stored; the generated markdown is the source snapshot.

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
  p_warnings jsonb
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_space_id uuid;
  v_document_id uuid;
  v_capture_id uuid;
  v_snapshot_id uuid;
  v_version_id uuid;
begin
  if not exists (
    select 1 from public.users
    where id = p_user_id and organization_id = p_organization_id and status = 'active'
  ) then raise exception 'active user required'; end if;
  if not exists (
    select 1 from public.team_memberships m
    join public.teams t on t.id = m.team_id
    where m.user_id = p_user_id and m.team_id = p_team_id
      and t.organization_id = p_organization_id and t.status = 'active'
      and m.role in ('moderator', 'admin')
  ) then raise exception 'moderator or admin required'; end if;
  if btrim(coalesce(p_source_space_provider_id, '')) = ''
    or btrim(coalesce(p_source_provider_id, '')) = ''
    or btrim(coalesce(p_source_markdown, '')) = ''
    or btrim(coalesce(p_title, '')) = ''
    or btrim(coalesce(p_summary, '')) = '' then
    raise exception 'source and draft content are required';
  end if;
  if jsonb_typeof(p_steps) <> 'array' or jsonb_typeof(p_warnings) <> 'array' then
    raise exception 'draft arrays are required';
  end if;

  insert into public.source_spaces(organization_id, provider, provider_space_id, display_name, is_group_space)
    values (p_organization_id, 'tdsource-sop-upload', p_source_space_provider_id,
      left(btrim(p_source_name), 300), false)
    on conflict (organization_id, provider, provider_space_id)
    do update set display_name = excluded.display_name
    returning id into v_space_id;

  insert into public.documents(organization_id, source_space_id, workflow_state)
    values (p_organization_id, v_space_id, 'awaiting_review')
    returning id into v_document_id;
  insert into public.document_teams(document_id, team_id) values (v_document_id, p_team_id);

  insert into public.capture_requests(
    organization_id, document_id, source_space_id, requested_by_user_id, command,
    provider_event_id, root_provider_message_id, idempotency_key, status
  ) values (
    p_organization_id, v_document_id, v_space_id, p_user_id, 'document',
    p_source_provider_id, p_source_provider_id, 'tdsource-sop-upload:' || p_source_provider_id, 'awaiting_review'
  ) returning id into v_capture_id;

  insert into public.source_snapshots(document_id, capture_request_id, sequence, transcript_sha256, captured_at)
    values (v_document_id, v_capture_id, 1,
      encode(digest(p_source_markdown, 'sha256'), 'hex'), coalesce(p_generated_at, now()))
    returning id into v_snapshot_id;
  insert into public.source_messages(
    source_snapshot_id, provider_message_id, author_provider_id, author_display_name,
    source_markdown, sent_at, ordinal
  ) values (
    v_snapshot_id, p_source_provider_id, p_user_id::text, 'TDS SOP generator',
    p_source_markdown, coalesce(p_generated_at, now()), 1
  );

  insert into public.document_versions(
    document_id, source_snapshot_id, version_number, title, problem, summary,
    steps, warnings, evidence_map, created_by_user_id
  ) values (
    v_document_id, v_snapshot_id, 1, btrim(p_title), btrim(p_problem), btrim(p_summary),
    p_steps, p_warnings, jsonb_build_object('source', 'local_sop_upload'), p_user_id
  ) returning id into v_version_id;

  insert into public.audit_events(organization_id, actor_user_id, action, target_type, target_id, metadata)
    values (p_organization_id, p_user_id, 'sop_submitted_for_review', 'document', v_document_id,
      jsonb_build_object('version_id', v_version_id, 'source_provider_id', p_source_provider_id));
  return jsonb_build_object('documentId', v_document_id, 'versionId', v_version_id, 'status', 'awaiting_review');
end $$;

revoke all on function public.submit_sop_review(uuid, uuid, uuid, text, text, text, text, timestamptz, text, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_sop_review(uuid, uuid, uuid, text, text, text, text, timestamptz, text, text, text, jsonb, jsonb)
  to service_role;
