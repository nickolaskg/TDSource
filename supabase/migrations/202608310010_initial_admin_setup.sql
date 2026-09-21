-- Initial-admin setup is durable server data: a team, pending access grants,
-- and approved Webex source spaces. Invitation delivery is intentionally
-- separate; an invite is redeemed only after the email owner completes OAuth.

alter table public.organizations add column if not exists initial_setup_completed_at timestamptz;

create table if not exists public.pending_team_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  email text not null,
  role public.team_role not null default 'basic',
  invited_by_user_id uuid not null references public.users(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, team_id, email)
);

alter table public.pending_team_invitations enable row level security;
revoke all on public.pending_team_invitations from anon, authenticated;

create or replace function public.complete_initial_admin_setup(
  p_organization_id uuid, p_actor_user_id uuid, p_team_name text,
  p_invited_emails jsonb, p_rooms jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare v_team_id uuid; v_email text; v_room jsonb; v_space_id uuid;
begin
  if btrim(p_team_name)='' then raise exception 'team name required'; end if;
  if jsonb_typeof(p_invited_emails) <> 'array' or jsonb_typeof(p_rooms) <> 'array' then raise exception 'setup arrays required'; end if;
  if exists(select 1 from public.organizations where id=p_organization_id and initial_setup_completed_at is not null) then
    raise exception 'initial setup already completed';
  end if;
  select m.team_id into v_team_id from public.team_memberships m join public.teams t on t.id=m.team_id
    where m.user_id=p_actor_user_id and m.role='admin' and t.organization_id=p_organization_id and t.status='active' limit 1;
  if v_team_id is null then raise exception 'administrator required'; end if;
  update public.teams set name=btrim(p_team_name) where id=v_team_id;
  for v_email in select lower(btrim(value #>> '{}')) from jsonb_array_elements(p_invited_emails) loop
    if v_email <> '' then insert into public.pending_team_invitations(organization_id,team_id,email,invited_by_user_id)
      values(p_organization_id,v_team_id,v_email,p_actor_user_id) on conflict(organization_id,team_id,email) do nothing; end if;
  end loop;
  for v_room in select value from jsonb_array_elements(p_rooms) loop
    if coalesce(v_room->>'id','') = '' then raise exception 'room id required'; end if;
    insert into public.source_spaces(organization_id,provider,provider_space_id,display_name,is_group_space)
      values(p_organization_id,'webex',v_room->>'id',coalesce(nullif(v_room->>'title',''),'Untitled Webex space'),true)
      on conflict(organization_id,provider,provider_space_id) do update set display_name=excluded.display_name
      returning id into v_space_id;
    insert into public.team_space_policies(team_id,source_space_id,basic_user_visibility,staff_visibility)
      values(v_team_id,v_space_id,true,true) on conflict(team_id,source_space_id) do nothing;
  end loop;
  update public.organizations set initial_setup_completed_at=now() where id=p_organization_id;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
    values(p_organization_id,p_actor_user_id,'initial_setup_completed','team',v_team_id,jsonb_build_object('invite_count',jsonb_array_length(p_invited_emails),'room_count',jsonb_array_length(p_rooms)));
end $$;

create or replace function public.redeem_pending_team_invitations(p_organization_id uuid, p_user_id uuid, p_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.team_memberships(team_id,user_id,role)
    select team_id,p_user_id,role from public.pending_team_invitations
    where organization_id=p_organization_id and email=lower(p_email) and accepted_at is null
    on conflict(team_id,user_id) do nothing;
  update public.pending_team_invitations set accepted_at=now()
    where organization_id=p_organization_id and email=lower(p_email) and accepted_at is null;
  if exists(select 1 from public.team_memberships where user_id=p_user_id) then
    update public.users set status='active',updated_at=now() where id=p_user_id and status='inactive';
  end if;
end $$;

revoke all on function public.complete_initial_admin_setup(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.redeem_pending_team_invitations(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.complete_initial_admin_setup(uuid,uuid,text,jsonb,jsonb) to service_role;
grant execute on function public.redeem_pending_team_invitations(uuid,uuid,text) to service_role;
