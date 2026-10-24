-- RP-020: staff-reviewed operational setup for an existing client. Website,
-- sender identity, claims and sales capacity are supplied configuration, not
-- verified provider access, measured outcomes or permission to communicate.
create function public.revive_setup_keys(p_value jsonb,p_keys text[]) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
begin
 if jsonb_typeof(p_value) is distinct from 'object' then return false; end if;
 return (select count(*) from jsonb_object_keys(p_value))=cardinality(p_keys) and p_value ?& p_keys;
end $$;
revoke all on function public.revive_setup_keys(jsonb,text[]) from public,anon,authenticated;
grant execute on function public.revive_setup_keys(jsonb,text[]) to service_role;

create function public.revive_setup_text(p_value jsonb,p_max integer,p_single_line boolean default false) returns boolean
language sql immutable security invoker set search_path='' as $$
 select coalesce(jsonb_typeof(p_value)='string' and length(trim(p_value#>>'{}')) between 1 and p_max
  and (p_value#>>'{}')!~$re$[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]$re$
  and (not p_single_line or (p_value#>>'{}')!~E'[\r\n]'),false)
$$;
revoke all on function public.revive_setup_text(jsonb,integer,boolean) from public,anon,authenticated;
grant execute on function public.revive_setup_text(jsonb,integer,boolean) to service_role;

create function public.revive_setup_website(p_value text) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare host text;
begin
 if p_value is null or length(p_value)>1000 or p_value!~'^https://' or p_value~$re$[[:space:]\\<>"'`{}]|%(0[0-9a-fA-F]|1[0-9a-fA-F]|7[fF])$re$ then return false; end if;
 host:=lower(substring(p_value from '^https://([^/?#]+)'));
 host:=regexp_replace(host,':443$','');
 return coalesce(host~'^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z][a-z0-9-]{1,62}$'
  and host!~'(^|\.)(localhost|local|internal|invalid|test|example)$',false);
end $$;
revoke all on function public.revive_setup_website(text) from public,anon,authenticated;
grant execute on function public.revive_setup_website(text) to service_role;

create function public.revive_setup_body_valid(b jsonb) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare item jsonb; field text; bounds integer[]; v integer;
begin
 if not public.revive_setup_keys(b,array['website','supportedClaims','sourceInventory','relationshipSummary','senderName','senderEmail','ownerId','market','language','timezone','salesCapacityPerWeek','outcomeWindowDays','workingDays','startMinute','endMinute','dailyContactCap']) then return false; end if;
 if b->'website'<>'null'::jsonb and (not public.revive_setup_keys(b->'website',array['url','reference']) or not public.revive_setup_text(b->'website'->'url',1000,true) or not public.revive_setup_website(b->'website'->>'url') or not public.revive_setup_text(b->'website'->'reference',240,true)) then return false; end if;
 if jsonb_typeof(b->'supportedClaims') is distinct from 'array' or jsonb_array_length(b->'supportedClaims')>10 or jsonb_typeof(b->'sourceInventory') is distinct from 'array' or jsonb_array_length(b->'sourceInventory')>10 then return false; end if;
 for item in select value from jsonb_array_elements(b->'supportedClaims') loop
  if not public.revive_setup_keys(item,array['text','reference']) or not public.revive_setup_text(item->'text',500) or not public.revive_setup_text(item->'reference',240,true) then return false; end if;
 end loop;
 for item in select value from jsonb_array_elements(b->'sourceInventory') loop
  if not public.revive_setup_keys(item,array['type','reference','rightsReference']) or coalesce(item->>'type','') not in ('website','email','interview','file') or not public.revive_setup_text(item->'reference',240,true) or not public.revive_setup_text(item->'rightsReference',240,true) then return false; end if;
 end loop;
 if b->'relationshipSummary'<>'null'::jsonb and (not public.revive_setup_keys(b->'relationshipSummary',array['text','reference']) or not public.revive_setup_text(b->'relationshipSummary'->'text',1000) or not public.revive_setup_text(b->'relationshipSummary'->'reference',240,true)) then return false; end if;
 if b->'senderName'<>'null'::jsonb and not public.revive_setup_text(b->'senderName',80,true) then return false; end if;
 if b->'senderEmail'<>'null'::jsonb and (not public.revive_setup_text(b->'senderEmail',254,true) or b->>'senderEmail'~'[[:space:]]' or b->>'senderEmail'!~'^[^@<>]+@[^@<>]+\.[^@<>]+$') then return false; end if;
 if b->'ownerId'<>'null'::jsonb and (jsonb_typeof(b->'ownerId') is distinct from 'string' or b->>'ownerId'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then return false; end if;
 if b->'market'<>'null'::jsonb and (jsonb_typeof(b->'market') is distinct from 'string' or b->>'market'!~'^[A-Z]{2}$') then return false; end if;
 if b->'language'<>'null'::jsonb and (not public.revive_setup_text(b->'language',35,true) or b->>'language'!~'^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$') then return false; end if;
 if b->'timezone'<>'null'::jsonb and (not public.revive_setup_text(b->'timezone',80,true) or not exists(select 1 from pg_catalog.pg_timezone_names where name=b->>'timezone')) then return false; end if;
 foreach field in array array['salesCapacityPerWeek','outcomeWindowDays','dailyContactCap','startMinute','endMinute'] loop
  if b->field='null'::jsonb then continue; end if;
  if jsonb_typeof(b->field) is distinct from 'number' or b->>field!~'^[0-9]{1,4}$' then return false; end if;
  v:=(b->>field)::integer;
  bounds:=case field when 'salesCapacityPerWeek' then array[0,100] when 'outcomeWindowDays' then array[1,180] when 'dailyContactCap' then array[1,25] when 'startMinute' then array[0,1439] else array[1,1440] end;
  if v<bounds[1] or v>bounds[2] then return false; end if;
 end loop;
 if b->'workingDays'<>'null'::jsonb then
  if jsonb_typeof(b->'workingDays') is distinct from 'array' or jsonb_array_length(b->'workingDays')>7 then return false; end if;
  for item in select value from jsonb_array_elements(b->'workingDays') loop
   if jsonb_typeof(item) is distinct from 'number' or item::text!~'^[1-7]$' then return false; end if;
  end loop;
  if (select count(distinct value) from jsonb_array_elements(b->'workingDays'))<>jsonb_array_length(b->'workingDays') then return false; end if;
 end if;
 return b->'startMinute'='null'::jsonb or b->'endMinute'='null'::jsonb or (b->>'endMinute')::integer>(b->>'startMinute')::integer;
exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then return false;
end $$;
revoke all on function public.revive_setup_body_valid(jsonb) from public,anon,authenticated;
grant execute on function public.revive_setup_body_valid(jsonb) to service_role;

create function public.revive_setup_missing(b jsonb) returns text[]
language plpgsql stable security invoker set search_path='' as $$
declare missing text[]:='{}'; field text;
begin
 if not public.revive_setup_body_valid(b) then return array['invalid_setup_body']; end if;
 if jsonb_array_length(b->'sourceInventory')=0 then missing:=array_append(missing,'sourceInventory'); end if;
 foreach field in array array['relationshipSummary','senderName','senderEmail','ownerId','market','language','timezone','outcomeWindowDays','startMinute','endMinute','dailyContactCap'] loop
  if b->field='null'::jsonb then missing:=array_append(missing,field); end if;
 end loop;
 if b->'salesCapacityPerWeek'='null'::jsonb or (b->>'salesCapacityPerWeek')::integer<1 then missing:=array_append(missing,'salesCapacityPerWeek'); end if;
 if b->'workingDays'='null'::jsonb or jsonb_array_length(b->'workingDays')=0 then missing:=array_append(missing,'workingDays'); end if;
 return missing;
end $$;
revoke all on function public.revive_setup_missing(jsonb) from public,anon,authenticated;
grant execute on function public.revive_setup_missing(jsonb) to service_role;

-- Full brief structure, reviewed aliases and provenance are required for setup
-- readiness; a fresh timestamp alone cannot turn an incomplete brief into one.
create function public.revive_setup_brief_valid(b jsonb,p_now timestamptz) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare field text; arr jsonb; item jsonb; target text; targets text[]; seen text[]; canonical record; aliases record; source_at timestamptz;
begin
 if jsonb_typeof(b) is distinct from 'object' or not public.revive_setup_text(b->'offer',500) or jsonb_typeof(b->'maxAgeDays') is distinct from 'number' or coalesce(b->>'maxAgeDays','')!~'^[1-9][0-9]{0,2}$' or (b->>'maxAgeDays')::integer>365
  or jsonb_typeof(b->'source') is distinct from 'object' or not public.revive_setup_text(b->'source'->'reference',240) or not public.revive_setup_text(b->'source'->'excerpt',2000)
  or jsonb_typeof(b->'source'->'observedAt') is distinct from 'string' or b->'source'->>'observedAt'!~'^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then return false; end if;
 source_at:=(b->'source'->>'observedAt')::timestamptz;if p_now is null or source_at>p_now then return false; end if;
 foreach field in array array['industries','markets','roles','needs','excludedIndustries'] loop
  arr:=b->field;
  if jsonb_typeof(arr) is distinct from 'array' or jsonb_array_length(arr)>20 or (field<>'excludedIndustries' and jsonb_array_length(arr)=0) then return false; end if;
  seen:='{}';for item in select value from jsonb_array_elements(arr) loop
   if not public.revive_setup_text(item,100) or lower(trim(item#>>'{}'))=any(seen) then return false; end if;
   seen:=array_append(seen,lower(trim(item#>>'{}')));
  end loop;
 end loop;
 if exists(select 1 from jsonb_array_elements_text(b->'industries') i join jsonb_array_elements_text(b->'excludedIndustries') e on lower(trim(i.value))=lower(trim(e.value))) then return false; end if;
 if b ? 'aliases' then
  if jsonb_typeof(b->'aliases') is distinct from 'object' then return false; end if;
  for aliases in select key,value from jsonb_each(b->'aliases') loop
   if aliases.key not in ('industry','market','role','need') or jsonb_typeof(aliases.value) is distinct from 'object' then return false; end if;
   field:=case aliases.key when 'industry' then 'industries' when 'market' then 'markets' when 'role' then 'roles' else 'needs' end;
   select array_agg(lower(trim(value))) into targets from jsonb_array_elements_text(b->field);seen:=targets;
   for canonical in select key,value from jsonb_each(aliases.value) loop
    if not lower(trim(canonical.key))=any(targets) or jsonb_typeof(canonical.value) is distinct from 'array' or jsonb_array_length(canonical.value)>20 then return false; end if;
    for item in select value from jsonb_array_elements(canonical.value) loop
     target:=lower(trim(item#>>'{}'));
     if not public.revive_setup_text(item,100) or target=any(seen) or (aliases.key='industry' and exists(select 1 from jsonb_array_elements_text(b->'excludedIndustries') e where lower(trim(e.value))=target)) then return false; end if;
     seen:=array_append(seen,target);
    end loop;
   end loop;
  end loop;
 end if;
 return true;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range or invalid_parameter_value then return false;
end $$;
revoke all on function public.revive_setup_brief_valid(jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.revive_setup_brief_valid(jsonb,timestamptz) to service_role;

create table public.revive_setups (
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 version integer not null check(version>0),brief_version integer,
 body jsonb not null,state text not null check(state in ('draft','reviewed')),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 primary key(tenant_id,version),foreign key(tenant_id,brief_version) references public.business_briefs(tenant_id,version)
);
alter table public.revive_setups enable row level security;
revoke all on public.revive_setups from public,anon,authenticated,service_role;
grant select on public.revive_setups to authenticated;
create policy staff_read on public.revive_setups for select to authenticated using(public.is_admin());
grant select,insert on public.revive_setups to service_role;

create function public.revive_setup_current(p_tenant uuid,p_version integer,p_now timestamptz) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.revive_setups s join public.business_briefs b on b.tenant_id=s.tenant_id and b.version=s.brief_version
  where s.tenant_id=p_tenant and s.version=p_version and s.version=(select max(version) from public.revive_setups where tenant_id=p_tenant)
   and s.state='reviewed' and cardinality(public.revive_setup_missing(s.body))=0
   and public.campaign_brief_current(p_tenant,s.brief_version,p_now) and public.revive_setup_brief_valid(b.body,p_now)
   and exists(select 1 from public.profiles p join auth.users u on u.id=p.id and u.email_confirmed_at is not null where p.id=(s.body->>'ownerId')::uuid and p.is_admin)
   and exists(select 1 from public.profiles p join auth.users u on u.id=p.id and u.email_confirmed_at is not null where p.id=s.created_by and p.is_admin))
$$;
revoke all on function public.revive_setup_current(uuid,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.revive_setup_current(uuid,integer,timestamptz) to service_role;

create function public.guard_revive_setup() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op<>'INSERT' then
  if tg_op='DELETE' and not exists(select 1 from public.tenants where id=old.tenant_id) then return old; end if;
  raise exception 'Setup history is append only' using errcode='23514';
 end if;
 if current_user<>'service_role' then raise exception 'Staff service required' using errcode='42501'; end if;
 perform 1 from public.tenants where id=new.tenant_id and status<>'ended' for update;
 if not found then raise exception 'Client missing or ended' using errcode='23503'; end if;
 if new.version is distinct from coalesce((select max(version) from public.revive_setups where tenant_id=new.tenant_id),0)+1
  or not public.revive_setup_body_valid(new.body) or not exists(select 1 from public.profiles p join auth.users u on u.id=p.id and u.email_confirmed_at is not null where p.id=new.created_by and p.is_admin) then raise exception 'Invalid setup version, actor or body' using errcode='22023'; end if;
 if new.brief_version is not null and new.brief_version is distinct from (select max(version) from public.business_briefs where tenant_id=new.tenant_id) then raise exception 'Business brief changed' using errcode='40001'; end if;
 if new.body->'ownerId'<>'null'::jsonb and not exists(select 1 from public.profiles p join auth.users u on u.id=p.id and u.email_confirmed_at is not null where p.id=(new.body->>'ownerId')::uuid and p.is_admin) then raise exception 'Owner is no longer authorized staff' using errcode='40001'; end if;
 if new.state='reviewed' and (cardinality(public.revive_setup_missing(new.body))<>0 or new.brief_version is null or not public.campaign_brief_current(new.tenant_id,new.brief_version,now()) or not public.revive_setup_brief_valid((select body from public.business_briefs where tenant_id=new.tenant_id and version=new.brief_version),now())) then raise exception 'Complete setup and current valid brief required' using errcode='22023'; end if;
 return new;
end $$;
revoke all on function public.guard_revive_setup() from public,anon,authenticated;
create trigger revive_setup_guard before insert or update or delete on public.revive_setups for each row execute function public.guard_revive_setup();

create function public.invalidate_revive_setup_authority() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 update public.campaigns set status=case when status='approved' then 'draft' else status end,approval_version=approval_version+1
 where tenant_id=new.tenant_id and capability='revive' and status<>'ended';
 update public.outbound_actions a set state=case when a.state='claimed' then 'review' else 'cancelled' end,error_code='revive_setup_changed',lease_until=null
 from public.campaigns c where c.tenant_id=new.tenant_id and c.capability='revive' and c.id=a.campaign_id and a.tenant_id=new.tenant_id and a.state in ('queued','claimed');
 return new;
end $$;
revoke all on function public.invalidate_revive_setup_authority() from public,anon,authenticated;
create trigger revive_setup_invalidates_authority after insert on public.revive_setups for each row execute function public.invalidate_revive_setup_authority();

create function public.revive_setup_context(p_tenant uuid,p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare s public.revive_setups%rowtype; b public.business_briefs%rowtype; owners jsonb; missing text[];
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Staff service required' using errcode='42501'; end if;
 if not exists(select 1 from public.tenants where id=p_tenant) then raise exception 'Client missing' using errcode='23503'; end if;
 if (select count(*) from public.profiles p join auth.users u on u.id=p.id and u.email_confirmed_at is not null where p.is_admin)>100 then raise exception 'Staff owner capacity exceeded' using errcode='22023'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'label',left(coalesce(nullif(trim(p.full_name),''),p.email),320)) order by p.id),'[]'::jsonb) into owners
 from public.profiles p join auth.users u on u.id=p.id and u.email_confirmed_at is not null where p.is_admin;
 select * into s from public.revive_setups where tenant_id=p_tenant order by version desc limit 1;
 select * into b from public.business_briefs where tenant_id=p_tenant order by version desc limit 1;
 if s.version is null then missing:=array['setup_required'];
 else
  missing:=public.revive_setup_missing(s.body);
  if s.state<>'reviewed' then missing:=array_append(missing,'reviewed_setup_required'); end if;
  if s.brief_version is null or s.brief_version is distinct from b.version or not public.campaign_brief_current(p_tenant,s.brief_version,now()) or not public.revive_setup_brief_valid(b.body,now()) then missing:=array_append(missing,'current_brief_required'); end if;
  if not exists(select 1 from jsonb_array_elements(owners) o where o->>'id'=s.body->>'ownerId') then missing:=array_append(missing,'owner_unavailable'); end if;
  if not exists(select 1 from jsonb_array_elements(owners) o where o->>'id'=s.created_by::text) then missing:=array_append(missing,'reviewer_unavailable'); end if;
 end if;
 return jsonb_build_object('tenantId',p_tenant,'setup',case when s.version is null then null else jsonb_build_object('version',s.version,'briefVersion',s.brief_version,'state',s.state,'body',s.body,'createdBy',s.created_by,'createdAt',s.created_at) end,
  'currentBriefVersion',b.version,'ready',cardinality(missing)=0,'missing',to_jsonb(missing),'owners',owners,'brief',case when b.version is null then null else jsonb_build_object('version',b.version,'body',b.body) end);
end $$;
revoke all on function public.revive_setup_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.revive_setup_context(uuid,uuid) to service_role;

create function public.save_revive_setup(p_tenant uuid,p_actor uuid,p_expected_version integer,p_brief_version integer,p_state text,p_body jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare previous public.revive_setups%rowtype; result public.revive_setups%rowtype;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Staff service required' using errcode='42501'; end if;
 perform 1 from public.tenants where id=p_tenant and status<>'ended' for update;
 if not found then raise exception 'Client missing or ended' using errcode='23503'; end if;
 if p_expected_version is null or p_expected_version<0 or p_state is null or p_state not in ('draft','reviewed') or not public.revive_setup_body_valid(p_body) then raise exception 'Valid setup body, state and version required' using errcode='22023'; end if;
 if p_brief_version is not null and p_brief_version is distinct from (select max(version) from public.business_briefs where tenant_id=p_tenant) then raise exception 'Business brief changed' using errcode='40001'; end if;
 if p_state='reviewed' and (cardinality(public.revive_setup_missing(p_body))<>0 or p_brief_version is null or not public.campaign_brief_current(p_tenant,p_brief_version,now()) or not public.revive_setup_brief_valid((select body from public.business_briefs where tenant_id=p_tenant and version=p_brief_version),now()) or not exists(select 1 from public.profiles p join auth.users u on u.id=p.id and u.email_confirmed_at is not null where p.id=(p_body->>'ownerId')::uuid and p.is_admin)) then raise exception 'Complete setup, current brief and authorized owner required' using errcode='22023'; end if;
 select * into previous from public.revive_setups where tenant_id=p_tenant order by version desc limit 1;
 if previous.created_by=p_actor and previous.body=p_body and previous.state=p_state and previous.brief_version is not distinct from p_brief_version and p_expected_version in (previous.version,previous.version-1) then result:=previous;
 else
  if p_expected_version is distinct from coalesce(previous.version,0) then raise exception 'Setup changed' using errcode='40001'; end if;
  insert into public.revive_setups(tenant_id,version,brief_version,body,state,created_by) values(p_tenant,coalesce(previous.version,0)+1,p_brief_version,p_body,p_state,p_actor) returning * into result;
 end if;
 return jsonb_build_object('tenantId',p_tenant,'version',result.version,'briefVersion',result.brief_version,'state',result.state,'ready',public.revive_setup_current(p_tenant,result.version,now()),'delivery','not_sent');
end $$;
revoke all on function public.save_revive_setup(uuid,uuid,integer,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_revive_setup(uuid,uuid,integer,integer,text,jsonb) to service_role;

create function public.require_revive_setup_activation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if current_user='postgres' or new.package<>'revive' or new.status<>'active' then return new; end if;
 if tg_op='UPDATE' and old.status='active' and old.package='revive' then return new; end if;
 if current_user<>'service_role' then raise exception 'Staff service activation required' using errcode='42501'; end if;
 if not public.revive_setup_current(new.id,(select max(version) from public.revive_setups where tenant_id=new.id),now()) then raise exception 'Reviewed current Revive setup required before activation' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function public.require_revive_setup_activation() from public,anon,authenticated;
create trigger revive_setup_activation_guard before insert or update of status,package on public.tenants for each row execute function public.require_revive_setup_activation();

-- Every identity currently used by qualification, client setup or a versioned
-- strategy shares the existing tenant-lock serialization boundary. to_jsonb
-- keeps this safe before the later strategy-column migration is installed.
create or replace function public.lock_revive_reviewer() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' or new.is_admin is distinct from old.is_admin then
  perform 1 from public.tenants t where
   exists(select 1 from public.revive_reviews r where r.tenant_id=t.id and r.reviewer_id=old.id)
   or exists(select 1 from public.revive_setups s where s.tenant_id=t.id and s.version=(select max(version) from public.revive_setups where tenant_id=t.id) and (s.created_by=old.id or s.body->>'ownerId'=old.id::text))
   or exists(select 1 from public.campaign_assets a join public.campaigns c on c.tenant_id=a.tenant_id and c.id=a.campaign_id and c.asset_version=a.version where a.tenant_id=t.id and to_jsonb(a)->'revive_strategy'->>'reviewedBy'=old.id::text)
   order by t.id for update;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function public.lock_revive_reviewer() from public,anon,authenticated;
drop trigger revive_reviewer_lock on public.profiles;
create trigger revive_reviewer_lock before update of is_admin or delete on public.profiles for each row execute function public.lock_revive_reviewer();

-- Supabase Auth confirmation/deletion runs without an end-user JWT and without
-- access to private application tables. This one non-API trigger needs definer
-- rights solely to acquire the same tenant locks; auth.uid() is unavailable in
-- that server operation. No caller input, result data or public EXECUTE exists.
create schema if not exists ripepiper_private;
revoke all on schema ripepiper_private from public,anon,authenticated,service_role;
create function ripepiper_private.lock_revive_auth_authority() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_schema<>'auth' or tg_table_name<>'users' or tg_op not in ('UPDATE','DELETE') then raise exception 'Auth trigger context required' using errcode='42501';end if;
 if tg_op='UPDATE' and new.email_confirmed_at is not distinct from old.email_confirmed_at then return new;end if;
 perform 1 from public.tenants t where
  exists(select 1 from public.revive_reviews r where r.tenant_id=t.id and r.reviewer_id=old.id)
  or exists(select 1 from public.revive_setups s where s.tenant_id=t.id and s.version=(select max(version) from public.revive_setups where tenant_id=t.id) and (s.created_by=old.id or s.body->>'ownerId'=old.id::text))
  or exists(select 1 from public.campaign_assets a join public.campaigns c on c.tenant_id=a.tenant_id and c.id=a.campaign_id and c.asset_version=a.version where a.tenant_id=t.id and to_jsonb(a)->'revive_strategy'->>'reviewedBy'=old.id::text)
  order by t.id for update;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function ripepiper_private.lock_revive_auth_authority() from public,anon,authenticated,service_role;
create trigger revive_auth_authority_lock before update of email_confirmed_at or delete on auth.users for each row execute function ripepiper_private.lock_revive_auth_authority();

-- New proposals bind setupVersion; historical receipts retain their original scope.
create or replace function public.revive_draft_context_current(p_tenant uuid,p_actor uuid,p_context jsonb,p_now timestamptz)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare d jsonb:=p_context; lead uuid; source_id uuid; expires timestamptz; canonical text;
begin
 if d ? 'setupVersion' then
  if jsonb_typeof(d->'setupVersion') is distinct from 'number' or coalesce(d->>'setupVersion','')!~'^[1-9][0-9]{0,8}$'
   or not public.revive_setup_current(p_tenant,(d->>'setupVersion')::integer,p_now) then return false; end if;
 end if;
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=p_actor and is_admin)
  or jsonb_typeof(d) is distinct from 'object' or d ? 'proposalId'
  or jsonb_typeof(d->'leadId') is distinct from 'string' or jsonb_typeof(d->'sourceId') is distinct from 'string'
  or coalesce(d->>'snapshot','') !~ '^[0-9a-f]{32}$'
  or jsonb_typeof(d->'briefVersion') is distinct from 'number' or coalesce(d->>'briefVersion','') !~ '^[1-9][0-9]{0,8}$'
  or jsonb_typeof(d->'reviewVersion') is distinct from 'number' or coalesce(d->>'reviewVersion','') !~ '^[1-9][0-9]{0,8}$'
  or jsonb_typeof(d->'expiresAt') is distinct from 'string'
  or not public.revive_draft_fragment_valid(d->>'businessName',160)
  or d->>'businessName' is distinct from (select name from public.tenants where id=p_tenant)
  or not public.revive_draft_fragment_valid(d->>'canonicalNeed',100) then return false; end if;
 lead:=(d->>'leadId')::uuid;source_id:=(d->>'sourceId')::uuid;expires:=(d->>'expiresAt')::timestamptz;
 if p_now is null or expires<=p_now or expires>p_now+interval '1 day'
  or not public.revive_candidate_current(p_tenant,lead,p_now)
  or not exists(select 1 from public.revive_reviews r where r.tenant_id=p_tenant and r.lead_id=lead
   and r.snapshot=d->>'snapshot' and r.brief_version=(d->>'briefVersion')::integer
   and r.version=(d->>'reviewVersion')::integer and r.expires_at>=expires) then return false; end if;
 canonical:=public.reviewed_revive_draft_need(p_tenant,lead,source_id,(d->>'briefVersion')::integer,p_now);
 return canonical is not null and canonical=d->>'canonicalNeed' and exists(
  select 1 from public.lead_observations o join public.business_briefs b on b.tenant_id=o.tenant_id and b.version=(d->>'briefVersion')::integer
  where o.id=source_id and o.tenant_id=p_tenant and o.lead_id=lead and o.observed_at+((b.body->>'maxAgeDays')::integer)*interval '1 day'>=expires
 );
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return false;
end $$;
revoke all on function public.revive_draft_context_current(uuid,uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.revive_draft_context_current(uuid,uuid,jsonb,timestamptz) to service_role;
