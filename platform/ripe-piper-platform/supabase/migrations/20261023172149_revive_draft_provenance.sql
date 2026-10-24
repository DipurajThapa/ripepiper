-- RP-020: recheck generated draft provenance inside the existing campaign save
-- transaction. No separate campaign engine, approval or sending authority.
create function public.save_reviewed_revive_draft(
 p_tenant uuid,p_campaign uuid,p_actor uuid,p_version integer,p_body jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare d jsonb; lead uuid; source_id uuid; expires timestamptz;
 result jsonb; audit text;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=p_actor and is_admin) then
  raise exception 'Staff required' using errcode='42501';
 end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if not found then raise exception 'Tenant missing' using errcode='23503'; end if;
 d:=p_body->'draftContext';
 if p_body->>'product' is distinct from 'revive' or jsonb_typeof(d) is distinct from 'object'
  or jsonb_typeof(d->'leadId') is distinct from 'string' or jsonb_typeof(d->'sourceId') is distinct from 'string'
  or coalesce(d->>'snapshot','') !~ '^[0-9a-f]{32}$'
  or jsonb_typeof(d->'briefVersion') is distinct from 'number' or coalesce(d->>'briefVersion','') !~ '^[1-9][0-9]{0,8}$'
  or jsonb_typeof(d->'reviewVersion') is distinct from 'number' or coalesce(d->>'reviewVersion','') !~ '^[1-9][0-9]{0,8}$'
  or jsonb_typeof(d->'expiresAt') is distinct from 'string'
  or d->>'businessName' is distinct from (select name from public.tenants where id=p_tenant) then
  raise exception 'Invalid draft provenance' using errcode='22023';
 end if;
 lead:=(d->>'leadId')::uuid;source_id:=(d->>'sourceId')::uuid;expires:=(d->>'expiresAt')::timestamptz;
 if expires<=now() or expires>now()+interval '1 day'
  or not public.revive_candidate_current(p_tenant,lead,now())
  or not exists(select 1 from public.revive_reviews r where r.tenant_id=p_tenant and r.lead_id=lead
    and r.snapshot=d->>'snapshot' and r.brief_version=(d->>'briefVersion')::integer
    and r.version=(d->>'reviewVersion')::integer and r.expires_at>=expires)
  or not exists(select 1 from public.lead_observations o join public.leads l on l.tenant_id=o.tenant_id and l.id=o.lead_id
    join public.business_briefs b on b.tenant_id=o.tenant_id and b.version=(d->>'briefVersion')::integer
    where o.id=source_id and o.tenant_id=p_tenant and o.lead_id=lead and o.assessment_reviewed_by is not null
      and o.synthetic=(lower(l.email) like '%.invalid') and o.observed_at<=now()
      and o.observed_at+((b.body->>'maxAgeDays')::integer)*interval '1 day'>=expires
      and length(trim(coalesce(o.rights_reference,'')))>0) then
  raise exception 'Draft evidence changed or expired' using errcode='40001';
 end if;
 result:=public.manage_campaign_plan(p_tenant,p_campaign,p_actor,'save',p_version,p_body);
 audit:=jsonb_build_object('kind','revive_draft_saved','campaign',p_campaign,'assetVersion',result->'version','provenance',d)::text;
 -- The tenant lock makes a replay of the same save/audit idempotent.
 if not exists(select 1 from public.activity_log where tenant_id=p_tenant and message=audit) then
  insert into public.activity_log(tenant_id,actor,kind,message,visible_to_client)
   values(p_tenant,p_actor::text,'note',audit,false);
 end if;
 return result;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
 raise exception 'Invalid draft provenance' using errcode='22023';
end $$;
revoke all on function public.save_reviewed_revive_draft(uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_reviewed_revive_draft(uuid,uuid,uuid,integer,jsonb) to service_role;
