-- Audited human revisions of generated drafts before moderation.

create or replace function public.revise_document_draft(
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
    where id=p_document_id and workflow_state='awaiting_review';
  if v_org is null then raise exception 'document is not awaiting review'; end if;
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
    where document_id=p_document_id order by version_number desc limit 1;
  if v_latest.id is null then raise exception 'draft required'; end if;
  v_number := v_latest.version_number + 1;
  insert into public.document_versions(
    document_id,source_snapshot_id,version_number,title,problem,summary,
    steps,warnings,evidence_map,moderator_notes,created_by_user_id
  ) values (
    p_document_id,v_latest.source_snapshot_id,v_number,btrim(p_title),btrim(p_problem),
    btrim(p_summary),p_steps,p_warnings,v_latest.evidence_map,
    'Human-edited review draft',p_user_id
  ) returning id into v_version_id;
  update public.documents set updated_at=now() where id=p_document_id;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
    values(v_org,p_user_id,'draft_revised','document',p_document_id,
      jsonb_build_object('version_id',v_version_id,'version_number',v_number));
  return v_version_id;
end $$;

revoke all on function public.revise_document_draft(uuid,uuid,text,text,text,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.revise_document_draft(uuid,uuid,text,text,text,jsonb,jsonb)
  to service_role;
