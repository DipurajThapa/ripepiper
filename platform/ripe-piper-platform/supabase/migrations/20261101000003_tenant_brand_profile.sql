-- Hybrid operating model, wave 3: the tenant brand profile lives in the existing versioned revive_setups body.
-- Four optional keys (replyTo, signature, booking, legalFooter); bodies without them stay valid, because stored
-- setups are re-validated on every read. A brand edit is a new setup version, so the existing trigger already
-- moves approved campaigns back to draft and cancels queued actions (approve-once for identity).
-- One SQL sign-off mirrors src/lib/brand.ts brandSignoff, so the envelope and Signal checks keep TS/SQL parity.
-- Live definitions are edited through pg_get_functiondef with exact literal match counts (the wave-1 pattern).

-- brandSignoff: signature (or sender name plus business), then the postal address, then the stop line.
create function public.revive_setup_signoff(p_setup jsonb,p_business text,p_stop text) returns text
language sql immutable security invoker set search_path='' as $$
 select concat_ws(E'\n\n',
  coalesce(nullif(btrim(p_setup->>'signature',E' \t\r\n'),''),
   nullif(concat_ws(E'\n',nullif(btrim(p_setup->>'senderName',E' \t\r\n'),''),nullif(btrim(p_business,E' \t\r\n'),'')),'')),
  nullif(btrim(p_setup->'legalFooter'->>'postalAddress',E' \t\r\n'),''),
  nullif(btrim(p_stop,E' \t\r\n'),''))
$$;

-- Templates carry no sign-off: the setup sign-off is appended after slot substitution, so it cannot inject a slot.
drop function public.envelope_render_step(jsonb,text,text,text,text,text);
create function public.envelope_render_step(p_template jsonb,p_need text,p_offer text,p_sender text,p_business text,p_cta text,p_signoff text) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare k text; v text; rendered jsonb:=jsonb_build_object('offsetHours',p_template->'offsetHours');
begin
 foreach k in array array['subject','body'] loop
  v:=replace(replace(replace(replace(replace(p_template->>k,'{{need}}',p_need),'{{offer}}',p_offer),'{{sender}}',p_sender),'{{business}}',p_business),'{{cta}}',p_cta);
  if k='body' then v:=v||E'\n\n'||p_signoff; end if;
  rendered:=rendered||jsonb_build_object(k,v);
 end loop;
 return rendered;
end $$;

do $grants$
declare f text;
begin
 foreach f in array array['public.revive_setup_signoff(jsonb,text,text)','public.envelope_render_step(jsonb,text,text,text,text,text,text)'] loop
  execute format('revoke all on function %s from public,anon,authenticated',f);
  execute format('grant execute on function %s to service_role',f);
 end loop;
end $grants$;

create or replace function public.confirm_tenant_unsubscribe(p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare scope uuid; token ripepiper_private.tenant_unsubscribe_tokens%rowtype; address text; at_time timestamptz; business text;
begin
 if current_user<>'service_role' then raise exception 'Service required' using errcode='42501';end if;
 if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return '{"version":1,"status":"invalid"}'::jsonb;end if;
 select tenant_id into scope from ripepiper_private.tenant_unsubscribe_tokens where token_hash=p_hash;
 if not found then return '{"version":1,"status":"invalid"}'::jsonb;end if;
 -- Only the token's own tenant is ever named, and only after the token is found.
 select left(name,200) into business from public.tenants where id=scope for update;
 select * into token from ripepiper_private.tenant_unsubscribe_tokens where token_hash=p_hash and tenant_id=scope for update;
 if not found then return '{"version":1,"status":"invalid"}'::jsonb;end if;
 -- Historical confirmation takes precedence: no writes on replay, even after address change.
 if token.confirmed_at is not null then return jsonb_build_object('version',1,'status','confirmed','businessName',business);end if;
 select lower(trim(email)) into address from public.leads where tenant_id=token.tenant_id and id=token.lead_id for update;
 at_time:=clock_timestamp();
 if not found or address is distinct from token.normalized_email or token.expires_at<=at_time then return '{"version":1,"status":"invalid"}'::jsonb;end if;
 perform ripepiper_private.apply_tenant_contact_stop(token.tenant_id,token.lead_id);
 update ripepiper_private.tenant_unsubscribe_tokens set confirmed_at=at_time where token_hash=p_hash;
 return jsonb_build_object('version',1,'status','confirmed','businessName',business);
end $$;

do $rewrite$
declare f record; e record; src text; hits int;
begin
 create temp table brand_manifest(ord serial,fn regprocedure,pattern text,replacement text,n int);
 insert into brand_manifest(fn,pattern,replacement,n) select fn::regprocedure,pattern,replacement,n from (values
  -- The 16 required keys plus the four optional brand keys; null or absent means not configured.
  ('public.revive_setup_body_valid(jsonb)',
   $s$ if not public.revive_setup_keys(b,array['website','supportedClaims','sourceInventory','relationshipSummary','senderName','senderEmail','ownerId','market','language','timezone','salesCapacityPerWeek','outcomeWindowDays','workingDays','startMinute','endMinute','dailyContactCap']) then return false; end if;$s$,
   $s$ if jsonb_typeof(b) is distinct from 'object' then return false; end if;
 if not b ?& array['website','supportedClaims','sourceInventory','relationshipSummary','senderName','senderEmail','ownerId','market','language','timezone','salesCapacityPerWeek','outcomeWindowDays','workingDays','startMinute','endMinute','dailyContactCap']
  or exists(select 1 from jsonb_object_keys(b) k where k<>all(array['website','supportedClaims','sourceInventory','relationshipSummary','senderName','senderEmail','ownerId','market','language','timezone','salesCapacityPerWeek','outcomeWindowDays','workingDays','startMinute','endMinute','dailyContactCap','replyTo','signature','booking','legalFooter'])) then return false; end if;
 if coalesce(b->'replyTo','null')<>'null'::jsonb and (not public.revive_setup_text(b->'replyTo',254,true) or b->>'replyTo'~'[[:space:]]' or b->>'replyTo'!~'^[^@<>]+@[^@<>]+\.[^@<>]+$') then return false; end if;
 if coalesce(b->'signature','null')<>'null'::jsonb and (not public.revive_setup_text(b->'signature',500) or b->>'signature'~'[<>`{}\[\]]|\$\{|<%|%>|%[[:alnum:]_]+%') then return false; end if;
 if coalesce(b->'booking','null')<>'null'::jsonb and (not public.revive_setup_keys(b->'booking',array['url','reference']) or jsonb_typeof(b->'booking'->'url') is distinct from 'string'
  or not public.revive_booking_url_valid(b->'booking'->>'url') or not public.revive_setup_text(b->'booking'->'reference',240,true)) then return false; end if;
 if coalesce(b->'legalFooter','null')<>'null'::jsonb and (not public.revive_setup_keys(b->'legalFooter',array['postalAddress','reference']) or not public.revive_setup_text(b->'legalFooter'->'postalAddress',300)
  or b->'legalFooter'->>'postalAddress'~'[<>`{}\[\]]|\$\{|<%|%>|%[[:alnum:]_]+%' or not public.revive_setup_text(b->'legalFooter'->'reference',240,true)) then return false; end if;$s$,1),
  -- Envelope parity with proposeReviveDraft: setup booking is the default call to action and the setup sign-off is appended.
  ('public.envelope_campaign_fit(uuid,uuid,integer,timestamptz)',
   $s$cta:=case when e.body->>'bookingUrl' is not null then 'If this is relevant, choose a time to discuss it: '||(e.body->>'bookingUrl') else$s$,
   $s$cta:=case when coalesce(e.body->>'bookingUrl',setup->'booking'->>'url') is not null then 'If this is relevant, choose a time to discuss it: '||coalesce(e.body->>'bookingUrl',setup->'booking'->>'url') else$s$,1),
  ('public.envelope_campaign_fit(uuid,uuid,integer,timestamptz)',
   $s$public.envelope_render_step(e.body->'templates'->(s.n::integer-1),need,offer,sender,business,cta)$s$,
   $s$public.envelope_render_step(e.body->'templates'->(s.n::integer-1),need,offer,sender,business,cta,public.revive_setup_signoff(setup,business,'To opt out of follow-up, reply "stop".'))$s$,1),
  -- Signal parity with buildSignalProposal: setup booking call to action and the setup sign-off.
  ('public.signal_binding_valid(uuid,uuid,jsonb,jsonb,jsonb,timestamptz)',
   $s$if p->'strategy'->>'cta' is distinct from 'Would a conversation about '||(p->'strategy'->>'canonicalNeed')||' be useful?'$s$,
   $s$if p->'strategy'->>'cta' is distinct from coalesce('If this is relevant, choose a time to discuss it: '||(setup->'body'->'booking'->>'url'),'Would a conversation about '||(p->'strategy'->>'canonicalNeed')||' be useful?')$s$,1),
  ('public.signal_binding_valid(uuid,uuid,jsonb,jsonb,jsonb,timestamptz)',
   $s$E'\n\nWould a conversation about '||(p->'strategy'->>'canonicalNeed')||E' be useful?\n\n'||(p->'sender'->>'name')||E'\nReply stop if you would prefer no further contact.'$s$,
   $s$E'\n\n'||(p->'strategy'->>'cta')||E'\n\n'||public.revive_setup_signoff(setup->'body',p_snapshot->'tenant'->>'name','Reply stop if you would prefer no further contact.')$s$,1)
 ) m(fn,pattern,replacement,n);
 for f in select fn from brand_manifest group by fn order by min(ord) loop
  src:=pg_get_functiondef(f.fn);
  for e in select * from brand_manifest where fn=f.fn order by ord loop
   hits:=(length(src)-length(replace(src,e.pattern,'')))/length(e.pattern);
   if hits<>e.n then raise exception 'Brand rewrite drift in %: expected % match(es), found %: %',f.fn,e.n,hits,e.pattern;end if;
   src:=replace(src,e.pattern,e.replacement);
  end loop;
  execute src;
 end loop;
 drop table brand_manifest;
end $rewrite$;
