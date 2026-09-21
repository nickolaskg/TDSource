-- Additive, local-only migration. Apply after 015 in a reviewed transaction.
-- No existing document labels/content are changed. Browser access remains denied.
-- Rollback: disable new API/UI routes but retain these columns/tables/audit history.
-- Keep the retirement guard and current-only reads when rolling application code back;
-- legacy application versions can otherwise display obsolete guidance.
alter table public.documents add column if not exists lifecycle_reason text;
alter table public.documents add column if not exists lifecycle_changed_at timestamptz;
alter table public.documents add column if not exists lifecycle_changed_by_user_id uuid references public.users(id);
alter table public.documents add column if not exists replacement_document_id uuid references public.documents(id);
create table if not exists public.document_change_requests (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  requested_by_user_id uuid not null references public.users(id),
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  decided_by_user_id uuid references public.users(id),
  decided_at timestamptz,
  decision_reason text
);
create unique index if not exists document_change_requests_pending_user_idx
  on public.document_change_requests(document_id,requested_by_user_id) where status='pending';
create index if not exists document_change_requests_queue_idx on public.document_change_requests(document_id,status,created_at);
alter table public.document_change_requests enable row level security;
revoke all on public.document_change_requests from public,anon,authenticated;
grant select,insert,update,delete on public.document_change_requests to service_role;

create or replace function public.can_read_published_knowledge(p_document_id uuid,p_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.documents d join public.users u on u.organization_id=d.organization_id
    where d.id=p_document_id and u.id=p_user_id and u.status='active'
      and d.workflow_state='published' and d.current_published_version_id is not null
      and (d.organization_wide
        or exists(select 1 from public.document_teams dt join public.team_memberships m on m.team_id=dt.team_id
          join public.teams t on t.id=m.team_id where dt.document_id=d.id and m.user_id=u.id and t.status='active')
        or exists(select 1 from public.space_sharing_grants g join public.team_memberships m on m.team_id=g.recipient_team_id
          join public.teams t on t.id=m.team_id where g.source_space_id=d.source_space_id and g.status='active' and m.user_id=u.id and t.status='active')
        or exists(select 1 from public.teams t where t.id=d.review_team_id and t.status='archived'))
  )
$$;

create or replace function public.change_knowledge_lifecycle(
  p_document_id uuid,p_user_id uuid,p_action text,p_reason text,
  p_replacement_id uuid default null,p_request_id uuid default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_doc public.documents%rowtype; v_request public.document_change_requests%rowtype; v_id uuid;
  v_label public.knowledge_label;
begin
  -- Lock document first for both direct changes and flag decisions (consistent lock order).
  select * into v_doc from public.documents where id=p_document_id for update;
  if not public.can_read_published_knowledge(p_document_id,p_user_id) then raise exception 'published knowledge access required'; end if;
  if p_action is null or p_action not in ('flag','deprecate','outdate','approve','reject') then raise exception 'invalid action'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then raise exception 'reason required'; end if;
  if p_action <> 'flag' and not public.can_revise_document(p_document_id,p_user_id) then raise exception 'staff authority required'; end if;
  if (p_action in ('approve','reject')) <> (p_request_id is not null) then raise exception 'invalid request'; end if;
  if p_action in ('flag','reject') and p_replacement_id is not null then raise exception 'invalid replacement'; end if;
  if p_replacement_id is not null then
    if p_replacement_id=p_document_id or not public.can_read_published_knowledge(p_replacement_id,p_user_id)
      or not exists(select 1 from public.documents where id=p_replacement_id and knowledge_label in ('verified','unresolved')) then
      raise exception 'current accessible replacement required';
    end if;
  end if;
  if p_action='flag' then
    if v_doc.knowledge_label in ('outdated','deprecated') then raise exception 'already retired'; end if;
    select id into v_id from public.document_change_requests where document_id=p_document_id and requested_by_user_id=p_user_id and status='pending';
    if v_id is not null then return v_id; end if;
    insert into public.document_change_requests(document_id,requested_by_user_id,reason)
      values(p_document_id,p_user_id,btrim(p_reason)) returning id into v_id;
    insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
      values(v_doc.organization_id,p_user_id,'knowledge_deprecation_flagged','document',p_document_id,jsonb_build_object('request_id',v_id,'reason',btrim(p_reason)));
    return v_id;
  end if;
  if p_request_id is not null then
    select * into v_request from public.document_change_requests where id=p_request_id and document_id=p_document_id for update;
    if v_request.id is null then raise exception 'request missing'; end if;
    if v_request.status <> 'pending' then
      if (p_action='approve' and v_request.status='approved') or (p_action='reject' and v_request.status='rejected') then return v_request.id; end if;
      raise exception 'request already decided';
    end if;
    update public.document_change_requests set status=case when p_action='approve' then 'approved' else 'rejected' end,
      decided_by_user_id=p_user_id,decided_at=now(),decision_reason=btrim(p_reason) where id=p_request_id;
  end if;
  if p_action <> 'reject' then
    v_label:=case when p_action='outdate' then 'outdated'::public.knowledge_label else 'deprecated'::public.knowledge_label end;
    if v_doc.knowledge_label='deprecated' and v_label='outdated' then raise exception 'already deprecated'; end if;
    update public.documents set knowledge_label=v_label,lifecycle_reason=btrim(p_reason),lifecycle_changed_at=now(),
      lifecycle_changed_by_user_id=p_user_id,replacement_document_id=p_replacement_id,last_updated_by_user_id=p_user_id,updated_at=now()
      where id=p_document_id;
  end if;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
    values(v_doc.organization_id,p_user_id,'knowledge_lifecycle_'||p_action,'document',p_document_id,
      jsonb_build_object('request_id',p_request_id,'reason',btrim(p_reason),'previous_label',v_doc.knowledge_label,
        'knowledge_label',coalesce(v_label,v_doc.knowledge_label),'replacement_document_id',p_replacement_id));
  return coalesce(p_request_id,p_document_id);
end $$;

-- Old editors/approval paths must not silently reactivate retired guidance.
-- Restoration requires a future explicit reviewed lifecycle action, not a content edit.
create or replace function public.prevent_implicit_knowledge_reactivation()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.knowledge_label in ('outdated','deprecated') and
    (new.knowledge_label is null or new.knowledge_label in ('verified','unresolved')) then
    raise exception 'retired knowledge requires an explicit reviewed replacement';
  end if;
  return new;
end $$;
drop trigger if exists prevent_implicit_knowledge_reactivation on public.documents;
create trigger prevent_implicit_knowledge_reactivation before update of knowledge_label on public.documents
  for each row execute function public.prevent_implicit_knowledge_reactivation();
revoke all on function public.can_read_published_knowledge(uuid,uuid) from public,anon,authenticated;
revoke all on function public.change_knowledge_lifecycle(uuid,uuid,text,text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.prevent_implicit_knowledge_reactivation() from public,anon,authenticated;
grant execute on function public.can_read_published_knowledge(uuid,uuid) to service_role;
grant execute on function public.change_knowledge_lifecycle(uuid,uuid,text,text,uuid,uuid) to service_role;
