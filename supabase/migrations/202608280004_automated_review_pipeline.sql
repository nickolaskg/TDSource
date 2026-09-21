-- Bot-command capture, structured draft completion, and human moderation.

create or replace function public.capture_webex_command(
  p_organization_id uuid, p_user_id uuid, p_team_id uuid,
  p_command public.capture_command, p_provider_event_id text,
  p_space_provider_id text, p_space_name text, p_root_message_id text,
  p_messages jsonb, p_transcript_sha256 text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_space_id uuid; v_document_id uuid; v_capture_id uuid; v_snapshot_id uuid;
  v_sequence integer; v_previous_hash text; v_message jsonb; v_ordinal integer := 0;
  v_key text := 'webex:command:' || p_provider_event_id;
begin
  if jsonb_typeof(p_messages) <> 'array' or jsonb_array_length(p_messages) = 0 then raise exception 'source messages required'; end if;
  if not exists (select 1 from public.users where id=p_user_id and organization_id=p_organization_id and status='active') then raise exception 'active user required'; end if;
  if not exists (
    select 1 from public.team_memberships m join public.teams t on t.id=m.team_id
    where m.user_id=p_user_id and m.team_id=p_team_id and t.organization_id=p_organization_id
      and t.status='active' and m.role in ('moderator','admin')
  ) then raise exception 'moderator or admin required'; end if;

  select document_id into v_document_id from public.capture_requests
    where organization_id=p_organization_id and idempotency_key=v_key limit 1;
  if v_document_id is not null then
    select id, sequence into v_snapshot_id, v_sequence from public.source_snapshots where document_id=v_document_id order by sequence desc limit 1;
    return jsonb_build_object('documentId',v_document_id,'snapshotId',v_snapshot_id,'sequence',v_sequence,'changed',false,'duplicate',true);
  end if;

  insert into public.source_spaces(organization_id,provider,provider_space_id,display_name,is_group_space)
    values(p_organization_id,'webex',p_space_provider_id,p_space_name,true)
    on conflict(organization_id,provider,provider_space_id) do update set display_name=excluded.display_name
    returning id into v_space_id;
  insert into public.team_space_policies(team_id,source_space_id) values(p_team_id,v_space_id)
    on conflict(team_id,source_space_id) do nothing;

  select document_id into v_document_id from public.capture_requests
    where organization_id=p_organization_id and root_provider_message_id=p_root_message_id
    order by created_at asc limit 1;

  if p_command='document' then
    if v_document_id is not null then
      if exists (select 1 from public.document_versions where document_id=v_document_id) then
        select id,sequence into v_snapshot_id,v_sequence from public.source_snapshots where document_id=v_document_id order by sequence desc limit 1;
        return jsonb_build_object('documentId',v_document_id,'snapshotId',v_snapshot_id,'sequence',v_sequence,'changed',false,'alreadyExists',true);
      end if;
      select coalesce(max(sequence),0)+1 into v_sequence from public.source_snapshots where document_id=v_document_id;
      update public.documents set workflow_state='processing',updated_at=now() where id=v_document_id;
    else
      insert into public.documents(organization_id,source_space_id,workflow_state)
        values(p_organization_id,v_space_id,'processing') returning id into v_document_id;
      insert into public.document_teams(document_id,team_id) values(v_document_id,p_team_id);
      v_sequence := 1;
    end if;
  else
    if v_document_id is null then raise exception 'document command required before update'; end if;
    select transcript_sha256 into v_previous_hash from public.source_snapshots where document_id=v_document_id order by sequence desc limit 1;
    select coalesce(max(sequence),0)+1 into v_sequence from public.source_snapshots where document_id=v_document_id;
    if v_previous_hash=p_transcript_sha256 then
      select id into v_snapshot_id from public.source_snapshots where document_id=v_document_id order by sequence desc limit 1;
      return jsonb_build_object('documentId',v_document_id,'snapshotId',v_snapshot_id,'sequence',v_sequence-1,'changed',false,'upToDate',true);
    end if;
    update public.documents set workflow_state='processing',updated_at=now() where id=v_document_id and workflow_state <> 'published';
  end if;

  insert into public.capture_requests(organization_id,document_id,source_space_id,requested_by_user_id,command,provider_event_id,root_provider_message_id,idempotency_key,status)
    values(p_organization_id,v_document_id,v_space_id,p_user_id,p_command,p_provider_event_id,p_root_message_id,v_key,'processing') returning id into v_capture_id;
  insert into public.source_snapshots(document_id,capture_request_id,sequence,transcript_sha256,captured_at)
    values(v_document_id,v_capture_id,v_sequence,p_transcript_sha256,now()) returning id into v_snapshot_id;
  for v_message in select value from jsonb_array_elements(p_messages) loop
    v_ordinal := v_ordinal+1;
    insert into public.source_messages(source_snapshot_id,provider_message_id,parent_provider_message_id,author_provider_id,author_display_name,source_markdown,sent_at,ordinal)
    values(v_snapshot_id,v_message->>'id',nullif(v_message->>'parentId',''),coalesce(nullif(v_message->>'personId',''),nullif(v_message->>'personEmail',''),'unknown'),coalesce(nullif(v_message->>'personDisplayName',''),nullif(v_message->>'personEmail',''),'Webex user'),coalesce(nullif(v_message->>'markdown',''),nullif(v_message->>'text',''),'[Attachment or rich content]'),(v_message->>'created')::timestamptz,v_ordinal);
  end loop;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
    values(p_organization_id,p_user_id,'webex_'||p_command::text,'document',v_document_id,jsonb_build_object('snapshot_sequence',v_sequence,'message_count',v_ordinal));
  return jsonb_build_object('documentId',v_document_id,'snapshotId',v_snapshot_id,'captureId',v_capture_id,'sequence',v_sequence,'changed',true);
end $$;

create or replace function public.complete_generated_draft(
  p_document_id uuid, p_snapshot_id uuid, p_user_id uuid,
  p_title text, p_problem text, p_summary text, p_steps jsonb,
  p_warnings jsonb, p_evidence_map jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_version_id uuid; v_number integer; v_capture_id uuid; v_org uuid;
begin
  select d.organization_id into v_org from public.documents d join public.source_snapshots s on s.document_id=d.id where d.id=p_document_id and s.id=p_snapshot_id;
  if v_org is null then raise exception 'snapshot does not belong to document'; end if;
  select coalesce(max(version_number),0)+1 into v_number from public.document_versions where document_id=p_document_id;
  insert into public.document_versions(document_id,source_snapshot_id,version_number,title,problem,summary,steps,warnings,evidence_map,created_by_user_id)
    values(p_document_id,p_snapshot_id,v_number,p_title,p_problem,p_summary,p_steps,p_warnings,p_evidence_map,p_user_id) returning id into v_version_id;
  update public.documents set workflow_state='awaiting_review',updated_at=now() where id=p_document_id;
  select capture_request_id into v_capture_id from public.source_snapshots where id=p_snapshot_id;
  update public.capture_requests set status='awaiting_review' where id=v_capture_id;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
    values(v_org,p_user_id,'draft_generated','document',p_document_id,jsonb_build_object('version_id',v_version_id,'version_number',v_number));
  return v_version_id;
end $$;

create or replace function public.moderate_document(
  p_document_id uuid, p_user_id uuid, p_action text, p_label public.knowledge_label default null
) returns void language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_version uuid;
begin
  select organization_id into v_org from public.documents where id=p_document_id;
  if not exists (
    select 1 from public.document_teams dt join public.team_memberships m on m.team_id=dt.team_id
    where dt.document_id=p_document_id and m.user_id=p_user_id and m.role in ('moderator','admin')
  ) then raise exception 'moderator or admin required'; end if;
  if p_action='approve' then
    if p_label not in ('verified','unresolved') then raise exception 'approval label required'; end if;
    select id into v_version from public.document_versions where document_id=p_document_id order by version_number desc limit 1;
    if v_version is null then raise exception 'draft required'; end if;
    update public.documents set workflow_state='published',knowledge_label=p_label,current_published_version_id=v_version,rejected_at=null,updated_at=now() where id=p_document_id;
  elsif p_action='reject' then
    update public.documents set workflow_state='rejected',rejected_at=now(),updated_at=now() where id=p_document_id;
  else raise exception 'invalid moderation action'; end if;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id)
    values(v_org,p_user_id,'document_'||p_action,'document',p_document_id);
end $$;

revoke all on function public.capture_webex_command(uuid,uuid,uuid,public.capture_command,text,text,text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.complete_generated_draft(uuid,uuid,uuid,text,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.moderate_document(uuid,uuid,text,public.knowledge_label) from public,anon,authenticated;
grant execute on function public.capture_webex_command(uuid,uuid,uuid,public.capture_command,text,text,text,text,jsonb,text) to service_role;
grant execute on function public.complete_generated_draft(uuid,uuid,uuid,text,text,text,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.moderate_document(uuid,uuid,text,public.knowledge_label) to service_role;
