-- Approved Q&A content is organization-wide by default while pending review
-- and immutable Webex source access remain scoped to the review team.

alter table public.documents
  alter column organization_wide set default true;

-- Do not expose previously published private documents without a new human
-- decision. Existing unpublished work adopts the new review default.
update public.documents
set organization_wide=true
where current_published_version_id is null
  and workflow_state in ('captured','processing','processing_failed','awaiting_review');

create or replace function public.moderate_document_with_visibility(
  p_document_id uuid,p_user_id uuid,p_action text,
  p_label public.knowledge_label,p_organization_wide boolean
) returns void language plpgsql security definer set search_path=public as $$
declare
  v_org uuid; v_version uuid; v_review_team uuid; v_capture uuid;
  v_snapshot uuid; v_has_published boolean; v_organization_wide boolean;
begin
  select organization_id,review_team_id,current_published_version_id is not null
    into v_org,v_review_team,v_has_published
    from public.documents where id=p_document_id for update;
  if v_org is null or not exists(
    select 1 from public.team_memberships m
    join public.teams t on t.id=m.team_id
    join public.users u on u.id=m.user_id
    where m.team_id=v_review_team and m.user_id=p_user_id
      and m.role in ('moderator','admin') and t.status='active' and u.status='active'
  ) then raise exception 'review team moderator or admin required'; end if;

  select c.id,s.id into v_capture,v_snapshot
    from public.capture_requests c
    join public.source_snapshots s on s.capture_request_id=c.id
    where c.document_id=p_document_id and c.status='awaiting_review'
    order by c.created_at desc limit 1;
  if v_capture is null then raise exception 'pending review required'; end if;
  select id into v_version from public.document_versions
    where document_id=p_document_id and source_snapshot_id=v_snapshot
    order by version_number desc limit 1;

  if p_action='approve' then
    if p_label not in ('verified','unresolved') then raise exception 'approval label required'; end if;
    if v_version is null then raise exception 'draft required'; end if;
    v_organization_wide:=coalesce(p_organization_wide,true);
    update public.documents set
      workflow_state='published',knowledge_label=p_label,
      current_published_version_id=v_version,organization_wide=v_organization_wide,
      rejected_at=null,
      originally_approved_by_user_id=coalesce(originally_approved_by_user_id,p_user_id),
      last_updated_by_user_id=p_user_id,updated_at=now()
      where id=p_document_id;
    update public.capture_requests set status='approved' where id=v_capture;
    insert into public.audit_events(
      organization_id,actor_user_id,action,target_type,target_id,metadata
    ) values(
      v_org,p_user_id,'document_approve','document',p_document_id,
      jsonb_build_object('organization_wide',v_organization_wide,'review_team_id',v_review_team)
    );
  elsif p_action='reject' then
    update public.capture_requests set status='rejected' where id=v_capture;
    if not v_has_published then
      update public.documents set workflow_state='rejected',rejected_at=now(),
        last_updated_by_user_id=p_user_id,updated_at=now()
        where id=p_document_id;
    end if;
    insert into public.audit_events(
      organization_id,actor_user_id,action,target_type,target_id,metadata
    ) values(
      v_org,p_user_id,'document_reject','document',p_document_id,
      jsonb_build_object('review_team_id',v_review_team)
    );
  else
    raise exception 'invalid moderation action';
  end if;
end $$;

revoke all on function public.moderate_document_with_visibility(
  uuid,uuid,text,public.knowledge_label,boolean
) from public,anon,authenticated;
grant execute on function public.moderate_document_with_visibility(
  uuid,uuid,text,public.knowledge_label,boolean
) to service_role;

create or replace function public.set_document_organization_visibility(
  p_document_id uuid,p_actor_user_id uuid,p_visible boolean
) returns void language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_team uuid;
begin
  select organization_id,review_team_id into v_org,v_team
    from public.documents where id=p_document_id and workflow_state='published';
  if v_org is null or not exists(
    select 1 from public.team_memberships m
    join public.teams t on t.id=m.team_id
    join public.users u on u.id=m.user_id
    where m.team_id=v_team and m.user_id=p_actor_user_id
      and m.role in ('moderator','admin') and t.status='active' and u.status='active'
  ) then raise exception 'review team moderator or admin required'; end if;
  update public.documents set organization_wide=p_visible,
    last_updated_by_user_id=p_actor_user_id,updated_at=now()
    where id=p_document_id;
  insert into public.audit_events(
    organization_id,actor_user_id,action,target_type,target_id,metadata
  ) values(
    v_org,p_actor_user_id,'document_organization_visibility_changed','document',
    p_document_id,jsonb_build_object('organization_wide',p_visible,'review_team_id',v_team)
  );
end $$;

revoke all on function public.set_document_organization_visibility(uuid,uuid,boolean)
  from public,anon,authenticated;
grant execute on function public.set_document_organization_visibility(uuid,uuid,boolean)
  to service_role;
