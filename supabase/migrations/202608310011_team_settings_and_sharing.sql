-- Team-scoped settings, default Webex capture routing, durable sharing,
-- access requests, invitations, and document attribution.

alter table public.teams add column if not exists updated_at timestamptz not null default now();

alter table public.team_space_policies
  add column if not exists is_default_capture boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

with ranked as (
  select team_id, source_space_id,
    row_number() over (partition by source_space_id order by created_at, team_id) as position
  from public.team_space_policies
)
update public.team_space_policies p set is_default_capture=true
from ranked r where r.team_id=p.team_id and r.source_space_id=p.source_space_id
  and r.position=1 and not exists (
    select 1 from public.team_space_policies existing
    where existing.source_space_id=p.source_space_id and existing.is_default_capture
  );

create unique index if not exists team_space_single_default_idx
  on public.team_space_policies(source_space_id) where is_default_capture;

alter table public.pending_team_invitations
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by_user_id uuid references public.users(id);

alter table public.documents
  add column if not exists review_team_id uuid references public.teams(id),
  add column if not exists organization_wide boolean not null default false,
  add column if not exists originally_approved_by_user_id uuid references public.users(id),
  add column if not exists last_updated_by_user_id uuid references public.users(id),
  add column if not exists archived_by_user_id uuid references public.users(id),
  add column if not exists archived_at timestamptz;

update public.documents d set review_team_id=(
  select dt.team_id from public.document_teams dt where dt.document_id=d.id
  order by dt.team_id limit 1
) where review_team_id is null;

update public.documents d set
  originally_approved_by_user_id=coalesce(d.originally_approved_by_user_id,(
    select a.actor_user_id from public.audit_events a where a.target_type='document'
      and a.target_id=d.id and a.action='document_approve' order by a.occurred_at asc limit 1
  )),
  last_updated_by_user_id=coalesce(d.last_updated_by_user_id,(
    select a.actor_user_id from public.audit_events a where a.target_type='document'
      and a.target_id=d.id and a.action='document_approve' order by a.occurred_at asc limit 1
  ))
where d.workflow_state in ('published','archived');

create index if not exists documents_review_team_idx
  on public.documents(review_team_id,workflow_state,updated_at desc);
create index if not exists documents_organization_wide_idx
  on public.documents(organization_id,organization_wide,workflow_state);

create table if not exists public.space_sharing_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  source_team_id uuid not null references public.teams(id),
  recipient_team_id uuid not null references public.teams(id),
  source_space_id uuid not null references public.source_spaces(id),
  granted_by_user_id uuid not null references public.users(id),
  status text not null default 'active' check (status in ('active','revoked')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by_user_id uuid references public.users(id),
  check (source_team_id <> recipient_team_id),
  unique (source_team_id,recipient_team_id,source_space_id)
);

create index if not exists space_sharing_recipient_idx
  on public.space_sharing_grants(recipient_team_id,status,source_space_id);

create table if not exists public.space_access_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  requester_team_id uuid not null references public.teams(id),
  source_team_id uuid not null references public.teams(id),
  requested_by_user_id uuid not null references public.users(id),
  status text not null default 'pending' check (status in ('pending','approved','denied','cancelled')),
  note text not null default '',
  decided_by_user_id uuid references public.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (requester_team_id <> source_team_id)
);

create table if not exists public.space_access_request_items (
  request_id uuid not null references public.space_access_requests(id) on delete cascade,
  source_space_id uuid not null references public.source_spaces(id),
  primary key(request_id,source_space_id)
);

create index if not exists space_access_requests_source_idx
  on public.space_access_requests(source_team_id,status,created_at desc);
create index if not exists space_access_requests_requester_idx
  on public.space_access_requests(requester_team_id,status,created_at desc);

alter table public.space_sharing_grants enable row level security;
alter table public.space_access_requests enable row level security;
alter table public.space_access_request_items enable row level security;
revoke all on public.space_sharing_grants, public.space_access_requests,
  public.space_access_request_items from anon, authenticated;

create or replace function public.is_active_team_admin(p_team_id uuid,p_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.team_memberships m join public.teams t on t.id=m.team_id
    where m.team_id=p_team_id and m.user_id=p_user_id and m.role='admin' and t.status='active'
  )
$$;

create or replace function public.can_revise_document(p_document_id uuid,p_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  with staff_teams as (
    select m.team_id from public.team_memberships m join public.teams t on t.id=m.team_id
    join public.users u on u.id=m.user_id
    where m.user_id=p_user_id and m.role in ('moderator','admin')
      and t.status='active' and u.status='active'
  ), target as (
    select d.organization_id,d.source_space_id,d.review_team_id,d.organization_wide
    from public.documents d where d.id=p_document_id
  )
  select exists(select 1 from staff_teams) and exists(select 1 from target) and (
    exists(select 1 from target join staff_teams on staff_teams.team_id=target.review_team_id)
    or exists(
      select 1 from target join public.space_sharing_grants g
        on g.source_space_id=target.source_space_id and g.status='active'
      join staff_teams on staff_teams.team_id=g.recipient_team_id
    )
    or exists(select 1 from target where organization_wide)
    or exists(
      select 1 from target left join public.teams t on t.id=target.review_team_id
      where target.review_team_id is null or t.status <> 'active'
    )
  )
$$;

create or replace function public.complete_initial_admin_setup(
  p_organization_id uuid,p_actor_user_id uuid,p_team_name text,
  p_invited_emails jsonb,p_rooms jsonb
) returns void language plpgsql security definer set search_path=public as $$
declare v_team_id uuid; v_item jsonb; v_email text; v_role public.team_role; v_space_id uuid;
begin
  if btrim(p_team_name)='' then raise exception 'team name required'; end if;
  if exists(select 1 from public.organizations where id=p_organization_id and initial_setup_completed_at is not null) then raise exception 'initial setup already completed'; end if;
  select m.team_id into v_team_id from public.team_memberships m join public.teams t on t.id=m.team_id
    where m.user_id=p_actor_user_id and m.role='admin' and t.organization_id=p_organization_id and t.status='active' limit 1;
  if v_team_id is null then raise exception 'administrator required'; end if;
  update public.teams set name=btrim(p_team_name),updated_at=now() where id=v_team_id;
  for v_item in select value from jsonb_array_elements(coalesce(p_invited_emails,'[]'::jsonb)) loop
    v_email:=lower(btrim(case when jsonb_typeof(v_item)='string' then v_item #>> '{}' else v_item->>'email' end));
    v_role:=case when jsonb_typeof(v_item)='object' and v_item->>'role'='moderator' then 'moderator'::public.team_role else 'basic'::public.team_role end;
    if v_email<>'' then
      insert into public.pending_team_invitations(organization_id,team_id,email,role,invited_by_user_id)
        values(p_organization_id,v_team_id,v_email,v_role,p_actor_user_id)
        on conflict(organization_id,team_id,email) do update set role=excluded.role,accepted_at=null,revoked_at=null,revoked_by_user_id=null;
    end if;
  end loop;
  for v_item in select value from jsonb_array_elements(p_rooms) loop
    insert into public.source_spaces(organization_id,provider,provider_space_id,display_name,is_group_space)
      values(p_organization_id,'webex',v_item->>'id',coalesce(nullif(v_item->>'title',''),'Untitled Webex space'),true)
      on conflict(organization_id,provider,provider_space_id) do update set display_name=excluded.display_name
      returning id into v_space_id;
    insert into public.team_space_policies(team_id,source_space_id,basic_user_visibility,staff_visibility,is_default_capture)
      values(v_team_id,v_space_id,true,true,not exists(select 1 from public.team_space_policies where source_space_id=v_space_id and is_default_capture))
      on conflict(team_id,source_space_id) do update set updated_at=now();
  end loop;
  update public.organizations set initial_setup_completed_at=now() where id=p_organization_id;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
    values(p_organization_id,p_actor_user_id,'initial_setup_completed','team',v_team_id,jsonb_build_object('invite_count',jsonb_array_length(coalesce(p_invited_emails,'[]'::jsonb)),'room_count',jsonb_array_length(p_rooms)));
end $$;

create or replace function public.create_team_with_setup(
  p_organization_id uuid,p_actor_user_id uuid,p_team_name text,
  p_invitations jsonb,p_rooms jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_team_id uuid; v_item jsonb; v_email text; v_role public.team_role; v_space_id uuid;
begin
  if not exists(
    select 1 from public.team_memberships m join public.teams t on t.id=m.team_id
    where m.user_id=p_actor_user_id and m.role='admin' and t.status='active'
      and t.organization_id=p_organization_id
  ) then raise exception 'active team admin required'; end if;
  if btrim(p_team_name)='' then raise exception 'team name required'; end if;
  insert into public.teams(organization_id,name) values(p_organization_id,btrim(p_team_name)) returning id into v_team_id;
  insert into public.team_memberships(team_id,user_id,role) values(v_team_id,p_actor_user_id,'admin');
  for v_item in select value from jsonb_array_elements(coalesce(p_invitations,'[]'::jsonb)) loop
    v_email:=lower(btrim(v_item->>'email'));
    v_role:=case when v_item->>'role'='moderator' then 'moderator'::public.team_role else 'basic'::public.team_role end;
    if v_email<>'' then
      insert into public.pending_team_invitations(organization_id,team_id,email,role,invited_by_user_id)
      values(p_organization_id,v_team_id,v_email,v_role,p_actor_user_id)
      on conflict(organization_id,team_id,email) do update set role=excluded.role,
        invited_by_user_id=excluded.invited_by_user_id,accepted_at=null,revoked_at=null,revoked_by_user_id=null;
    end if;
  end loop;
  for v_item in select value from jsonb_array_elements(coalesce(p_rooms,'[]'::jsonb)) loop
    insert into public.source_spaces(organization_id,provider,provider_space_id,display_name,is_group_space)
      values(p_organization_id,'webex',v_item->>'id',coalesce(nullif(v_item->>'title',''),'Untitled Webex space'),true)
      on conflict(organization_id,provider,provider_space_id) do update set display_name=excluded.display_name
      returning id into v_space_id;
    insert into public.team_space_policies(team_id,source_space_id,basic_user_visibility,staff_visibility,is_default_capture)
      values(v_team_id,v_space_id,true,true,not exists(select 1 from public.team_space_policies where source_space_id=v_space_id and is_default_capture))
      on conflict(team_id,source_space_id) do update set updated_at=now();
  end loop;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
    values(p_organization_id,p_actor_user_id,'team_created','team',v_team_id,
      jsonb_build_object('name',btrim(p_team_name),'invite_count',jsonb_array_length(coalesce(p_invitations,'[]'::jsonb)),'room_count',jsonb_array_length(coalesce(p_rooms,'[]'::jsonb))));
  return v_team_id;
end $$;

create or replace function public.update_team_profile(
  p_team_id uuid,p_actor_user_id uuid,p_name text,p_status public.team_status
) returns void language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_old_status public.team_status;
begin
  select organization_id,status into v_org,v_old_status from public.teams where id=p_team_id;
  if v_org is null or not exists(
    select 1 from public.team_memberships where team_id=p_team_id and user_id=p_actor_user_id and role='admin'
  ) then raise exception 'team admin required'; end if;
  if btrim(p_name)='' then raise exception 'team name required'; end if;
  update public.teams set name=btrim(p_name),status=p_status,
    archived_at=case when p_status='archived' then coalesce(archived_at,now()) else null end,updated_at=now()
    where id=p_team_id;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
    values(v_org,p_actor_user_id,case when p_status<>v_old_status then 'team_status_changed' else 'team_renamed' end,
      'team',p_team_id,jsonb_build_object('status',p_status,'name',btrim(p_name)));
end $$;

create or replace function public.create_team_invitations(
  p_team_id uuid,p_actor_user_id uuid,p_invitations jsonb
) returns void language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_item jsonb; v_email text; v_role public.team_role;
begin
  select organization_id into v_org from public.teams where id=p_team_id and status='active';
  if v_org is null or not public.is_active_team_admin(p_team_id,p_actor_user_id) then raise exception 'team admin required'; end if;
  for v_item in select value from jsonb_array_elements(p_invitations) loop
    v_email:=lower(btrim(v_item->>'email'));
    v_role:=case when v_item->>'role'='moderator' then 'moderator'::public.team_role else 'basic'::public.team_role end;
    if v_email<>'' then
      insert into public.pending_team_invitations(organization_id,team_id,email,role,invited_by_user_id)
      values(v_org,p_team_id,v_email,v_role,p_actor_user_id)
      on conflict(organization_id,team_id,email) do update set role=excluded.role,
        invited_by_user_id=excluded.invited_by_user_id,accepted_at=null,revoked_at=null,revoked_by_user_id=null;
    end if;
  end loop;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
    values(v_org,p_actor_user_id,'team_invitations_created','team',p_team_id,
      jsonb_build_object('count',jsonb_array_length(p_invitations)));
end $$;

create or replace function public.revoke_team_invitation(
  p_invitation_id uuid,p_actor_user_id uuid
) returns void language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_team uuid;
begin
  select organization_id,team_id into v_org,v_team from public.pending_team_invitations
    where id=p_invitation_id and accepted_at is null and revoked_at is null;
  if v_org is null or not public.is_active_team_admin(v_team,p_actor_user_id) then raise exception 'team admin required'; end if;
  update public.pending_team_invitations set revoked_at=now(),revoked_by_user_id=p_actor_user_id where id=p_invitation_id;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
    values(v_org,p_actor_user_id,'team_invitation_revoked','invitation',p_invitation_id,jsonb_build_object('team_id',v_team));
end $$;

create or replace function public.redeem_pending_team_invitations(p_organization_id uuid,p_user_id uuid,p_email text)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.team_memberships(team_id,user_id,role)
    select i.team_id,p_user_id,i.role from public.pending_team_invitations i join public.teams t on t.id=i.team_id
    where i.organization_id=p_organization_id and i.email=lower(p_email)
      and i.accepted_at is null and i.revoked_at is null and t.status='active'
    on conflict(team_id,user_id) do update set role=excluded.role;
  update public.pending_team_invitations set accepted_at=now()
    where organization_id=p_organization_id and email=lower(p_email) and accepted_at is null and revoked_at is null;
  if exists(select 1 from public.team_memberships m join public.teams t on t.id=m.team_id where m.user_id=p_user_id and t.status='active') then
    update public.users set status='active',updated_at=now() where id=p_user_id and status='inactive';
  end if;
end $$;

create or replace function public.configure_team_webex_space(
  p_team_id uuid,p_actor_user_id uuid,p_organization_id uuid,
  p_provider_space_id text,p_display_name text,p_enabled boolean,p_make_default boolean
) returns void language plpgsql security definer set search_path=public as $$
declare v_space uuid; v_is_default boolean; v_current_default uuid;
begin
  if not public.is_active_team_admin(p_team_id,p_actor_user_id) then raise exception 'team admin required'; end if;
  if not exists(select 1 from public.teams where id=p_team_id and organization_id=p_organization_id) then raise exception 'organization mismatch'; end if;
  insert into public.source_spaces(organization_id,provider,provider_space_id,display_name,is_group_space)
    values(p_organization_id,'webex',p_provider_space_id,btrim(p_display_name),true)
    on conflict(organization_id,provider,provider_space_id) do update set display_name=excluded.display_name
    returning id into v_space;
  select is_default_capture into v_is_default from public.team_space_policies where team_id=p_team_id and source_space_id=v_space;
  select team_id into v_current_default from public.team_space_policies where source_space_id=v_space and is_default_capture limit 1;
  if p_enabled then
    if p_make_default and v_current_default is not null and v_current_default<>p_team_id
      and not public.is_active_team_admin(v_current_default,p_actor_user_id) then
      raise exception 'current default team admin required';
    end if;
    if p_make_default then update public.team_space_policies set is_default_capture=false,updated_at=now() where source_space_id=v_space and is_default_capture; end if;
    insert into public.team_space_policies(team_id,source_space_id,basic_user_visibility,staff_visibility,is_default_capture)
      values(p_team_id,v_space,true,true,p_make_default or not exists(select 1 from public.team_space_policies where source_space_id=v_space and is_default_capture))
      on conflict(team_id,source_space_id) do update set is_default_capture=excluded.is_default_capture,updated_at=now();
  else
    if coalesce(v_is_default,false) then raise exception 'select a replacement default team before removing this space'; end if;
    delete from public.team_space_policies where team_id=p_team_id and source_space_id=v_space;
  end if;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
    values(p_organization_id,p_actor_user_id,'team_space_configured','space',v_space,
      jsonb_build_object('team_id',p_team_id,'enabled',p_enabled,'default_capture',p_make_default));
end $$;

create or replace function public.grant_team_space_access(
  p_source_team_id uuid,p_recipient_team_id uuid,p_source_space_id uuid,p_actor_user_id uuid
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_id uuid;
begin
  select organization_id into v_org from public.teams where id=p_source_team_id and status='active';
  if v_org is null or not public.is_active_team_admin(p_source_team_id,p_actor_user_id) then raise exception 'source team admin required'; end if;
  if not exists(select 1 from public.team_space_policies where team_id=p_source_team_id and source_space_id=p_source_space_id and is_default_capture) then raise exception 'source team must be default for space'; end if;
  if not exists(select 1 from public.teams where id=p_recipient_team_id and organization_id=v_org and status='active') then raise exception 'active recipient team required'; end if;
  insert into public.space_sharing_grants(organization_id,source_team_id,recipient_team_id,source_space_id,granted_by_user_id,status,granted_at,revoked_at,revoked_by_user_id)
    values(v_org,p_source_team_id,p_recipient_team_id,p_source_space_id,p_actor_user_id,'active',now(),null,null)
    on conflict(source_team_id,recipient_team_id,source_space_id) do update set status='active',granted_by_user_id=excluded.granted_by_user_id,granted_at=now(),revoked_at=null,revoked_by_user_id=null
    returning id into v_id;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
    values(v_org,p_actor_user_id,'space_access_granted','space_grant',v_id,jsonb_build_object('source_team_id',p_source_team_id,'recipient_team_id',p_recipient_team_id,'source_space_id',p_source_space_id));
  return v_id;
end $$;

create or replace function public.revoke_team_space_access(p_grant_id uuid,p_actor_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_team uuid;
begin
  select organization_id,source_team_id into v_org,v_team from public.space_sharing_grants where id=p_grant_id and status='active';
  if v_org is null or not public.is_active_team_admin(v_team,p_actor_user_id) then raise exception 'source team admin required'; end if;
  update public.space_sharing_grants set status='revoked',revoked_at=now(),revoked_by_user_id=p_actor_user_id where id=p_grant_id;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id)
    values(v_org,p_actor_user_id,'space_access_revoked','space_grant',p_grant_id);
end $$;

create or replace function public.create_space_access_request(
  p_requester_team_id uuid,p_source_team_id uuid,p_actor_user_id uuid,p_space_ids jsonb,p_note text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_request uuid; v_space uuid;
begin
  select organization_id into v_org from public.teams where id=p_requester_team_id and status='active';
  if v_org is null or not public.is_active_team_admin(p_requester_team_id,p_actor_user_id) then raise exception 'requester team admin required'; end if;
  if not exists(select 1 from public.teams where id=p_source_team_id and organization_id=v_org and status='active') then raise exception 'active source team required'; end if;
  if length(coalesce(p_note,''))>1000 then raise exception 'note too long'; end if;
  insert into public.space_access_requests(organization_id,requester_team_id,source_team_id,requested_by_user_id,note)
    values(v_org,p_requester_team_id,p_source_team_id,p_actor_user_id,btrim(coalesce(p_note,''))) returning id into v_request;
  for v_space in select (value #>> '{}')::uuid from jsonb_array_elements(p_space_ids) loop
    if not exists(select 1 from public.team_space_policies where team_id=p_source_team_id and source_space_id=v_space and is_default_capture) then raise exception 'space is not managed by source team'; end if;
    insert into public.space_access_request_items(request_id,source_space_id) values(v_request,v_space);
  end loop;
  if not exists(select 1 from public.space_access_request_items where request_id=v_request) then raise exception 'at least one space required'; end if;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id)
    values(v_org,p_actor_user_id,'space_access_requested','access_request',v_request);
  return v_request;
end $$;

create or replace function public.decide_space_access_request(
  p_request_id uuid,p_actor_user_id uuid,p_decision text
) returns void language plpgsql security definer set search_path=public as $$
declare v_request public.space_access_requests%rowtype; v_space uuid;
begin
  select * into v_request from public.space_access_requests where id=p_request_id and status='pending' for update;
  if v_request.id is null or not public.is_active_team_admin(v_request.source_team_id,p_actor_user_id) then raise exception 'source team admin required'; end if;
  if p_decision not in ('approved','denied') then raise exception 'invalid decision'; end if;
  if p_decision='approved' then
    for v_space in select source_space_id from public.space_access_request_items where request_id=p_request_id loop
      perform public.grant_team_space_access(v_request.source_team_id,v_request.requester_team_id,v_space,p_actor_user_id);
    end loop;
  end if;
  update public.space_access_requests set status=p_decision,decided_by_user_id=p_actor_user_id,decided_at=now() where id=p_request_id;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
    values(v_request.organization_id,p_actor_user_id,'space_access_request_'||p_decision,'access_request',p_request_id,jsonb_build_object('requester_team_id',v_request.requester_team_id,'source_team_id',v_request.source_team_id));
end $$;

create or replace function public.set_document_organization_visibility(
  p_document_id uuid,p_actor_user_id uuid,p_visible boolean
) returns void language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_team uuid;
begin
  select organization_id,review_team_id into v_org,v_team from public.documents where id=p_document_id and workflow_state='published';
  if v_org is null or not public.is_active_team_admin(v_team,p_actor_user_id) then raise exception 'review team admin required'; end if;
  update public.documents set organization_wide=p_visible,last_updated_by_user_id=p_actor_user_id,updated_at=now() where id=p_document_id;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
    values(v_org,p_actor_user_id,'document_organization_visibility_changed','document',p_document_id,jsonb_build_object('organization_wide',p_visible));
end $$;

-- Existing functions are tightened to use default review routing, capture-level
-- pending-update state, and durable attribution.
create or replace function public.revise_document_draft(
  p_document_id uuid,p_user_id uuid,p_title text,p_problem text,p_summary text,p_steps jsonb,p_warnings jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_review_team uuid; v_capture uuid; v_snapshot uuid; v_version uuid;
begin
  select organization_id,review_team_id into v_org,v_review_team from public.documents where id=p_document_id;
  if v_org is null or not exists(
    select 1 from public.team_memberships m join public.teams t on t.id=m.team_id
    where m.team_id=v_review_team and m.user_id=p_user_id and m.role in ('moderator','admin') and t.status='active'
  ) then raise exception 'review team moderator or admin required'; end if;
  select c.id,s.id into v_capture,v_snapshot from public.capture_requests c
    join public.source_snapshots s on s.capture_request_id=c.id
    where c.document_id=p_document_id and c.status='awaiting_review' order by c.created_at desc limit 1;
  if v_capture is null then raise exception 'pending review required'; end if;
  select id into v_version from public.document_versions where document_id=p_document_id and source_snapshot_id=v_snapshot order by version_number desc limit 1;
  if v_version is null then raise exception 'draft required'; end if;
  update public.document_versions set title=btrim(p_title),problem=btrim(p_problem),summary=btrim(p_summary),steps=p_steps,warnings=p_warnings,moderator_notes='Human-edited review draft'
    where id=v_version;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
    values(v_org,p_user_id,'review_draft_revised','document',p_document_id,jsonb_build_object('version_id',v_version,'capture_id',v_capture));
  return v_version;
end $$;

create or replace function public.moderate_document(
  p_document_id uuid,p_user_id uuid,p_action text,p_label public.knowledge_label default null
) returns void language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_version uuid; v_review_team uuid; v_capture uuid; v_snapshot uuid; v_has_published boolean;
begin
  select organization_id,review_team_id,current_published_version_id is not null into v_org,v_review_team,v_has_published from public.documents where id=p_document_id;
  if v_org is null or not exists(
    select 1 from public.team_memberships m join public.teams t on t.id=m.team_id
    where m.team_id=v_review_team and m.user_id=p_user_id and m.role in ('moderator','admin') and t.status='active'
  ) then raise exception 'review team moderator or admin required'; end if;
  select c.id,s.id into v_capture,v_snapshot from public.capture_requests c
    join public.source_snapshots s on s.capture_request_id=c.id
    where c.document_id=p_document_id and c.status='awaiting_review' order by c.created_at desc limit 1;
  if v_capture is null then raise exception 'pending review required'; end if;
  select id into v_version from public.document_versions where document_id=p_document_id and source_snapshot_id=v_snapshot order by version_number desc limit 1;
  if p_action='approve' then
    if p_label not in ('verified','unresolved') then raise exception 'approval label required'; end if;
    if v_version is null then raise exception 'draft required'; end if;
    update public.documents set workflow_state='published',knowledge_label=p_label,current_published_version_id=v_version,
      rejected_at=null,originally_approved_by_user_id=coalesce(originally_approved_by_user_id,p_user_id),
      last_updated_by_user_id=p_user_id,updated_at=now() where id=p_document_id;
    update public.capture_requests set status='approved' where id=v_capture;
  elsif p_action='reject' then
    update public.capture_requests set status='rejected' where id=v_capture;
    if not v_has_published then
      update public.documents set workflow_state='rejected',rejected_at=now(),last_updated_by_user_id=p_user_id,updated_at=now() where id=p_document_id;
    end if;
  else raise exception 'invalid moderation action'; end if;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id)
    values(v_org,p_user_id,'document_'||p_action,'document',p_document_id);
end $$;

create or replace function public.capture_webex_command(
  p_organization_id uuid,p_user_id uuid,p_team_id uuid,
  p_command public.capture_command,p_provider_event_id text,
  p_space_provider_id text,p_space_name text,p_root_message_id text,
  p_messages jsonb,p_transcript_sha256 text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_space_id uuid; v_document_id uuid; v_capture_id uuid; v_snapshot_id uuid;
  v_sequence integer; v_previous_hash text; v_message jsonb; v_ordinal integer:=0;
  v_key text:='webex:command:'||p_provider_event_id;
begin
  if jsonb_typeof(p_messages)<>'array' or jsonb_array_length(p_messages)=0 then raise exception 'source messages required'; end if;
  if not exists(select 1 from public.users where id=p_user_id and organization_id=p_organization_id and status='active') then raise exception 'active user required'; end if;
  select s.id into v_space_id from public.source_spaces s join public.team_space_policies p on p.source_space_id=s.id
    join public.teams t on t.id=p.team_id
    where s.organization_id=p_organization_id and s.provider='webex' and s.provider_space_id=p_space_provider_id
      and p.team_id=p_team_id and p.is_default_capture and t.status='active' limit 1;
  if v_space_id is null then raise exception 'default capture team required'; end if;
  if not exists(
    select 1 from public.team_memberships m join public.teams t on t.id=m.team_id
    where m.user_id=p_user_id and m.role in ('moderator','admin') and t.status='active' and (
      m.team_id=p_team_id or exists(
        select 1 from public.space_sharing_grants g where g.source_team_id=p_team_id
          and g.recipient_team_id=m.team_id and g.source_space_id=v_space_id and g.status='active'
      )
    )
  ) then raise exception 'authorized staff required'; end if;

  update public.source_spaces set display_name=coalesce(nullif(btrim(p_space_name),''),display_name) where id=v_space_id;
  select document_id into v_document_id from public.capture_requests
    where organization_id=p_organization_id and idempotency_key=v_key limit 1;
  if v_document_id is not null then
    select id,sequence into v_snapshot_id,v_sequence from public.source_snapshots where document_id=v_document_id order by sequence desc limit 1;
    return jsonb_build_object('documentId',v_document_id,'snapshotId',v_snapshot_id,'sequence',v_sequence,'changed',false,'duplicate',true);
  end if;
  select document_id into v_document_id from public.capture_requests
    where organization_id=p_organization_id and root_provider_message_id=p_root_message_id order by created_at asc limit 1;
  if p_command='document' then
    if v_document_id is not null then
      if exists(select 1 from public.document_versions where document_id=v_document_id) then
        select id,sequence into v_snapshot_id,v_sequence from public.source_snapshots where document_id=v_document_id order by sequence desc limit 1;
        return jsonb_build_object('documentId',v_document_id,'snapshotId',v_snapshot_id,'sequence',v_sequence,'changed',false,'alreadyExists',true);
      end if;
      select coalesce(max(sequence),0)+1 into v_sequence from public.source_snapshots where document_id=v_document_id;
      update public.documents set workflow_state='processing',updated_at=now() where id=v_document_id;
    else
      insert into public.documents(organization_id,source_space_id,review_team_id,workflow_state)
        values(p_organization_id,v_space_id,p_team_id,'processing') returning id into v_document_id;
      insert into public.document_teams(document_id,team_id) values(v_document_id,p_team_id) on conflict do nothing;
      v_sequence:=1;
    end if;
  else
    if v_document_id is null then raise exception 'document command required before update'; end if;
    if not exists(select 1 from public.documents where id=v_document_id and review_team_id=p_team_id) then raise exception 'document review team mismatch'; end if;
    select transcript_sha256 into v_previous_hash from public.source_snapshots where document_id=v_document_id order by sequence desc limit 1;
    select coalesce(max(sequence),0)+1 into v_sequence from public.source_snapshots where document_id=v_document_id;
    if v_previous_hash=p_transcript_sha256 then
      select id into v_snapshot_id from public.source_snapshots where document_id=v_document_id order by sequence desc limit 1;
      return jsonb_build_object('documentId',v_document_id,'snapshotId',v_snapshot_id,'sequence',v_sequence-1,'changed',false,'upToDate',true);
    end if;
    update public.documents set workflow_state='processing',updated_at=now() where id=v_document_id and workflow_state<>'published';
  end if;
  insert into public.capture_requests(organization_id,document_id,source_space_id,requested_by_user_id,command,provider_event_id,root_provider_message_id,idempotency_key,status)
    values(p_organization_id,v_document_id,v_space_id,p_user_id,p_command,p_provider_event_id,p_root_message_id,v_key,'processing') returning id into v_capture_id;
  insert into public.source_snapshots(document_id,capture_request_id,sequence,transcript_sha256,captured_at)
    values(v_document_id,v_capture_id,v_sequence,p_transcript_sha256,now()) returning id into v_snapshot_id;
  for v_message in select value from jsonb_array_elements(p_messages) loop
    v_ordinal:=v_ordinal+1;
    insert into public.source_messages(source_snapshot_id,provider_message_id,parent_provider_message_id,author_provider_id,author_display_name,source_markdown,sent_at,ordinal)
    values(v_snapshot_id,v_message->>'id',nullif(v_message->>'parentId',''),coalesce(nullif(v_message->>'personId',''),nullif(v_message->>'personEmail',''),'unknown'),coalesce(nullif(v_message->>'personDisplayName',''),nullif(v_message->>'personEmail',''),'Webex user'),coalesce(nullif(v_message->>'markdown',''),nullif(v_message->>'text',''),'[Attachment or rich content]'),(v_message->>'created')::timestamptz,v_ordinal);
  end loop;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
    values(p_organization_id,p_user_id,'webex_'||p_command::text,'document',v_document_id,jsonb_build_object('review_team_id',p_team_id,'snapshot_sequence',v_sequence,'message_count',v_ordinal));
  return jsonb_build_object('documentId',v_document_id,'snapshotId',v_snapshot_id,'captureId',v_capture_id,'sequence',v_sequence,'changed',true);
end $$;

create or replace function public.revise_published_document(
  p_document_id uuid,p_user_id uuid,p_title text,p_problem text,p_summary text,p_steps jsonb,p_warnings jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_latest public.document_versions%rowtype; v_version_id uuid; v_number integer;
begin
  perform 1 from public.documents where id=p_document_id for update;
  select organization_id into v_org from public.documents where id=p_document_id and workflow_state='published';
  if v_org is null then raise exception 'published document required'; end if;
  if not public.can_revise_document(p_document_id,p_user_id) then raise exception 'document staff access required'; end if;
  if btrim(p_title)='' or btrim(p_problem)='' or btrim(p_summary)='' then raise exception 'title, problem, and summary are required'; end if;
  if jsonb_typeof(p_steps)<>'array' or jsonb_typeof(p_warnings)<>'array' then raise exception 'steps and warnings must be arrays'; end if;
  select * into v_latest from public.document_versions where id=(select current_published_version_id from public.documents where id=p_document_id);
  if v_latest.id is null then raise exception 'published version required'; end if;
  select coalesce(max(version_number),0)+1 into v_number from public.document_versions where document_id=p_document_id;
  insert into public.document_versions(document_id,source_snapshot_id,version_number,title,problem,summary,steps,warnings,evidence_map,moderator_notes,created_by_user_id)
    values(p_document_id,v_latest.source_snapshot_id,v_number,btrim(p_title),btrim(p_problem),btrim(p_summary),p_steps,p_warnings,v_latest.evidence_map,'Human-edited published version',p_user_id)
    returning id into v_version_id;
  update public.documents set current_published_version_id=v_version_id,last_updated_by_user_id=p_user_id,updated_at=now() where id=p_document_id;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
    values(v_org,p_user_id,'published_document_revised','document',p_document_id,jsonb_build_object('version_id',v_version_id,'version_number',v_number));
  return v_version_id;
end $$;

create or replace function public.archive_published_document(p_document_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.documents where id=p_document_id and workflow_state='published';
  if v_org is null then raise exception 'published document required'; end if;
  if not public.can_revise_document(p_document_id,p_user_id) then raise exception 'document staff access required'; end if;
  update public.documents set workflow_state='archived',archived_at=now(),archived_by_user_id=p_user_id,last_updated_by_user_id=p_user_id,updated_at=now() where id=p_document_id;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id)
    values(v_org,p_user_id,'document_archived','document',p_document_id);
end $$;

create or replace function public.remove_team_member(p_team_id uuid,p_target_user_id uuid,p_actor_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_role public.team_role;
begin
  select organization_id into v_org from public.teams where id=p_team_id and status='active';
  if v_org is null or not public.is_active_team_admin(p_team_id,p_actor_user_id) then raise exception 'team admin required'; end if;
  select role into v_role from public.team_memberships where team_id=p_team_id and user_id=p_target_user_id;
  if v_role is null then raise exception 'membership required'; end if;
  if v_role='admin' and (select count(*) from public.team_memberships where team_id=p_team_id and role='admin')<=1 then raise exception 'the final team admin cannot be removed'; end if;
  delete from public.team_memberships where team_id=p_team_id and user_id=p_target_user_id;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
    values(v_org,p_actor_user_id,'team_member_removed','user',p_target_user_id,jsonb_build_object('team_id',p_team_id,'role',v_role));
end $$;

revoke all on function public.is_active_team_admin(uuid,uuid) from public,anon,authenticated;
revoke all on function public.can_revise_document(uuid,uuid) from public,anon,authenticated;
revoke all on function public.create_team_with_setup(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.update_team_profile(uuid,uuid,text,public.team_status) from public,anon,authenticated;
revoke all on function public.create_team_invitations(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.revoke_team_invitation(uuid,uuid) from public,anon,authenticated;
revoke all on function public.configure_team_webex_space(uuid,uuid,uuid,text,text,boolean,boolean) from public,anon,authenticated;
revoke all on function public.grant_team_space_access(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.revoke_team_space_access(uuid,uuid) from public,anon,authenticated;
revoke all on function public.create_space_access_request(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.decide_space_access_request(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.set_document_organization_visibility(uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.remove_team_member(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.is_active_team_admin(uuid,uuid) to service_role;
grant execute on function public.can_revise_document(uuid,uuid) to service_role;
grant execute on function public.create_team_with_setup(uuid,uuid,text,jsonb,jsonb) to service_role;
grant execute on function public.update_team_profile(uuid,uuid,text,public.team_status) to service_role;
grant execute on function public.create_team_invitations(uuid,uuid,jsonb) to service_role;
grant execute on function public.revoke_team_invitation(uuid,uuid) to service_role;
grant execute on function public.configure_team_webex_space(uuid,uuid,uuid,text,text,boolean,boolean) to service_role;
grant execute on function public.grant_team_space_access(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.revoke_team_space_access(uuid,uuid) to service_role;
grant execute on function public.create_space_access_request(uuid,uuid,uuid,jsonb,text) to service_role;
grant execute on function public.decide_space_access_request(uuid,uuid,text) to service_role;
grant execute on function public.set_document_organization_visibility(uuid,uuid,boolean) to service_role;
grant execute on function public.remove_team_member(uuid,uuid,uuid) to service_role;
