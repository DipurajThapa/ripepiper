-- RP-020: bind the existing campaign ledger to a human-reviewed, current Revive cohort.
-- No seed, real provider, autonomous approval, or production activation.
create table public.revive_reviews (
 tenant_id uuid not null,lead_id uuid not null,version integer not null check(version>0),
 brief_version integer not null,snapshot text not null check(length(snapshot)=32),
 state text not null check(state in ('accepted','rejected')),reviewer_id uuid not null references public.profiles(id),
 reason text not null check(length(trim(reason)) between 8 and 1000),
 reviewed_at timestamptz not null default now(),expires_at timestamptz not null,
 primary key(tenant_id,lead_id),
 foreign key(tenant_id,lead_id) references public.leads(tenant_id,id),
 foreign key(tenant_id,brief_version) references public.business_briefs(tenant_id,version)
);
alter table public.revive_reviews enable row level security;
revoke all on public.revive_reviews from public,anon,authenticated,service_role;
grant select on public.revive_reviews to authenticated;
create policy admin_read on public.revive_reviews for select to authenticated using(public.is_admin());
grant select,insert,update on public.revive_reviews to service_role;

create function public.revive_input_snapshot(p_tenant uuid,p_lead uuid) returns text
language sql stable security invoker set search_path='' as $$
 select md5(jsonb_build_object(
  'lead',(select jsonb_build_object('id',id,'tenant',tenant_id,'email',email,'company',company,'status',status) from public.leads where tenant_id=p_tenant and id=p_lead),
  'brief',(select to_jsonb(b) from public.business_briefs b where tenant_id=p_tenant order by version desc limit 1),
  'observations',coalesce((select jsonb_agg(to_jsonb(o) order by o.id) from public.lead_observations o
   where o.tenant_id=p_tenant and o.lead_id=p_lead and
   (coalesce(o.assessment_facts,'{}')<>'{}'::jsonb or o.product_context->>'kind' in ('history','reply','enquiry'))),'[]'::jsonb))::text)
$$;
revoke all on function public.revive_input_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.revive_input_snapshot(uuid,uuid) to service_role;

create function public.revive_history_current(p_tenant uuid,p_lead uuid,p_now timestamptz) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare h public.lead_observations%rowtype; b jsonb; email text; last_contact timestamptz; days integer;
begin
 select body into b from public.business_briefs where tenant_id=p_tenant order by version desc limit 1;
 select l.email into email from public.leads l where l.tenant_id=p_tenant and l.id=p_lead;
 days:=(b->>'maxAgeDays')::integer;
 select * into h from public.lead_observations o where o.tenant_id=p_tenant and o.lead_id=p_lead
  and o.synthetic=(lower(email) like '%.invalid') and o.assessment_reviewed_by is not null
  and o.product_context->>'product'='revive' and o.product_context->>'kind'='history'
  order by o.observed_at desc,o.id limit 1;
 if h.id is null or p_now is null or days not between 1 and 365 or h.observed_at>p_now
  or h.observed_at<p_now-days*interval '1 day' or length(trim(coalesce(h.rights_reference,'')))=0
  or h.product_context->>'previousInterest' is distinct from 'yes'
  or length(trim(coalesce(h.product_context->>'stalledReason','')))=0 then return false; end if;
 last_contact:=(h.product_context->>'lastContactAt')::timestamptz;
 if last_contact is null or last_contact>h.observed_at or last_contact>p_now-interval '30 days' then return false; end if;
 if exists(select 1 from public.lead_observations o where o.tenant_id=p_tenant and o.lead_id=p_lead
  and o.synthetic=h.synthetic and o.assessment_reviewed_by is not null and o.observed_at=h.observed_at
  and o.product_context->>'product'='revive' and o.product_context->>'kind'='history' and o.product_context<>h.product_context) then return false; end if;
 return true;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return false;
end $$;
revoke all on function public.revive_history_current(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.revive_history_current(uuid,uuid,timestamptz) to service_role;

create function public.revive_candidate_current(p_tenant uuid,p_lead uuid,p_now timestamptz) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.revive_reviews r join public.leads l on l.tenant_id=r.tenant_id and l.id=r.lead_id
  where r.tenant_id=p_tenant and r.lead_id=p_lead and r.state='accepted' and r.expires_at>p_now and r.reviewed_at<=p_now
  and r.snapshot=public.revive_input_snapshot(p_tenant,p_lead)
  and public.campaign_brief_current(p_tenant,r.brief_version,p_now) and public.revive_history_current(p_tenant,p_lead,p_now)
  and (select count(*) from public.lead_observations o where o.tenant_id=p_tenant and o.lead_id=p_lead)<1000
  and exists(select 1 from public.profiles p where p.id=r.reviewer_id and p.is_admin)
  and l.status<>'unsubscribed'
  and not exists(select 1 from public.suppression s where s.email=lower(l.email))
  and not exists(select 1 from public.lead_suppression s where s.tenant_id=p_tenant and s.lead_id=p_lead)
  and not exists(select 1 from public.lead_observations o where o.tenant_id=p_tenant and o.lead_id=p_lead
   and o.product_context->>'product'='response' and o.product_context->>'kind' in ('enquiry','reply')))
$$;
revoke all on function public.revive_candidate_current(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.revive_candidate_current(uuid,uuid,timestamptz) to service_role;

create function public.revive_review_context(p_tenant uuid,p_lead uuid,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare l public.leads%rowtype; brief jsonb; observations jsonb; review jsonb; stopped boolean;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Staff required' using errcode='42501'; end if;
 perform 1 from public.tenants where id=p_tenant for update;
 select * into l from public.leads where tenant_id=p_tenant and id=p_lead;
 if not found then return null; end if;
 if (select count(*) from public.lead_observations where tenant_id=p_tenant and lead_id=p_lead)>=1000 then raise exception 'Review capacity exceeded' using errcode='22023'; end if;
 select to_jsonb(b) into brief from public.business_briefs b where tenant_id=p_tenant order by version desc limit 1;
 select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') into observations from public.lead_observations o where tenant_id=p_tenant and lead_id=p_lead;
 select to_jsonb(r) into review from public.revive_reviews r where tenant_id=p_tenant and lead_id=p_lead;
 stopped:=l.status='unsubscribed' or exists(select 1 from public.lead_suppression where tenant_id=p_tenant and lead_id=p_lead) or exists(select 1 from public.suppression where email=lower(l.email));
 return jsonb_build_object('lead',jsonb_build_object('id',l.id,'tenant_id',l.tenant_id,'email',l.email,'status',l.status),
  'brief',brief,'observations',observations,'review',review,'suppressed',stopped,'snapshot',public.revive_input_snapshot(p_tenant,p_lead));
end $$;
revoke all on function public.revive_review_context(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.revive_review_context(uuid,uuid,uuid) to service_role;

create function public.review_revive_candidate(p_tenant uuid,p_lead uuid,p_actor uuid,p_expected_version integer,p_snapshot text,p_brief_version integer,p_decision text,p_reason text,p_expires timestamptz) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare previous public.revive_reviews%rowtype; result public.revive_reviews%rowtype;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Staff required' using errcode='42501'; end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if not exists(select 1 from public.leads where tenant_id=p_tenant and id=p_lead) then raise exception 'Lead missing' using errcode='23503'; end if;
 select * into previous from public.revive_reviews where tenant_id=p_tenant and lead_id=p_lead for update;
 if p_expected_version is distinct from coalesce(previous.version,0) or p_snapshot is distinct from public.revive_input_snapshot(p_tenant,p_lead)
  or p_brief_version is distinct from (select max(version) from public.business_briefs where tenant_id=p_tenant) then raise exception 'Review changed' using errcode='40001'; end if;
 if p_decision is null or p_decision not in ('accepted','rejected') or coalesce(length(trim(p_reason)),0) not between 8 and 1000
  or p_expires is null or p_expires<=now() or p_expires>now()+interval '30 days'
  or p_brief_version is null or (p_decision='accepted' and (not public.campaign_brief_current(p_tenant,p_brief_version,now())
  or not public.revive_history_current(p_tenant,p_lead,now()))) then raise exception 'Current review and bounded expiry required' using errcode='22023'; end if;
 insert into public.revive_reviews(tenant_id,lead_id,version,brief_version,snapshot,state,reviewer_id,reason,expires_at)
 values(p_tenant,p_lead,coalesce(previous.version,0)+1,p_brief_version,p_snapshot,p_decision,p_actor,trim(p_reason),p_expires)
 on conflict(tenant_id,lead_id) do update set version=excluded.version,brief_version=excluded.brief_version,snapshot=excluded.snapshot,state=excluded.state,reviewer_id=excluded.reviewer_id,reason=excluded.reason,expires_at=excluded.expires_at,reviewed_at=now() returning * into result;
 insert into public.activity_log(tenant_id,actor,kind,message,visible_to_client) values(p_tenant,p_actor::text,'note',jsonb_build_object('kind','revive_cohort_review','lead',p_lead,'previous',to_jsonb(previous),'current',to_jsonb(result))::text,false);
 return to_jsonb(result);
end $$;
revoke all on function public.review_revive_candidate(uuid,uuid,uuid,integer,text,integer,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.review_revive_candidate(uuid,uuid,uuid,integer,text,integer,text,text,timestamptz) to service_role;

-- Bind each enrolled action to the exact review; a re-review does not revive an old sequence.
alter table public.outbound_actions add column revive_review_version integer,add column revive_review_snapshot text;
create function public.guard_revive_enrolment() returns trigger
language plpgsql security invoker set search_path='' as $$
declare r public.revive_reviews%rowtype;
begin
 if exists(select 1 from public.campaigns where tenant_id=new.tenant_id and id=new.campaign_id and capability='revive') then
  perform 1 from public.tenants where id=new.tenant_id for update;
  if not public.revive_candidate_current(new.tenant_id,new.lead_id,now()) then raise exception 'Current accepted Revive cohort required' using errcode='22023'; end if;
  select * into r from public.revive_reviews where tenant_id=new.tenant_id and lead_id=new.lead_id;
  if r.expires_at<=new.due_at then raise exception 'Revive review expires before scheduled step' using errcode='22023'; end if;
  new.revive_review_version:=r.version;new.revive_review_snapshot:=r.snapshot;
 end if;
 return new;
end $$;
revoke all on function public.guard_revive_enrolment() from public,anon,authenticated;
create trigger revive_enrolment_guard before insert on public.outbound_actions for each row execute function public.guard_revive_enrolment();

-- Serialize evidence changes with tenant-scoped queue/claim/completion transactions.
-- No elevated privileges: authenticated insert routes cannot manufacture acceptance.
create function public.lock_revive_evidence() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and old.tenant_id is distinct from new.tenant_id then
  perform 1 from public.tenants where id in(old.tenant_id,new.tenant_id) order by id for update;
 else
  perform 1 from public.tenants where id=case when tg_op='DELETE' then old.tenant_id else new.tenant_id end for update;
 end if;
 if tg_op='DELETE' then return old; end if;return new;
end $$;
revoke all on function public.lock_revive_evidence() from public,anon,authenticated;
create trigger revive_evidence_lock before insert or update or delete on public.lead_observations for each row execute function public.lock_revive_evidence();
create trigger revive_identity_lock before update of email,company,status,tenant_id or delete on public.leads for each row execute function public.lock_revive_evidence();

-- A reviewer-role revocation serializes with every affected tenant's in-flight eligibility check.
create function public.lock_revive_reviewer() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.is_admin is distinct from old.is_admin then
  perform 1 from public.tenants t where exists(select 1 from public.revive_reviews r where r.tenant_id=t.id and r.reviewer_id=old.id) order by t.id for update;
 end if;
 return new;
end $$;
revoke all on function public.lock_revive_reviewer() from public,anon,authenticated;
create trigger revive_reviewer_lock before update of is_admin on public.profiles for each row execute function public.lock_revive_reviewer();

-- Retain all existing shared execution checks; add the Revive cohort fence.
create or replace function public.synthetic_action_allowed(p_id uuid, p_now timestamptz) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.outbound_actions a
    join public.campaigns c on c.id=a.campaign_id and c.tenant_id=a.tenant_id
    join public.campaign_assets v on v.tenant_id=a.tenant_id and v.campaign_id=a.campaign_id and v.version=a.asset_version
    join public.leads l on l.id=a.lead_id and l.tenant_id=a.tenant_id
    join public.tenants t on t.id=a.tenant_id
    where not exists(select 1 from public.outbound_actions earlier where earlier.campaign_id=a.campaign_id and earlier.lead_id=a.lead_id and earlier.message_step<a.message_step and earlier.state<>'tested')
      and v.approved_by is not null and a.message_step<jsonb_array_length(v.steps)
      and (v.brief_version is null or public.campaign_brief_current(a.tenant_id,v.brief_version,p_now))
      and (c.capability<>'revive' or (public.revive_candidate_current(a.tenant_id,a.lead_id,p_now)
        and exists(select 1 from public.revive_reviews r where r.tenant_id=a.tenant_id and r.lead_id=a.lead_id
         and r.version=a.revive_review_version and r.snapshot=a.revive_review_snapshot)))
      and a.id=p_id and p_now is not null and t.status='active' and c.status='approved'
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



