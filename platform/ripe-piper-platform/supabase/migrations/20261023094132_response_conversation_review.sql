-- Append human ownership/resolution to the existing evidence graph. No sending or hold release.
alter table public.lead_observations drop constraint product_context_shape;
alter table public.lead_observations add constraint product_context_shape check (
 product_context is null or coalesce((jsonb_typeof(product_context)='object'
 and assessment_reviewed_by is not null and product_context->>'product' in ('revive','signal','response','events')
 and ((product_context->>'product'='revive' and product_context->>'kind'='history')
 or (product_context->>'product'='signal' and product_context->>'kind'='trigger')
 or (product_context->>'product'='response' and product_context->>'kind' in ('enquiry','reply','conversation_review'))
 or (product_context->>'product'='events' and product_context->>'kind' in ('registration','attendance'))
 or product_context->>'kind'='outcome')),false)
);
-- Never permit browser direct writes to create an ownership/resolution assertion.
create function public.guard_response_review() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (new.source='response_review' or new.product_context->>'kind'='conversation_review' or (tg_op='UPDATE' and (old.source='response_review' or old.product_context->>'kind'='conversation_review'))) and current_user<>'service_role' then
  raise exception 'Staff service review required' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.guard_response_review() from public,anon,authenticated;
create trigger guard_response_review before insert or update on public.lead_observations for each row execute function public.guard_response_review();
-- Read only identity fields needed to check current verified assignees. No public grant.
grant usage on schema auth to service_role;
grant select on public.memberships to service_role;
grant select(id,email,email_confirmed_at) on auth.users to service_role;
create function public.response_review_owners(p_tenant uuid,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Staff service required' using errcode='42501'; end if;
 if not exists(select 1 from public.tenants where id=p_tenant) then raise exception 'Tenant missing' using errcode='22023'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'label',left(coalesce(nullif(trim(p.full_name),''),p.email),320)) order by p.id),'[]'::jsonb) into result
 from public.profiles p join auth.users u on u.id=p.id and u.email_confirmed_at is not null and lower(u.email)=lower(p.email)
 where p.is_admin or exists(select 1 from public.memberships m where m.user_id=p.id and m.tenant_id=p_tenant and m.role='owner');
 return result;
end $$;
revoke all on function public.response_review_owners(uuid,uuid) from public,anon,authenticated;
grant execute on function public.response_review_owners(uuid,uuid) to service_role;
create function public.save_response_review(p_tenant uuid,p_lead uuid,p_thread text,p_actor uuid,p_owner uuid,p_expected_version integer,p_inbound_snapshot text,p_state text,p_reason text,p_request uuid,p_synthetic boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous public.lead_observations%rowtype; inbound text; latest_version integer; owner_label text; result uuid; context jsonb; lead_email text;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Staff service required' using errcode='42501'; end if;
 perform 1 from public.tenants where id=p_tenant and status in ('onboarding','active') for update;
 if not found then raise exception 'Tenant unavailable' using errcode='22023'; end if;
 select email into lead_email from public.leads where tenant_id=p_tenant and id=p_lead;
 if not found or p_synthetic is null or p_synthetic<>(lower(lead_email) like '%.invalid') then raise exception 'Lead scope or evidence mode mismatch' using errcode='22023'; end if;
 if coalesce(length(trim(p_thread)),0) not between 1 and 240 or p_state not in ('open','resolved') or p_state is null
 or coalesce(length(trim(p_reason)),0) not between 1 and 1000 or p_request is null or p_expected_version is null or p_expected_version<0
 or coalesce(length(p_inbound_snapshot),0) not between 36 and 37000 then raise exception 'Incomplete conversation review' using errcode='22023'; end if;
 -- Same request identity can be retried safely even if a later inbound has arrived.
 select * into previous from public.lead_observations where tenant_id=p_tenant and source='response_review' and external_ref=p_request::text;
 if found then
  if previous.lead_id=p_lead and previous.assessment_reviewed_by=p_actor and previous.synthetic=p_synthetic and previous.assessment_excerpt=trim(p_reason)
  and previous.product_context->>'threadRef'=p_thread and previous.product_context->>'ownerId'=p_owner::text and previous.product_context->>'state'=p_state
  and previous.product_context->>'inboundSnapshot'=p_inbound_snapshot and (previous.product_context->>'version')::integer=p_expected_version+1 then
   return jsonb_build_object('id',previous.id,'version',p_expected_version+1,'replayed',true);
  end if;
  raise exception 'Review reference reused' using errcode='23505';
 end if;
 select left(coalesce(nullif(trim(p.full_name),''),p.email),320) into owner_label from public.profiles p join auth.users u on u.id=p.id
 where p.id=p_owner and u.email_confirmed_at is not null and lower(u.email)=lower(p.email)
 and (p.is_admin or exists(select 1 from public.memberships m where m.tenant_id=p_tenant and m.user_id=p.id and m.role='owner'));
 if not found then raise exception 'Owner is not currently authorized' using errcode='42501'; end if;
 select string_agg(id::text,',' order by id) into inbound from public.lead_observations where tenant_id=p_tenant and lead_id=p_lead and synthetic=p_synthetic and assessment_reviewed_by is not null
 and product_context->>'product'='response' and product_context->>'kind' in ('enquiry','reply') and product_context->>'threadRef'=p_thread;
 if inbound is null or inbound<>p_inbound_snapshot then raise exception 'Inbound evidence changed' using errcode='40001'; end if;
 select coalesce(max((product_context->>'version')::integer),0) into latest_version from public.lead_observations where tenant_id=p_tenant and lead_id=p_lead and synthetic=p_synthetic and source='response_review' and product_context->>'threadRef'=p_thread;
 if latest_version<>p_expected_version then raise exception 'Conversation review changed' using errcode='40001'; end if;
 context:=jsonb_build_object('product','response','kind','conversation_review','threadRef',p_thread,'ownerId',p_owner,'ownerLabel',owner_label,'version',latest_version+1,'inboundSnapshot',inbound,'state',p_state,'reason',trim(p_reason));
 insert into public.lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_excerpt,assessment_reviewed_by,product_context,brief_version)
 values(p_tenant,p_lead,'response_review',p_request::text,now(),'human conversation review','staff review of existing inbound evidence',p_synthetic,trim(p_reason),p_actor,context,(select max(version) from public.business_briefs where tenant_id=p_tenant)) returning id into result;
 return jsonb_build_object('id',result,'version',latest_version+1,'replayed',false);
end $$;
revoke all on function public.save_response_review(uuid,uuid,text,uuid,uuid,integer,text,text,text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.save_response_review(uuid,uuid,text,uuid,uuid,integer,text,text,text,uuid,boolean) to service_role;
