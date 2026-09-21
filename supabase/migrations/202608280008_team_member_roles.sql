-- Admin-controlled team membership and role changes with lockout protection.

create or replace function public.set_team_member_role(
  p_team_id uuid, p_target_user_id uuid, p_actor_user_id uuid,
  p_role public.team_role
) returns void language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_old_role public.team_role;
begin
  select organization_id into v_org from public.teams where id=p_team_id and status='active';
  if v_org is null then raise exception 'active team required'; end if;
  if not exists (
    select 1 from public.team_memberships where team_id=p_team_id
      and user_id=p_actor_user_id and role='admin'
  ) then raise exception 'team admin required'; end if;
  if p_target_user_id=p_actor_user_id and p_role <> 'admin' then
    raise exception 'administrators cannot demote their own account';
  end if;
  if not exists (
    select 1 from public.users where id=p_target_user_id
      and organization_id=v_org and status <> 'suspended'
  ) then raise exception 'eligible organization user required'; end if;
  select role into v_old_role from public.team_memberships
    where team_id=p_team_id and user_id=p_target_user_id;
  if v_old_role='admin' and p_role <> 'admin' and (
    select count(*) from public.team_memberships where team_id=p_team_id and role='admin'
  ) <= 1 then raise exception 'the final team admin cannot be demoted'; end if;
  insert into public.team_memberships(team_id,user_id,role)
    values(p_team_id,p_target_user_id,p_role)
    on conflict(team_id,user_id) do update set role=excluded.role;
  update public.users set status='active',updated_at=now()
    where id=p_target_user_id and status='inactive';
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
    values(v_org,p_actor_user_id,'team_role_changed','user',p_target_user_id,
      jsonb_build_object('team_id',p_team_id,'old_role',v_old_role,'new_role',p_role));
end $$;

revoke all on function public.set_team_member_role(uuid,uuid,uuid,public.team_role)
  from public,anon,authenticated;
grant execute on function public.set_team_member_role(uuid,uuid,uuid,public.team_role)
  to service_role;
