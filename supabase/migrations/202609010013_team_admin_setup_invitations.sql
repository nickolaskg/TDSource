-- Single-use, email-bound invitations that authorize one user to create one
-- team and become that team's first Admin. Possession of a token alone never
-- grants a role; Webex sign-in and exact email matching are required.
create table if not exists public.team_admin_setup_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  invited_by_user_id uuid not null references public.users(id),
  expires_at timestamptz not null,
  started_at timestamptz,
  redeemed_at timestamptz,
  redeemed_by_user_id uuid references public.users(id),
  created_team_id uuid references public.teams(id),
  revoked_at timestamptz,
  revoked_by_user_id uuid references public.users(id),
  created_at timestamptz not null default now(),
  check (email=lower(btrim(email))),
  check (expires_at>created_at)
);

create index if not exists team_admin_setup_invites_org_idx
  on public.team_admin_setup_invitations(organization_id,created_at desc);
create unique index if not exists team_admin_setup_invites_pending_email_idx
  on public.team_admin_setup_invitations(organization_id,email)
  where redeemed_at is null and revoked_at is null;

alter table public.team_admin_setup_invitations enable row level security;
revoke all on public.team_admin_setup_invitations from anon,authenticated;

create or replace function public.create_team_admin_setup_invitation(
  p_organization_id uuid,p_actor_user_id uuid,p_email text,p_token_hash text,p_expires_at timestamptz
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_email text:=lower(btrim(p_email));
begin
  if not exists(
    select 1 from public.team_memberships m join public.teams t on t.id=m.team_id
    where m.user_id=p_actor_user_id and m.role='admin' and t.status='active'
      and t.organization_id=p_organization_id
  ) then raise exception 'active team admin required'; end if;
  if v_email='' or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'valid invitation required'; end if;
  if p_expires_at<=now() or p_expires_at>now()+interval '30 days' then raise exception 'invalid expiration'; end if;
  update public.team_admin_setup_invitations set revoked_at=now(),revoked_by_user_id=p_actor_user_id
    where organization_id=p_organization_id and email=v_email and redeemed_at is null and revoked_at is null;
  insert into public.team_admin_setup_invitations(organization_id,email,token_hash,invited_by_user_id,expires_at)
    values(p_organization_id,v_email,p_token_hash,p_actor_user_id,p_expires_at) returning id into v_id;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
    values(p_organization_id,p_actor_user_id,'team_admin_setup_invitation_created','admin_setup_invitation',v_id,
      jsonb_build_object('email',v_email,'expires_at',p_expires_at));
  return v_id;
end $$;

create or replace function public.revoke_team_admin_setup_invitation(
  p_invitation_id uuid,p_actor_user_id uuid
) returns void language plpgsql security definer set search_path=public as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.team_admin_setup_invitations
    where id=p_invitation_id and redeemed_at is null and revoked_at is null and expires_at>now();
  if v_org is null or not exists(
    select 1 from public.team_memberships m join public.teams t on t.id=m.team_id
    where m.user_id=p_actor_user_id and m.role='admin' and t.status='active' and t.organization_id=v_org
  ) then raise exception 'active team admin required'; end if;
  update public.team_admin_setup_invitations set revoked_at=now(),revoked_by_user_id=p_actor_user_id where id=p_invitation_id;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id)
    values(v_org,p_actor_user_id,'team_admin_setup_invitation_revoked','admin_setup_invitation',p_invitation_id);
end $$;

create or replace function public.complete_team_admin_setup_invitation(
  p_invitation_id uuid,p_token_hash text,p_user_id uuid,p_team_name text,
  p_invitations jsonb,p_rooms jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_invite public.team_admin_setup_invitations%rowtype; v_team_id uuid;
  v_item jsonb; v_email text; v_role public.team_role; v_space_id uuid;
begin
  select * into v_invite from public.team_admin_setup_invitations where id=p_invitation_id for update;
  if v_invite.id is null or v_invite.token_hash<>p_token_hash or v_invite.redeemed_at is not null
    or v_invite.revoked_at is not null or v_invite.expires_at<=now() then raise exception 'invitation unavailable'; end if;
  if not exists(select 1 from public.users where id=p_user_id and organization_id=v_invite.organization_id and email=v_invite.email and status<>'suspended')
    then raise exception 'invited Webex identity required'; end if;
  if btrim(p_team_name)='' or length(btrim(p_team_name))>120 then raise exception 'valid team name required'; end if;
  if jsonb_typeof(coalesce(p_invitations,'[]'::jsonb))<>'array' or jsonb_typeof(coalesce(p_rooms,'[]'::jsonb))<>'array'
    then raise exception 'setup arrays required'; end if;
  if jsonb_array_length(coalesce(p_rooms,'[]'::jsonb))=0 then raise exception 'at least one Webex space required'; end if;

  insert into public.teams(organization_id,name) values(v_invite.organization_id,btrim(p_team_name)) returning id into v_team_id;
  insert into public.team_memberships(team_id,user_id,role) values(v_team_id,p_user_id,'admin');
  update public.users set status='active',updated_at=now() where id=p_user_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_invitations,'[]'::jsonb)) loop
    v_email:=lower(btrim(v_item->>'email'));
    v_role:=case when v_item->>'role'='moderator' then 'moderator'::public.team_role else 'basic'::public.team_role end;
    if v_email<>'' then
      insert into public.pending_team_invitations(organization_id,team_id,email,role,invited_by_user_id)
        values(v_invite.organization_id,v_team_id,v_email,v_role,p_user_id)
        on conflict(organization_id,team_id,email) do update set role=excluded.role,
          invited_by_user_id=excluded.invited_by_user_id,accepted_at=null,revoked_at=null,revoked_by_user_id=null;
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_rooms,'[]'::jsonb)) loop
    insert into public.source_spaces(organization_id,provider,provider_space_id,display_name,is_group_space)
      values(v_invite.organization_id,'webex',v_item->>'id',coalesce(nullif(v_item->>'title',''),'Untitled Webex space'),true)
      on conflict(organization_id,provider,provider_space_id) do update set display_name=excluded.display_name
      returning id into v_space_id;
    insert into public.team_space_policies(team_id,source_space_id,basic_user_visibility,staff_visibility,is_default_capture)
      values(v_team_id,v_space_id,true,true,not exists(select 1 from public.team_space_policies where source_space_id=v_space_id and is_default_capture))
      on conflict(team_id,source_space_id) do update set updated_at=now();
  end loop;

  update public.team_admin_setup_invitations set redeemed_at=now(),redeemed_by_user_id=p_user_id,created_team_id=v_team_id
    where id=p_invitation_id;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
    values(v_invite.organization_id,p_user_id,'team_admin_setup_completed','team',v_team_id,
      jsonb_build_object('invitation_id',p_invitation_id,'invite_count',jsonb_array_length(coalesce(p_invitations,'[]'::jsonb)),'room_count',jsonb_array_length(coalesce(p_rooms,'[]'::jsonb))));
  return v_team_id;
end $$;

revoke all on function public.create_team_admin_setup_invitation(uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.revoke_team_admin_setup_invitation(uuid,uuid) from public,anon,authenticated;
revoke all on function public.complete_team_admin_setup_invitation(uuid,text,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.create_team_admin_setup_invitation(uuid,uuid,text,text,timestamptz) to service_role;
grant execute on function public.revoke_team_admin_setup_invitation(uuid,uuid) to service_role;
grant execute on function public.complete_team_admin_setup_invitation(uuid,text,uuid,text,jsonb,jsonb) to service_role;
