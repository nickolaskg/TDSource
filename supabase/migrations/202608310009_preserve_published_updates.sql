-- A thread update creates a new review draft without withdrawing the currently
-- published version. Failed processing is represented by its capture request,
-- not by an accidentally generated review version.

create or replace function public.complete_generated_draft(
  p_document_id uuid, p_snapshot_id uuid, p_user_id uuid,
  p_title text, p_problem text, p_summary text, p_steps jsonb,
  p_warnings jsonb, p_evidence_map jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_version_id uuid; v_number integer; v_capture_id uuid; v_org uuid; v_published boolean;
begin
  select d.organization_id, d.current_published_version_id is not null
    into v_org, v_published
    from public.documents d join public.source_snapshots s on s.document_id=d.id
    where d.id=p_document_id and s.id=p_snapshot_id;
  if v_org is null then raise exception 'snapshot does not belong to document'; end if;
  select coalesce(max(version_number),0)+1 into v_number from public.document_versions where document_id=p_document_id;
  insert into public.document_versions(document_id,source_snapshot_id,version_number,title,problem,summary,steps,warnings,evidence_map,created_by_user_id)
    values(p_document_id,p_snapshot_id,v_number,p_title,p_problem,p_summary,p_steps,p_warnings,p_evidence_map,p_user_id) returning id into v_version_id;
  if not v_published then
    update public.documents set workflow_state='awaiting_review',updated_at=now() where id=p_document_id;
  end if;
  select capture_request_id into v_capture_id from public.source_snapshots where id=p_snapshot_id;
  update public.capture_requests set status='awaiting_review', safe_error_code=null where id=v_capture_id;
  insert into public.audit_events(organization_id,actor_user_id,action,target_type,target_id,metadata)
    values(v_org,p_user_id,'draft_generated','document',p_document_id,jsonb_build_object('version_id',v_version_id,'version_number',v_number));
  return v_version_id;
end $$;
