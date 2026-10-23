-- Offline-only Events intake on the existing campaigns/leads/observations graph.
-- No event table, contact-rights grant, reminder, message, calendar write or seed.
alter table public.campaigns add column event_settings jsonb, add column event_version integer not null default 0 check(event_version>=0);
alter table public.campaigns add constraint event_settings_shape check(event_settings is null or (capability='events' and jsonb_typeof(event_settings)='object' and event_version>0));
alter table public.lead_observations drop constraint product_context_shape;
alter table public.lead_observations add constraint product_context_shape check(product_context is null or coalesce((jsonb_typeof(product_context)='object' and (
 (assessment_reviewed_by is not null and product_context->>'product' in('revive','signal','response','events') and (
 (product_context->>'product'='revive' and product_context->>'kind'='history') or (product_context->>'product'='signal' and product_context->>'kind'='trigger')
 or (product_context->>'product'='response' and product_context->>'kind' in('enquiry','reply','conversation_review'))
 or (product_context->>'product'='events' and product_context->>'kind' in('registration','attendance')) or product_context->>'kind'='outcome'))
 or (assessment_reviewed_by is null and synthetic and product_context->>'product'='events' and product_context->>'identityStatus'='unverified'
 and ((source='event_registration' and product_context->>'kind'='registration_intake') or(source='event_registration_cancel' and product_context->>'kind'='registration_cancelled') or(source='event_registration_ack' and product_context->>'kind'='registration_schedule_ack')))
)),false));
create function public.guard_event_intake() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (new.source in('event_registration','event_registration_cancel','event_registration_ack') or new.product_context->>'kind' in('registration_intake','registration_cancelled','registration_schedule_ack')
 or(tg_op='UPDATE' and (old.source in('event_registration','event_registration_cancel','event_registration_ack') or old.product_context->>'kind' in('registration_intake','registration_cancelled','registration_schedule_ack')))) and current_user<>'service_role' then
 raise exception 'Event intake service required' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function public.guard_event_intake() from public,anon,authenticated;
create trigger guard_event_intake before insert or update on public.lead_observations for each row execute function public.guard_event_intake();
create function public.event_campaign_current(p_campaign uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.campaigns c join public.tenants t on t.id=c.tenant_id join public.campaign_assets a on a.tenant_id=c.tenant_id and a.campaign_id=c.id and a.version=c.asset_version
 where c.id=p_campaign and c.capability='events' and t.status='active' and c.status='approved' and c.expires_at>now() and a.approved_by is not null
 and public.campaign_brief_current(c.tenant_id,a.brief_version,now()));
$$;
revoke all on function public.event_campaign_current(uuid) from public,anon,authenticated;
grant execute on function public.event_campaign_current(uuid) to service_role;
grant insert on public.activity_log to service_role;
create function public.manage_event_settings(p_tenant uuid,p_campaign uuid,p_actor uuid,p_expected integer,p_body jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.campaigns%rowtype; settings jsonb; starts timestamptz; ends timestamptz; capacity integer;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Staff service required' using errcode='42501'; end if;
 perform 1 from public.tenants where id=p_tenant and status in('onboarding','active') for update;
 if not found then raise exception 'Tenant unavailable' using errcode='22023'; end if;
 select * into c from public.campaigns where tenant_id=p_tenant and id=p_campaign and capability='events' for update;
 if not found then raise exception 'Events campaign scope mismatch' using errcode='23503'; end if;
 if p_expected is null or p_expected<0 or p_body->'confirmed' is distinct from 'true'::jsonb or jsonb_typeof(p_body->'open') is distinct from 'boolean'
 or coalesce(length(trim(p_body->>'title')),0) not between 1 and 160 or coalesce(length(trim(p_body->>'noticeReference')),0) not between 1 and 240
 or coalesce(length(trim(p_body->>'timezone')),0) not between 1 and 80 or coalesce(p_body->>'capacity','') !~ '^[0-9]{1,3}$' or coalesce(p_body->>'startsAt','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or coalesce(p_body->>'endsAt','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Reviewed event settings required' using errcode='22023'; end if;
 capacity:=(p_body->>'capacity')::integer;starts:=(p_body->>'startsAt')::timestamptz;ends:=(p_body->>'endsAt')::timestamptz;
 if capacity not between 1 and 100 or starts is null or ends is null or starts>=ends or ends>now()+interval '1 year' or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_body->>'timezone') then raise exception 'Invalid event time or capacity' using errcode='22023'; end if;
 settings:=jsonb_build_object('title',trim(p_body->>'title'),'startsAt',starts,'endsAt',ends,'timezone',p_body->>'timezone','capacity',capacity,'open',(p_body->>'open')::boolean,'noticeReference',trim(p_body->>'noticeReference'));
 if c.event_settings=settings and c.event_version in(p_expected,p_expected+1) then return jsonb_build_object('id',c.id,'version',c.event_version,'replayed',true); end if;
 if c.event_version<>p_expected then raise exception 'Event settings changed' using errcode='40001'; end if;
 if (p_body->>'open')::boolean and (starts<=now() or(c.event_settings is null and not public.event_campaign_current(c.id))) then raise exception 'Current approved campaign and future event required' using errcode='22023'; end if;
 insert into public.activity_log(tenant_id,actor,kind,message,visible_to_client) values(p_tenant,p_actor::text,'change',jsonb_build_object('event',c.id,'version',c.event_version+1,'previous',c.event_settings,'current',settings)::text,false);
 if c.event_settings is not null and c.event_settings<>settings then
  update public.outbound_actions set state=case when state='claimed' then 'review' else 'cancelled' end,error_code='event_schedule_changed',lease_until=null where campaign_id=c.id and state in('queued','claimed');
  update public.campaign_assets set approved_by=null,approved_at=null where tenant_id=p_tenant and campaign_id=c.id and version=c.asset_version;
  update public.campaigns set status='draft',approval_version=approval_version+1 where id=c.id;
 end if;
 update public.campaigns set event_settings=settings,event_version=event_version+1 where id=c.id;
 return jsonb_build_object('id',c.id,'version',c.event_version+1,'replayed',false);
end $$;
revoke all on function public.manage_event_settings(uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.manage_event_settings(uuid,uuid,uuid,integer,jsonb) to service_role;
create function public.event_public_metadata(p_campaign uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare c public.campaigns%rowtype;
begin
 if current_user<>'service_role' then raise exception 'Service required' using errcode='42501'; end if;
 select * into c from public.campaigns where id=p_campaign;
 if c.id is null or not public.event_campaign_current(c.id) or c.event_settings->'open' is distinct from 'true'::jsonb or (c.event_settings->>'startsAt')::timestamptz<=now() then return null; end if;
 return jsonb_build_object('id',c.id,'version',c.event_version,'title',c.event_settings->>'title','startsAt',c.event_settings->>'startsAt','endsAt',c.event_settings->>'endsAt','timezone',c.event_settings->>'timezone','noticeReference',c.event_settings->>'noticeReference','mode','synthetic_only');
end $$;
revoke all on function public.event_public_metadata(uuid) from public,anon,authenticated;
grant execute on function public.event_public_metadata(uuid) to service_role;
create function public.event_registration_state(p_tenant uuid,p_campaign uuid,p_hash text) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare c public.campaigns%rowtype; registration public.lead_observations%rowtype; acknowledged integer; state text;
begin
 select * into c from public.campaigns where tenant_id=p_tenant and id=p_campaign;
 select * into registration from public.lead_observations where tenant_id=p_tenant and source='event_registration' and external_ref=p_campaign::text||':'||p_hash;
 if registration.id is null or now()>greatest((registration.product_context->>'endsAt')::timestamptz,(c.event_settings->>'endsAt')::timestamptz)+interval '7 days' then raise exception 'Registration capability unavailable' using errcode='22023'; end if;
 select greatest((registration.product_context->>'eventVersion')::integer,coalesce(max((product_context->>'eventVersion')::integer),0)) into acknowledged from public.lead_observations where tenant_id=p_tenant and source='event_registration_ack' and product_context->>'registrationRef'=registration.external_ref;
 state:=case when exists(select 1 from public.lead_observations where tenant_id=p_tenant and source='event_registration_cancel' and external_ref=registration.external_ref) then 'cancelled' when acknowledged<>c.event_version then 'schedule_changed' else 'registered' end;
 return jsonb_build_object('eventId',c.id,'registrationId',registration.id,'state',state,'version',c.event_version,'acknowledgedVersion',acknowledged,'identityStatus','unverified','attendance','unknown','marketingPermission','not_granted','delivery','not_sent');
end $$;
revoke all on function public.event_registration_state(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.event_registration_state(uuid,uuid,text) to service_role;
-- Read-only receipt recovery lets an identical committed registration retry avoid replaying Turnstile.
create function public.read_synthetic_registration(p_campaign uuid,p_version integer,p_email text,p_name text,p_hash text) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare c public.campaigns%rowtype; registration public.lead_observations%rowtype;
begin
 if current_user<>'service_role' then raise exception 'Service required' using errcode='42501'; end if;
 if coalesce(p_hash,'') !~ '^[0-9a-f]{64}$' then raise exception 'Capability unavailable' using errcode='22023'; end if;
 select * into c from public.campaigns where id=p_campaign;
 if c.id is null then return null; end if;
 select * into registration from public.lead_observations where tenant_id=c.tenant_id and source='event_registration' and external_ref=p_campaign::text||':'||p_hash;
 if registration.id is null then return null; end if;
 if registration.product_context->>'registrantEmail' is distinct from p_email or registration.product_context->>'registrantName' is distinct from trim(p_name) or (registration.product_context->>'eventVersion')::integer is distinct from p_version then raise exception 'Registration reference reused' using errcode='23505'; end if;
 return public.event_registration_state(c.tenant_id,c.id,p_hash);
end $$;
revoke all on function public.read_synthetic_registration(uuid,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.read_synthetic_registration(uuid,integer,text,text,text) to service_role;
create function public.register_synthetic_event(p_campaign uuid,p_version integer,p_email text,p_name text,p_hash text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.campaigns%rowtype; registration public.lead_observations%rowtype; lead uuid; n integer; reference text;
begin
 if current_user<>'service_role' then raise exception 'Service required' using errcode='42501'; end if;
 select * into c from public.campaigns where id=p_campaign;
 if c.id is null then raise exception 'Event unavailable' using errcode='22023'; end if;
 perform 1 from public.tenants where id=c.tenant_id and status='active' for update;
 if not found then raise exception 'Event unavailable' using errcode='22023'; end if;
 select * into c from public.campaigns where id=p_campaign for update;
 if coalesce(p_email,'') !~ '^[^[:space:]@]+@[^[:space:]@]+\.invalid$' or length(p_email)>254 or p_email<>lower(p_email)
 or coalesce(length(trim(p_name)),0) not between 1 and 120 or coalesce(p_hash,'') !~ '^[0-9a-f]{64}$' then raise exception 'Synthetic identity and capability required' using errcode='22023'; end if;
 reference:=p_campaign::text||':'||p_hash;
 select * into registration from public.lead_observations where tenant_id=c.tenant_id and source='event_registration' and external_ref=reference;
 if found then
  if registration.product_context->>'registrantEmail'<>p_email or registration.product_context->>'registrantName'<>trim(p_name) or (registration.product_context->>'eventVersion')::integer is distinct from p_version then raise exception 'Registration reference reused' using errcode='23505'; end if;
  return public.event_registration_state(c.tenant_id,c.id,p_hash);
 end if;
 if public.event_public_metadata(c.id) is null or c.event_version is distinct from p_version then raise exception 'Event or version unavailable' using errcode='40001'; end if;
 select id into lead from public.leads where tenant_id=c.tenant_id and lower(email)=p_email;
 if lead is not null and exists(select 1 from public.lead_observations o where o.tenant_id=c.tenant_id and o.lead_id=lead and o.source='event_registration' and o.product_context->>'eventRef'=c.id::text and not exists(select 1 from public.lead_observations stop where stop.tenant_id=c.tenant_id and stop.source='event_registration_cancel' and stop.external_ref=o.external_ref)) then
  return jsonb_build_object('eventId',c.id,'state','request_received','identityStatus','unverified','controlAvailable',false,'delivery','not_sent');
 end if;
 select count(*) into n from public.lead_observations o where o.tenant_id=c.tenant_id and o.source='event_registration' and o.product_context->>'eventRef'=c.id::text and not exists(select 1 from public.lead_observations stop where stop.tenant_id=c.tenant_id and stop.source='event_registration_cancel' and stop.external_ref=o.external_ref);
 if n>=(c.event_settings->>'capacity')::integer then raise exception 'Event capacity reached' using errcode='22023'; end if;
 if lead is null then
  if (select count(*) from public.leads where tenant_id=c.tenant_id)>=100 then raise exception 'Review capacity reached' using errcode='22023'; end if;
  insert into public.leads(tenant_id,source,email,name)values(c.tenant_id,'event',p_email,trim(p_name))returning id into lead;
 end if;
 insert into public.lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_excerpt,product_context)
 values(c.tenant_id,lead,'event_registration',reference,now(),'event registration only',c.event_settings->>'noticeReference',true,'Synthetic registration; attendee identity unverified',jsonb_build_object('product','events','kind','registration_intake','eventRef',c.id,'eventVersion',c.event_version,'endsAt',c.event_settings->>'endsAt','timezone',c.event_settings->>'timezone','attendance','unknown','identityStatus','unverified','registrantEmail',p_email,'registrantName',trim(p_name)));
 return public.event_registration_state(c.tenant_id,c.id,p_hash);
end $$;
revoke all on function public.register_synthetic_event(uuid,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.register_synthetic_event(uuid,integer,text,text,text) to service_role;
create function public.change_synthetic_registration(p_campaign uuid,p_version integer,p_hash text,p_operation text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.campaigns%rowtype; registration public.lead_observations%rowtype; source_kind text; context_kind text; reference text;
begin
 if current_user<>'service_role' then raise exception 'Service required' using errcode='42501'; end if;
 select * into c from public.campaigns where id=p_campaign;
 if c.id is null or coalesce(p_hash,'') !~ '^[0-9a-f]{64}$' or p_operation not in('cancel','acknowledge') or p_operation is null then raise exception 'Registration capability unavailable' using errcode='22023'; end if;
 perform 1 from public.tenants where id=c.tenant_id for update;
 select * into c from public.campaigns where id=p_campaign for update;
 select * into registration from public.lead_observations where tenant_id=c.tenant_id and source='event_registration' and external_ref=p_campaign::text||':'||p_hash;
 if registration.id is null or now()>greatest((registration.product_context->>'endsAt')::timestamptz,(c.event_settings->>'endsAt')::timestamptz)+interval '7 days' then raise exception 'Registration capability unavailable' using errcode='22023'; end if;
 if p_operation='cancel' then source_kind:='event_registration_cancel';context_kind:='registration_cancelled';reference:=registration.external_ref;
 else
  if public.event_public_metadata(c.id) is null or c.event_version is distinct from p_version then raise exception 'Event version changed' using errcode='40001'; end if;
  if exists(select 1 from public.lead_observations where tenant_id=c.tenant_id and source='event_registration_cancel' and external_ref=registration.external_ref) then return public.event_registration_state(c.tenant_id,c.id,p_hash); end if;
  source_kind:='event_registration_ack';context_kind:='registration_schedule_ack';reference:=registration.external_ref||':'||c.event_version;
 end if;
 if not exists(select 1 from public.lead_observations where tenant_id=c.tenant_id and source=source_kind and external_ref=reference) then
  insert into public.lead_observations(tenant_id,lead_id,source,external_ref,observed_at,original_purpose,rights_reference,synthetic,assessment_excerpt,product_context)
  values(c.tenant_id,registration.lead_id,source_kind,reference,now(),'event registration only',registration.rights_reference,true,'Synthetic registration lifecycle; no message sent',jsonb_build_object('product','events','kind',context_kind,'eventRef',c.id,'registrationRef',registration.external_ref,'eventVersion',c.event_version,'identityStatus','unverified','attendance','unknown'));
 end if;
 return public.event_registration_state(c.tenant_id,c.id,p_hash);
end $$;
revoke all on function public.change_synthetic_registration(uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.change_synthetic_registration(uuid,integer,text,text) to service_role;
