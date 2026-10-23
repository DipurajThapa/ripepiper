-- Shared reviewed product history extends the existing provenance graph.
-- No production seed, provider connection, delivery or automatic qualification.
alter table public.lead_observations add column product_context jsonb, add column brief_version integer;
alter table public.lead_observations add foreign key (tenant_id,brief_version) references public.business_briefs(tenant_id,version);
alter table public.lead_observations add constraint product_context_shape check (
 product_context is null or coalesce((jsonb_typeof(product_context)='object'
 and assessment_reviewed_by is not null
 and product_context->>'product' in ('revive','signal','response','events')
 and ((product_context->>'product'='revive' and product_context->>'kind'='history')
 or (product_context->>'product'='signal' and product_context->>'kind'='trigger')
 or (product_context->>'product'='response' and product_context->>'kind' in ('enquiry','reply'))
 or (product_context->>'product'='events' and product_context->>'kind' in ('registration','attendance'))
 or product_context->>'kind'='outcome')),false)
);
create index product_history on public.lead_observations (tenant_id,lead_id,observed_at desc) where product_context is not null;
create function public.record_product_event(p_tenant uuid,p_lead uuid,p_actor uuid,p_reference text,p_rights text,p_excerpt text,p_observed timestamptz,p_synthetic boolean,p_context jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare previous public.lead_observations%rowtype; lead_email text; result uuid;
begin
 if current_user <> 'service_role' or not exists(select 1 from public.profiles where id=p_actor and is_admin) then
  raise exception 'Staff service required' using errcode='42501';
 end if;
 perform 1 from public.tenants where id=p_tenant for update;
 select email into lead_email from public.leads where tenant_id=p_tenant and id=p_lead;
 if not found then raise exception 'Lead scope mismatch' using errcode='23503'; end if;
 if p_synthetic is null or p_synthetic <> (lower(lead_email) like '%.invalid') then raise exception 'Evidence mode mismatch' using errcode='22023'; end if;
 if p_observed is null or p_observed>now() or coalesce(length(trim(p_reference)),0) not between 1 and 240
  or coalesce(length(trim(p_rights)),0) not between 1 and 240 or coalesce(length(trim(p_excerpt)),0) not between 1 and 2000
  or p_context is null or coalesce(p_context->>'product','') not in ('revive','signal','response','events')
  or coalesce(p_context->>'kind','') not in ('history','trigger','enquiry','reply','registration','attendance','outcome') then
  raise exception 'Incomplete reviewed product event' using errcode='22023';
 end if;
 select * into previous from public.lead_observations where tenant_id=p_tenant and source='product_review' and external_ref=p_reference;
 if found then
  if previous.lead_id=p_lead and previous.product_context=p_context and previous.assessment_excerpt=p_excerpt
   and previous.observed_at=p_observed and previous.synthetic=p_synthetic and previous.rights_reference=p_rights then return previous.id; end if;
  raise exception 'Reference reused with different evidence' using errcode='23505';
 end if;
 insert into public.lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_excerpt,assessment_reviewed_by,product_context,brief_version)
 values(p_tenant,p_lead,'product_review',p_reference,p_observed,'managed product review',p_rights,p_synthetic,p_excerpt,p_actor,p_context,(select max(version) from public.business_briefs where tenant_id=p_tenant)) returning id into result;
 return result;
end $$;
revoke all on function public.record_product_event(uuid,uuid,uuid,text,text,text,timestamptz,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.record_product_event(uuid,uuid,uuid,text,text,text,timestamptz,boolean,jsonb) to service_role;

-- Re-importing or queuing another campaign cannot bypass a conversation hold.
create or replace function public.synthetic_action_allowed(p_id uuid, p_now timestamptz) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.outbound_actions a
    join public.campaigns c on c.id=a.campaign_id and c.tenant_id=a.tenant_id
    join public.leads l on l.id=a.lead_id and l.tenant_id=a.tenant_id
    join public.tenants t on t.id=a.tenant_id
    where a.id=p_id and p_now is not null and t.status='active' and c.status='approved'
      and c.expires_at>p_now and (c.starts_at is null or c.starts_at<=p_now)
      and (c.ends_at is null or c.ends_at>p_now)
      and a.approval_version=c.approval_version and a.asset_version=c.asset_version
      and lower(l.email) like '%.invalid' and l.status<>'unsubscribed'
      and not exists (select 1 from public.outbound_stops s where s.lifted_at is null and
        (s.scope='global' or (s.tenant_id=a.tenant_id and (s.scope='tenant' or s.campaign_id=a.campaign_id))))
      and not exists (select 1 from public.lead_observations o where o.tenant_id=a.tenant_id and o.lead_id=a.lead_id
        and o.product_context->>'product'='response' and o.product_context->>'kind' in ('enquiry','reply'))
      and not exists (select 1 from public.suppression s where s.email=lower(l.email))
      and not exists (select 1 from public.lead_suppression s where s.tenant_id=a.tenant_id and s.lead_id=a.lead_id)
      and exists (select 1 from public.contact_rights r where r.tenant_id=a.tenant_id and r.lead_id=a.lead_id
        and r.purpose=c.purpose and r.channel=c.channel and r.market=c.market and r.decision='permitted'
        and r.reviewer_id is not null and r.notice_reference is not null and r.objected_at is null
        and r.withdrawn_at is null and (r.expires_at is null or r.expires_at>p_now))
  )
$$;
revoke all on function public.synthetic_action_allowed(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.synthetic_action_allowed(uuid,timestamptz) to service_role;


-- Staff import reuses the existing tenant/email identity and observation uniqueness.
-- Rows without provenance are rejected, not silently made contactable.
create function public.import_review_lead(p_tenant uuid,p_actor uuid,p_email text,p_company text,p_reference text,p_rights text,p_observed timestamptz,p_synthetic boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare l uuid; existing public.lead_observations%rowtype; observation uuid; created boolean:=false;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Staff service required' using errcode='42501'; end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if not found then raise exception 'Tenant missing' using errcode='23503'; end if;
 if p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  or p_synthetic is null or p_synthetic<>(lower(trim(p_email)) like '%.invalid')
  or coalesce(length(trim(p_company)),0) not between 1 and 240
  or coalesce(length(trim(p_reference)),0) not between 1 and 240 or coalesce(length(trim(p_rights)),0) not between 1 and 240
  or p_observed is null or p_observed>now() then raise exception 'Invalid import row' using errcode='22023'; end if;
 select id into l from public.leads where tenant_id=p_tenant and lower(email)=lower(trim(p_email));
 select * into existing from public.lead_observations where tenant_id=p_tenant and source='staff_import' and external_ref=p_reference;
 if found then
  if existing.lead_id=l and existing.rights_reference=p_rights and existing.observed_at=p_observed and existing.synthetic=p_synthetic then
   return jsonb_build_object('lead_id',l,'observation_id',existing.id,'state','duplicate');
  end if;
  raise exception 'Source reference conflict' using errcode='23505';
 end if;
 if l is null then
  if (select count(*) from public.leads where tenant_id=p_tenant)>=100 then raise exception 'Review capacity exceeded' using errcode='22023'; end if;
  insert into public.leads(tenant_id,source,email,company) values(p_tenant,'import',lower(trim(p_email)),trim(p_company)) returning id into l;
  created:=true;
 end if;
 insert into public.lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_reviewed_by)
 values(p_tenant,l,'staff_import',p_reference,p_observed,'managed prospect review',p_rights,p_synthetic,p_actor) returning id into observation;
 return jsonb_build_object('lead_id',l,'observation_id',observation,'state',case when created then 'created' else 'linked' end);
end $$;
revoke all on function public.import_review_lead(uuid,uuid,text,text,text,text,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.import_review_lead(uuid,uuid,text,text,text,text,timestamptz,boolean) to service_role;
grant insert on public.leads to service_role;

-- The stop is attached to provenance persistence so alternate staff write paths cannot bypass it.
create function public.apply_product_reply_stop() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.product_context->>'product'='response' and new.product_context->>'kind' in ('enquiry','reply') then
  update public.outbound_actions set state=case when state='claimed' then 'review' else 'cancelled' end,
   error_code='conversation_hold',lease_until=null where tenant_id=new.tenant_id and lead_id=new.lead_id and state in ('queued','claimed');
  if new.product_context->>'disposition'='opt_out' then
   insert into public.subject_requests(tenant_id,lead_id,kind,owner_id) values(new.tenant_id,new.lead_id,'object',new.assessment_reviewed_by);
  end if;
 end if;
 return new;
end $$;
revoke all on function public.apply_product_reply_stop() from public,anon,authenticated;
create trigger product_reply_stop after insert on public.lead_observations
for each row when (new.product_context is not null) execute function public.apply_product_reply_stop();
