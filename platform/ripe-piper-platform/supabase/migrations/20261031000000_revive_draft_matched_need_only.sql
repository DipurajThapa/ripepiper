-- Only the brief need that matches the reviewed source must be valid draft text, as in the Worker
-- (brief.needs.find then fragment). An unrelated unsafe need no longer blocks every draft and strategy.
create or replace function public.reviewed_revive_draft_need(p_tenant uuid,p_lead uuid,p_source uuid,p_brief integer,p_now timestamptz)
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
  fits:=lower(trim(canonical))=lower(trim(need));
  for alias_group in select key,value from jsonb_each(coalesce(b->'aliases'->'need','{}'::jsonb)) loop
   if lower(trim(alias_group.key))<>lower(trim(canonical)) then continue; end if;
   if jsonb_typeof(alias_group.value) is distinct from 'array' or jsonb_array_length(alias_group.value)>20 then return null; end if;
   for alias_value in select value from jsonb_array_elements(alias_group.value) loop
    if jsonb_typeof(alias_value) is distinct from 'string' or length(trim(alias_value#>>'{}')) not between 1 and 100 then return null; end if;
    if lower(trim(alias_value#>>'{}'))=lower(trim(need)) then fits:=true; end if;
   end loop;
  end loop;
  if fits then
   if not public.revive_draft_fragment_valid(canonical,100) then return null; end if;
   matches:=matches+1;matched:=canonical;
  end if;
 end loop;
 return case when matches=1 then matched else null end;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return null;
end $$;
revoke all on function public.reviewed_revive_draft_need(uuid,uuid,uuid,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.reviewed_revive_draft_need(uuid,uuid,uuid,integer,timestamptz) to service_role;
