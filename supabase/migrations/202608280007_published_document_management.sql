-- Audited published-document revisions and recoverable archival.

create or replace function public.revise_published_document(
  p_document_id uuid, p_user_id uuid,
  p_title text, p_problem text, p_summary text,
  p_steps jsonb, p_warnings jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_org uuid; v_latest public.document_versions%rowtype;
  v_version_id uuid; v_number integer;
begin
  perform 1 from public.documents where id=p_document_id for update;
  select organization_id into v_org from public.documents
    where id=p_document_id and workflow_state='published';
  if v_org is null then raise exception 'published document required'; end if;
  if not exists (
    select 1 from public.document_teams dt
    join public.team_memberships m on m.team_id=dt.team_id
    where dt.document_id=p_document_id and m.user_id=p_user_id
      and m.role in ('moderator','admin')
  ) then raise exception 'moderator or admin required'; end if;
  if btrim(p_title)='' or btrim(p_problem)='' or btrim(p_summary)='' then
    raise exception 'title, problem, and summary are required';
  end if;
  if jsonb_typeof(p_steps) <> 'array' or jsonb_typeof(p_warnings) <> 'array' then
    raise exception 'steps and warnings must be arrays';
  end if;
  select * into v_latest from public.document_versions
    where id=(select current_published_version_id from public.documents where id=p_document_id);
  if v_latest.id is null then raise exception 'published version required'; end if;
  select coalesce(max(version_number),0)+1 into v_number
    from public.document_versions where document_id=p_document_id;
  insert into public.document_versions(
    document_id,source_snapshot_id,version_number,title,problem,summary,
    steps,warnings,evidence_map,moderator_notes,created_by_user_id
  ) values (
    p_document_id,v_latest.source_snapshot_id,v_number,btrim(p_title),btrim(p_problem),
    btrim(p_summary),p_steps,p_warnings,v_latest.evidence_map,
    'Human-edited published version',p_user_id
  ) returning id into v_version_id;
  update public.documents set current_published_version_id=v_version_id,updated_at=now()
    where id=p_document_id;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
    values(v_org,p_user_id,'published_document_revised','document',p_document_id,
      jsonb_build_object('version_id',v_version_id,'version_number',v_number));
  return v_version_id;
end $$;

create or replace function public.archive_published_document(
  p_document_id uuid, p_user_id uuid
) returns void language plpgsql security definer set search_path=public as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.documents
    where id=p_document_id and workflow_state='published';
  if v_org is null then raise exception 'published document required'; end if;
  if not exists (
    select 1 from public.document_teams dt
    join public.team_memberships m on m.team_id=dt.team_id
    where dt.document_id=p_document_id and m.user_id=p_user_id
      and m.role in ('moderator','admin')
  ) then raise exception 'moderator or admin required'; end if;
  update public.documents set workflow_state='archived',updated_at=now() where id=p_document_id;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id)
    values(v_org,p_user_id,'document_archived','document',p_document_id);
end $$;

revoke all on function public.revise_published_document(uuid,uuid,text,text,text,jsonb,jsonb)
  from public,anon,authenticated;
revoke all on function public.archive_published_document(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.revise_published_document(uuid,uuid,text,text,text,jsonb,jsonb)
  to service_role;
grant execute on function public.archive_published_document(uuid,uuid)
  to service_role;
