-- Hybrid operating model, wave 5: shared reference store, domain linking and k-anonymous learning.
-- Data categories: reference_companies is shared (no tenant_id, no person fields, written only by a platform-admin RPC
-- that takes no tenant input); tenant rows point at it through the generated leads.company_domain and nothing is ever
-- copied from tenant rows into it. learning_outcomes_by_segment stores nothing and only returns a cell when at least
-- 5 tenants and 50 contacts sit in it. The store stays empty until a licensed source is approved (owner decision).

-- One normaliser for the stored key and the lead join: lower-case, no scheme/path/port/query, no leading www., no
-- trailing dot, then a strict hostname (labels 1-63, no edge hyphen, alphabetic TLD). Anything else is null.
create function ripepiper_private.normal_domain(p_value text) returns text
language sql immutable parallel safe set search_path='' as $$
 select case when octet_length(d)<=253 and d ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' then d end
 from (select regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(btrim(p_value)),
  '^[a-z][a-z0-9+.-]*://',''),'[/:?#].*$',''),'\.+$',''),'^www\.','') d where octet_length(p_value)<=2048) x
$$;
-- Pure and data-free; left executable by every role because the leads generated column evaluates it on any insert.

create table public.reference_companies (
 domain text primary key check(domain=ripepiper_private.normal_domain(domain)),
 legal_name text check(legal_name is null or octet_length(legal_name) between 1 and 300),
 industry_code text check(industry_code is null or industry_code ~ '^[A-Za-z0-9.-]{1,40}$'),
 industry_scheme text check(industry_scheme is null or industry_scheme ~ '^[A-Za-z0-9 ._-]{1,40}$'),
 country text check(country is null or country ~ '^[A-Z]{2}$'),
 source text not null check(octet_length(btrim(source)) between 1 and 200),
 licence_reference text not null check(octet_length(btrim(licence_reference)) between 1 and 200),
 permitted_purposes text[] not null check(cardinality(permitted_purposes)>0 and permitted_purposes<@array['prospect_research','icp_matching']),
 verified_at timestamptz not null,
 expires_at timestamptz not null,
 correction_status text not null default 'none' check(correction_status in ('none','disputed','corrected','withdrawn')),
 updated_at timestamptz not null default now(),
 check(expires_at>verified_at)
);
alter table public.reference_companies enable row level security;
revoke all on public.reference_companies from public,anon,authenticated;
grant select,insert,update on public.reference_companies to service_role;

-- Tenant data links by domain only; a null or messy website simply has no reference join.
alter table public.leads add column company_domain text generated always as (ripepiper_private.normal_domain(website)) stored;
create index leads_tenant_company_domain on public.leads(tenant_id,company_domain) where company_domain is not null;

-- Paid model calls become auditable per tenant (null = the agency's own records).
alter table public.build_usage add column tenant_id uuid references public.tenants(id) on delete set null;

-- Platform admin only, no tenant parameter. Allowlisted keys; free-mail hosts are personal, not company, identities.
-- expires_at is verified_at + 180 days (the verification window); re-upserting re-verifies the same row.
create function public.upsert_reference_company(p_actor uuid,p_body jsonb) returns text
language plpgsql set search_path='' as $$
declare d text; verified timestamptz; purposes text[];
begin
 if current_user<>'service_role' or not ripepiper_private.is_platform_admin(p_actor) then raise exception 'Not authorised' using errcode='42501';end if;
 if coalesce(jsonb_typeof(p_body),'')<>'object' or exists(select 1 from jsonb_object_keys(p_body) k where k not in
   ('domain','legalName','industryCode','industryScheme','country','source','licenceReference','permittedPurposes','verifiedAt'))
  or coalesce(jsonb_typeof(p_body->'permittedPurposes'),'')<>'array' or exists(select 1 from jsonb_array_elements(p_body->'permittedPurposes') e where jsonb_typeof(e)<>'string')
 then raise exception 'Invalid reference company' using errcode='22023';end if;
 d:=ripepiper_private.normal_domain(p_body->>'domain');
 select array_agg(distinct e order by e) into purposes from jsonb_array_elements_text(p_body->'permittedPurposes') e;
 begin verified:=coalesce((p_body->>'verifiedAt')::timestamptz,now());exception when others then verified:=null;end;
 if d is null or d ~ '^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|gmx|mail|zoho|yandex|qq|163|126|rediffmail)(\.[a-z]{2,3}){1,2}$'
  or verified is null or verified>now()+interval '5 minutes' or verified<=now()-interval '180 days'
 then raise exception 'Invalid reference company' using errcode='22023';end if;
 insert into public.reference_companies(domain,legal_name,industry_code,industry_scheme,country,source,licence_reference,permitted_purposes,verified_at,expires_at)
 values(d,nullif(btrim(p_body->>'legalName'),''),p_body->>'industryCode',p_body->>'industryScheme',upper(p_body->>'country'),btrim(p_body->>'source'),
  btrim(p_body->>'licenceReference'),purposes,verified,verified+interval '180 days')
 on conflict(domain) do update set legal_name=excluded.legal_name,industry_code=excluded.industry_code,industry_scheme=excluded.industry_scheme,
  country=excluded.country,source=excluded.source,licence_reference=excluded.licence_reference,permitted_purposes=excluded.permitted_purposes,
  verified_at=excluded.verified_at,expires_at=excluded.expires_at,updated_at=now();
 return d;
exception when check_violation or not_null_violation then raise exception 'Invalid reference company' using errcode='22023';
end $$;

-- A platform admin sets any status; a tenant member (can_operate read) may only dispute a current row its own leads
-- link to. Every correction is recorded in activity_log as a platform (tenant_id null) record.
create function public.correct_reference_company(p_actor uuid,p_tenant uuid,p_domain text,p_status text,p_reason text) returns void
language plpgsql set search_path='' as $$
declare r public.reference_companies%rowtype; admin boolean:=ripepiper_private.is_platform_admin(p_actor);
begin
 if current_user<>'service_role' then raise exception 'Not authorised' using errcode='42501';end if;
 if p_status is null or p_status not in ('none','disputed','corrected','withdrawn') or coalesce(octet_length(btrim(p_reason)),0) not between 1 and 500
 then raise exception 'Invalid correction' using errcode='22023';end if;
 select * into r from public.reference_companies where domain=ripepiper_private.normal_domain(p_domain) for update;
 if r.domain is null or not (admin or (p_status='disputed' and r.correction_status in ('none','corrected') and p_tenant is not null
   and ripepiper_private.can_operate(p_tenant,p_actor,'read') and exists(select 1 from public.leads where tenant_id=p_tenant and company_domain=r.domain)))
 then raise exception 'Not authorised' using errcode='42501';end if;
 update public.reference_companies set correction_status=p_status,updated_at=now() where domain=r.domain;
 insert into public.activity_log(tenant_id,actor,kind,message,visible_to_client)
 select null,left(coalesce(nullif(trim(a.full_name),''),a.email),320),'change',
  format('Reference company %s set to %s: %s',r.domain,p_status,left(btrim(p_reason),500)),false
 from public.profiles a where a.id=p_actor;
end $$;

-- Current reference facts licensed for prospect research, for the tenant's own leads only (expired, disputed,
-- withdrawn and ICP-matching-only rows drop out).
create function public.tenant_reference_facts(p_tenant uuid,p_actor uuid) returns jsonb
language plpgsql stable set search_path='' as $$
begin
 if current_user<>'service_role' or not ripepiper_private.can_operate(p_tenant,p_actor,'read') then raise exception 'Not authorised' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('domain',r.domain,'legal_name',r.legal_name,'industry_code',r.industry_code,
   'industry_scheme',r.industry_scheme,'country',r.country,'source',r.source,'licence_reference',r.licence_reference,
   'permitted_purposes',to_jsonb(r.permitted_purposes),'verified_at',r.verified_at,'expires_at',r.expires_at) order by r.domain)
  from (select * from public.reference_companies r where r.expires_at>now() and r.correction_status in ('none','corrected')
   and 'prospect_research'=any(r.permitted_purposes) and exists(select 1 from public.leads l where l.tenant_id=p_tenant and l.company_domain=r.domain) order by r.domain limit 1000) r),'[]'::jsonb);
end $$;

revoke all on function public.upsert_reference_company(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.correct_reference_company(uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.tenant_reference_facts(uuid,uuid) from public,anon,authenticated;
grant execute on function public.upsert_reference_company(uuid,jsonb) to service_role;
grant execute on function public.correct_reference_company(uuid,uuid,text,text,text) to service_role;
grant execute on function public.tenant_reference_facts(uuid,uuid) to service_role;

-- Fixed dimensions only (reference industry, lead market, channel, month), no tenant or lead ids, no synthetic (.invalid)
-- contacts, only reference rows licensed for ICP matching. A cell needs >=5 tenants and >=50 contacts; never lower these.
create view public.learning_outcomes_by_segment with (security_invoker=true) as
select r.industry_code,l.country as market,c.channel,date_trunc('month',a.created_at at time zone 'UTC')::date as month,
 count(distinct a.lead_id)::int contacts,
 count(distinct a.lead_id) filter(where l.status in ('meeting_booked','meeting_held','won'))::int meetings_booked,
 round(count(distinct a.lead_id) filter(where l.status in ('meeting_booked','meeting_held','won'))::numeric/count(distinct a.lead_id),4) meeting_rate
from public.outbound_actions a
join public.leads l on l.tenant_id=a.tenant_id and l.id=a.lead_id
join public.campaigns c on c.tenant_id=a.tenant_id and c.id=a.campaign_id
join public.reference_companies r on r.domain=l.company_domain and r.expires_at>now() and r.correction_status in ('none','corrected')
 and 'icp_matching'=any(r.permitted_purposes)
where a.state='delivered' and lower(l.email) not like '%.invalid'
group by 1,2,3,4
having count(distinct a.tenant_id)>=5 and count(distinct a.lead_id)>=50;
revoke all on public.learning_outcomes_by_segment from public,anon,authenticated;
grant select on public.learning_outcomes_by_segment to service_role;
