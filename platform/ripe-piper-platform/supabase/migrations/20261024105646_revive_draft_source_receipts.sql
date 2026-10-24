-- RP-020: an immutable service-owned receipt binds a generated draft to its
-- original reviewed source and canonical cohort need. No outreach authority.
alter table public.campaign_assets add column revive_draft_context jsonb;

create function public.revive_draft_fragment_valid(p_value text,p_max integer) returns boolean
language sql immutable security invoker set search_path='' as $$
 select coalesce(length(trim(p_value)) between 1 and p_max
  and p_value !~ $re$[[:cntrl:]<>`{}\[\]]|\$\{|<%|%>|%[[:alnum:]_]+%$re$
  and p_value !~* $re$(ignore|override).{0,40}(instructions|rules)|system[[:space:]]*prompt|assistant[[:space:]]*:|tool[_ -]?call$re$,false)
$$;
revoke all on function public.revive_draft_fragment_valid(text,integer) from public,anon,authenticated;
grant execute on function public.revive_draft_fragment_valid(text,integer) to service_role;

-- Literal matching avoids treating a fact's punctuation as a regular expression.
create function public.revive_draft_excerpt_mentions(p_excerpt text,p_value text) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare excerpt text:=lower(trim(p_excerpt)); term text:=lower(trim(p_value)); cursor_at integer:=1; found_at integer; rest text;
begin
 if excerpt is null or term is null or term='' then return false; end if;
 loop
  rest:=substring(excerpt from cursor_at);found_at:=strpos(rest,term);
  if found_at=0 then return false; end if;
  found_at:=found_at+cursor_at-1;
  if (found_at=1 or substring(excerpt from found_at-1 for 1)!~'[[:alnum:]]')
   and (found_at+length(term)>length(excerpt) or substring(excerpt from found_at+length(term) for 1)!~'[[:alnum:]]') then return true; end if;
  cursor_at:=found_at+1;
 end loop;
end $$;
revoke all on function public.revive_draft_excerpt_mentions(text,text) from public,anon,authenticated;
grant execute on function public.revive_draft_excerpt_mentions(text,text) to service_role;

create function public.reviewed_revive_draft_need(p_tenant uuid,p_lead uuid,p_source uuid,p_brief integer,p_now timestamptz)
returns text language plpgsql stable security invoker set search_path='' as $$
declare o public.lead_observations%rowtype; b jsonb; email text; days integer; entry record; n jsonb; alias_group record; alias_value jsonb;
 matched text; matches integer:=0; need text; canonical text; fits boolean;
begin
 if p_now is null or not public.campaign_brief_current(p_tenant,p_brief,p_now) then return null; end if;
 select body into b from public.business_briefs where tenant_id=p_tenant and version=p_brief;
 select l.email into email from public.leads l where l.tenant_id=p_tenant and l.id=p_lead;
 if not found then return null; end if;
 select * into o from public.lead_observations where id=p_source and tenant_id=p_tenant and lead_id=p_lead;
 if not found then return null; end if;
 days:=(b->>'maxAgeDays')::integer;
 if o.assessment_reviewed_by is null or o.synthetic is distinct from (lower(email) like '%.invalid')
  or o.observed_at>p_now or o.observed_at<p_now-days*interval '1 day'
  or coalesce(length(trim(o.rights_reference)),0) not between 1 and 240
  or coalesce(length(trim(o.source)),0)=0 or coalesce(length(trim(o.external_ref)),0)=0
  or coalesce(length(trim(o.assessment_excerpt)),0) not between 1 and 2000
  or o.assessment_excerpt ~* $re$\m(no|not|never|without|neither|denied|unknown|uncertain|maybe|might|possibly|former|previously|competitor|hypothetical|example)\M|n['’]t\M|\?$re$
  or jsonb_typeof(o.assessment_facts) is distinct from 'object' or o.assessment_facts='{}'::jsonb then return null; end if;
 for entry in select key,value from jsonb_each(o.assessment_facts) loop
  if entry.key not in ('industry','market','role','need') or jsonb_typeof(entry.value) is distinct from 'string'
   or length(trim(entry.value#>>'{}')) not between 1 and 100
   or not public.revive_draft_excerpt_mentions(o.assessment_excerpt,entry.value#>>'{}') then return null; end if;
 end loop;
 need:=o.assessment_facts->>'need';
 if not public.revive_draft_fragment_valid(need,100) or jsonb_typeof(b->'needs') is distinct from 'array'
  or jsonb_array_length(b->'needs') not between 1 and 20 then return null; end if;
 if b->'aliases'->'need' is not null and jsonb_typeof(b->'aliases'->'need') is distinct from 'object' then return null; end if;
 for n in select value from jsonb_array_elements(b->'needs') loop
  if jsonb_typeof(n) is distinct from 'string' then return null; end if;
  canonical:=n#>>'{}';
  if not public.revive_draft_fragment_valid(canonical,100) then return null; end if;
  fits:=lower(trim(canonical))=lower(trim(need));
  for alias_group in select key,value from jsonb_each(coalesce(b->'aliases'->'need','{}'::jsonb)) loop
   if lower(trim(alias_group.key))<>lower(trim(canonical)) then continue; end if;
   if jsonb_typeof(alias_group.value) is distinct from 'array' or jsonb_array_length(alias_group.value)>20 then return null; end if;
   for alias_value in select value from jsonb_array_elements(alias_group.value) loop
    if jsonb_typeof(alias_value) is distinct from 'string' or length(trim(alias_value#>>'{}')) not between 1 and 100 then return null; end if;
    if lower(trim(alias_value#>>'{}'))=lower(trim(need)) then fits:=true; end if;
   end loop;
  end loop;
  if fits then matches:=matches+1;matched:=canonical; end if;
 end loop;
 return case when matches=1 then matched else null end;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return null;
end $$;
revoke all on function public.reviewed_revive_draft_need(uuid,uuid,uuid,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.reviewed_revive_draft_need(uuid,uuid,uuid,integer,timestamptz) to service_role;

create function public.revive_draft_context_current(p_tenant uuid,p_actor uuid,p_context jsonb,p_now timestamptz)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare d jsonb:=p_context; lead uuid; source_id uuid; expires timestamptz; canonical text;
begin
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

-- Existing authenticated administrators may edit ordinary notes. A reserved
-- proposal receipt cannot be forged, rewritten, exposed to clients or deleted.
create function public.guard_revive_draft_receipt() returns trigger
language plpgsql security invoker set search_path='' as $$
declare before_payload jsonb; after_payload jsonb; reserved_before boolean:=false; reserved_after boolean:=false;
begin
 if tg_op<>'INSERT' then
  begin before_payload:=old.message::jsonb;exception when invalid_text_representation then before_payload:=null;end;
  reserved_before:=coalesce(before_payload->>'kind'='revive_draft_proposed',false);
 end if;
 if tg_op<>'DELETE' then
  begin after_payload:=new.message::jsonb;exception when invalid_text_representation then after_payload:=null;end;
  reserved_after:=coalesce(after_payload->>'kind'='revive_draft_proposed',false);
 end if;
 if reserved_before or reserved_after then
  if current_user not in ('service_role','postgres') then raise exception 'Proposal receipts are service owned' using errcode='42501'; end if;
  if tg_op='INSERT' then
   if new.visible_to_client or new.tenant_id is null then raise exception 'Private tenant receipt required' using errcode='23514'; end if;
  elsif current_user<>'postgres' and not(tg_op='DELETE' and not exists(select 1 from public.tenants where id=old.tenant_id)) then
   raise exception 'Proposal receipts are immutable' using errcode='23514';
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;return new;
end $$;
revoke all on function public.guard_revive_draft_receipt() from public,anon,authenticated;
create trigger revive_draft_receipt_guard before insert or update or delete on public.activity_log
for each row execute function public.guard_revive_draft_receipt();

create function public.record_revive_draft_proposal(p_tenant uuid,p_actor uuid,p_context jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare receipt_id bigint; receipt_message text;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Staff required' using errcode='42501'; end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if not found then raise exception 'Tenant missing' using errcode='23503'; end if;
 if not public.revive_draft_context_current(p_tenant,p_actor,p_context,now()) then raise exception 'Draft source or current review is invalid' using errcode='40001'; end if;
 receipt_message:=jsonb_build_object('kind','revive_draft_proposed','provenance',p_context)::text;
 select id into receipt_id from public.activity_log where tenant_id=p_tenant and actor=p_actor::text and kind='note' and not visible_to_client and message=receipt_message order by id limit 1;
 if receipt_id is null then
  insert into public.activity_log(tenant_id,actor,kind,message,visible_to_client) values(p_tenant,p_actor::text,'note',receipt_message,false) returning id into receipt_id;
 end if;
 return jsonb_build_object('proposalId',receipt_id::text,'draftContext',p_context);
end $$;
revoke all on function public.record_revive_draft_proposal(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_revive_draft_proposal(uuid,uuid,jsonb) to service_role;

create function public.assert_revive_draft_context(p_tenant uuid,p_actor uuid,p_context jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare receipt public.activity_log%rowtype; stored jsonb; receipt_id bigint;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Staff required' using errcode='42501'; end if;
 if jsonb_typeof(p_context) is distinct from 'object' or jsonb_typeof(p_context->'proposalId') is distinct from 'string'
  or coalesce(p_context->>'proposalId','') !~ '^[1-9][0-9]{0,18}$' then raise exception 'A stored proposal receipt is required' using errcode='40001'; end if;
 receipt_id:=(p_context->>'proposalId')::bigint;
 select * into receipt from public.activity_log where id=receipt_id and tenant_id=p_tenant and actor=p_actor::text and kind='note' and not visible_to_client;
 if not found then raise exception 'Stored proposal receipt does not match this actor or account' using errcode='40001'; end if;
 begin stored:=receipt.message::jsonb;exception when invalid_text_representation then raise exception 'Stored proposal receipt is invalid' using errcode='40001';end;
 if stored->>'kind' is distinct from 'revive_draft_proposed' or stored->'provenance' is distinct from (p_context-'proposalId')
  or not public.revive_draft_context_current(p_tenant,p_actor,p_context-'proposalId',now()) then
  raise exception 'Original draft source, need or review changed; regenerate the proposal' using errcode='40001';
 end if;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
 raise exception 'Invalid proposal receipt' using errcode='22023';
end $$;
revoke all on function public.assert_revive_draft_context(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.assert_revive_draft_context(uuid,uuid,jsonb) to service_role;

create function public.guard_revive_asset_context() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.revive_draft_context is distinct from old.revive_draft_context then raise exception 'Historical draft provenance is immutable; save a new asset version' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function public.guard_revive_asset_context() from public,anon,authenticated;
create trigger revive_asset_context_immutable before update of revive_draft_context on public.campaign_assets
for each row execute function public.guard_revive_asset_context();

create or replace function public.save_reviewed_revive_draft(p_tenant uuid,p_campaign uuid,p_actor uuid,p_version integer,p_body jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; audit text;
begin
 if current_user<>'service_role' or not exists(select 1 from public.profiles where id=p_actor and is_admin) then raise exception 'Staff required' using errcode='42501'; end if;
 perform 1 from public.tenants where id=p_tenant for update;
 if not found then raise exception 'Tenant missing' using errcode='23503'; end if;
 if p_body->>'product' is distinct from 'revive' then raise exception 'Revive draft required' using errcode='22023'; end if;
 perform public.assert_revive_draft_context(p_tenant,p_actor,p_body->'draftContext');
 result:=public.manage_campaign_plan(p_tenant,p_campaign,p_actor,'save',p_version,p_body);
 audit:=jsonb_build_object('kind','revive_draft_saved','campaign',p_campaign,'assetVersion',result->'version','provenance',p_body->'draftContext')::text;
 if not exists(select 1 from public.activity_log where tenant_id=p_tenant and message=audit) then
  insert into public.activity_log(tenant_id,actor,kind,message,visible_to_client) values(p_tenant,p_actor::text,'note',audit,false);
 end if;
 return result;
end $$;
revoke all on function public.save_reviewed_revive_draft(uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_reviewed_revive_draft(uuid,uuid,uuid,integer,jsonb) to service_role;
