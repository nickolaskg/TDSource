-- Atomically capture one Webex root message and its replies.
-- The Worker re-fetches source data from Webex and calls this as the server role.

create or replace function public.capture_webex_thread(
  p_organization_id uuid,
  p_user_id uuid,
  p_team_id uuid,
  p_space_provider_id text,
  p_space_name text,
  p_root_message_id text,
  p_messages jsonb,
  p_transcript_sha256 text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_space_id uuid;
  v_document_id uuid;
  v_capture_id uuid;
  v_snapshot_id uuid;
  v_message jsonb;
  v_ordinal integer := 0;
  v_idempotency_key text := 'webex:document:' || p_root_message_id;
begin
  if jsonb_typeof(p_messages) <> 'array' or jsonb_array_length(p_messages) = 0 then
    raise exception 'capture requires at least one source message';
  end if;

  if not exists (
    select 1 from public.users
    where id = p_user_id and organization_id = p_organization_id and status = 'active'
  ) then
    raise exception 'active user required';
  end if;

  if not exists (
    select 1
    from public.team_memberships membership
    join public.teams team on team.id = membership.team_id
    where membership.user_id = p_user_id
      and membership.team_id = p_team_id
      and team.organization_id = p_organization_id
      and team.status = 'active'
  ) then
    raise exception 'active team membership required';
  end if;

  select document_id into v_document_id
  from public.capture_requests
  where organization_id = p_organization_id and idempotency_key = v_idempotency_key;
  if v_document_id is not null then return v_document_id; end if;

  insert into public.source_spaces (
    organization_id, provider, provider_space_id, display_name, is_group_space
  ) values (
    p_organization_id, 'webex', p_space_provider_id, p_space_name, true
  )
  on conflict (organization_id, provider, provider_space_id)
  do update set display_name = excluded.display_name
  returning id into v_source_space_id;

  insert into public.team_space_policies (team_id, source_space_id)
  values (p_team_id, v_source_space_id)
  on conflict (team_id, source_space_id) do nothing;

  insert into public.documents (organization_id, source_space_id, workflow_state)
  values (p_organization_id, v_source_space_id, 'captured')
  returning id into v_document_id;

  insert into public.document_teams (document_id, team_id)
  values (v_document_id, p_team_id);

  insert into public.capture_requests (
    organization_id, document_id, source_space_id, requested_by_user_id,
    command, provider_event_id, root_provider_message_id, idempotency_key, status
  ) values (
    p_organization_id, v_document_id, v_source_space_id, p_user_id,
    'document', 'manual:' || p_root_message_id, p_root_message_id, v_idempotency_key, 'captured'
  ) returning id into v_capture_id;

  insert into public.source_snapshots (
    document_id, capture_request_id, sequence, transcript_sha256, captured_at
  ) values (
    v_document_id, v_capture_id, 1, p_transcript_sha256, now()
  ) returning id into v_snapshot_id;

  for v_message in select value from jsonb_array_elements(p_messages)
  loop
    v_ordinal := v_ordinal + 1;
    insert into public.source_messages (
      source_snapshot_id, provider_message_id, parent_provider_message_id,
      author_provider_id, author_display_name, source_markdown, sent_at, ordinal
    ) values (
      v_snapshot_id,
      v_message->>'id',
      nullif(v_message->>'parentId', ''),
      coalesce(nullif(v_message->>'personId', ''), nullif(v_message->>'personEmail', ''), 'unknown'),
      coalesce(nullif(v_message->>'personDisplayName', ''), nullif(v_message->>'personEmail', ''), 'Webex user'),
      coalesce(nullif(v_message->>'markdown', ''), nullif(v_message->>'text', ''), '[Attachment or rich content]'),
      (v_message->>'created')::timestamptz,
      v_ordinal
    );
  end loop;

  insert into public.audit_events (
    organization_id, actor_user_id, action, target_type, target_id, metadata
  ) values (
    p_organization_id, p_user_id, 'webex_thread_captured', 'document', v_document_id,
    jsonb_build_object('source_space_id', v_source_space_id, 'message_count', v_ordinal)
  );

  return v_document_id;
end;
$$;

revoke all on function public.capture_webex_thread(uuid, uuid, uuid, text, text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.capture_webex_thread(uuid, uuid, uuid, text, text, text, jsonb, text)
  to service_role;
