-- A team may unassign its only/default Webex space. Existing knowledge remains
-- attached to its source space, while future capture commands are ignored until
-- an active team assigns the space again and becomes its default review team.
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
    delete from public.team_space_policies where team_id=p_team_id and source_space_id=v_space;
  end if;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
    values(p_organization_id,p_actor_user_id,'team_space_configured','space',v_space,
      jsonb_build_object('team_id',p_team_id,'enabled',p_enabled,'default_capture',p_make_default,'was_default',coalesce(v_is_default,false)));
end $$;

revoke all on function public.configure_team_webex_space(uuid,uuid,uuid,text,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.configure_team_webex_space(uuid,uuid,uuid,text,text,boolean,boolean) to service_role;
