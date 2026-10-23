-- RP-014: one transaction per registered billing reference. No outbound delivery worker.
alter table public.payments add column quote_id uuid references public.quotes(id) on delete restrict;
alter table public.payments add column settled_at timestamptz;
alter table public.quotes add column paid_at timestamptz;
create index payments_target_lookup on public.payments(proposal_id,purpose,quote_id);
-- Invoker functions need only the existing service role; no client EXECUTE grants.
grant select,insert,update on public.proposals,public.quotes,public.payments,public.tenants,public.invites,public.fees,public.activity_log,public.leads to service_role;
grant select on public.profiles,public.memberships to service_role;
grant usage,select on sequence public.activity_log_id_seq to service_role;

create function public.reserve_payment_checkout(p_proposal uuid,p_quote uuid,p_provider text,p_amount_minor bigint,p_currency text,p_actor uuid,p_attempt uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p public.proposals%rowtype;q public.quotes%rowtype;m public.payments%rowtype;expected numeric;target_tenant uuid;v_purpose text;
begin
 if current_user<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 if p_attempt is null or p_provider is null or p_provider not in ('stripe','razorpay') or p_amount_minor is null or p_amount_minor<=0 or p_amount_minor>999999999999 or p_currency is null or (p_provider='stripe' and p_currency<>'AED') or (p_provider='razorpay' and p_currency<>'INR') then raise exception 'Invalid checkout attempt'; end if;
 select * into p from public.proposals where id=p_proposal for update;
 if not found then raise exception 'Unknown proposal'; end if;
 expected:=p.advance_amount*100;target_tenant:=p.tenant_id;v_purpose:='advance';
 if p_quote is not null then
  select * into q from public.quotes where id=p_quote and proposal_id=p.id for update;
  if not found or q.tenant_id is null or q.tenant_id is distinct from p.tenant_id or q.currency<>p.currency or p.status<>'paid' or q.status not in ('sent','accepted') or q.paid_at is not null then raise exception 'Quotation is not open for payment'; end if;
  if p_actor is null or not (exists(select 1 from public.profiles where id=p_actor and is_admin) or exists(select 1 from public.memberships where user_id=p_actor and tenant_id=q.tenant_id and role='owner')) then raise exception 'Quote owner required' using errcode='42501'; end if;
  expected:=q.total*100;target_tenant:=q.tenant_id;v_purpose:='quote';
 elsif p.status not in ('sent','approved') then raise exception 'Proposal is not open for payment'; end if;
 if p_currency<>p.currency or expected<>p_amount_minor then raise exception 'Checkout financial terms changed'; end if;
 if exists(select 1 from public.payments where proposal_id=p.id and payments.purpose=v_purpose and (quote_id is not distinct from p_quote or (v_purpose='quote' and quote_id is null))) then raise exception 'Existing checkout requires reconciliation'; end if;
 insert into public.payments(proposal_id,quote_id,tenant_id,provider,provider_ref,purpose,amount,currency,status,raw)
 values(p.id,p_quote,target_tenant,p_provider,'attempt:'||p_attempt::text,v_purpose,p_amount_minor::numeric/100,p_currency,'pending',jsonb_build_object('checkout',jsonb_build_object('version',1,'state','creating','attemptId',p_attempt))) returning * into m;
 return jsonb_build_object('version',1,'disposition','reserved','paymentId',m.id,'attemptId',p_attempt,'provider',p_provider,'proposalId',p.id,'quoteId',p_quote,'amountMinor',p_amount_minor,'currency',p_currency);
end $$;
revoke all on function public.reserve_payment_checkout(uuid,uuid,text,bigint,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_payment_checkout(uuid,uuid,text,bigint,text,uuid,uuid) to service_role;

create function public.register_payment_checkout(p_proposal uuid,p_quote uuid,p_provider text,p_ref text,p_amount_minor bigint,p_currency text,p_actor uuid,p_attempt uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p public.proposals%rowtype;q public.quotes%rowtype;m public.payments%rowtype;target_tenant uuid;expected numeric;v_purpose text;
begin
 if current_user<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 if p_provider not in ('stripe','razorpay') or p_provider is null or p_ref is null or length(p_ref)>190 or
   (p_provider='stripe' and p_ref!~'^cs_[A-Za-z0-9_]+$') or (p_provider='razorpay' and p_ref!~'^plink_[A-Za-z0-9_]+$') or
   p_amount_minor is null or p_amount_minor<=0 or p_amount_minor>999999999999 or p_currency is null or
   (p_provider='stripe' and p_currency<>'AED') or (p_provider='razorpay' and p_currency<>'INR') then raise exception 'Invalid checkout binding'; end if;
 select * into p from public.proposals where id=p_proposal for update;
 if not found then raise exception 'Unknown proposal'; end if;
 target_tenant:=p.tenant_id;expected:=p.advance_amount*100;v_purpose:='advance';
 if p_quote is not null then
  select * into q from public.quotes where id=p_quote and proposal_id=p.id for update;
  if not found or q.tenant_id is null or q.tenant_id is distinct from p.tenant_id or q.currency<>p.currency or p.status<>'paid' or q.status not in ('sent','accepted') or q.paid_at is not null then raise exception 'Quotation is not open for payment'; end if;
  if p_actor is null or not (exists(select 1 from public.profiles where id=p_actor and is_admin) or exists(select 1 from public.memberships where user_id=p_actor and tenant_id=q.tenant_id and role='owner')) then raise exception 'Quote owner required' using errcode='42501'; end if;
  expected:=q.total*100;v_purpose:='quote';target_tenant:=q.tenant_id;
 elsif p.status not in ('sent','approved') then raise exception 'Proposal is not open for payment';
 end if;
 if p_currency<>p.currency or p_amount_minor<>expected then raise exception 'Checkout financial terms changed'; end if;
 -- A reference can never be rebound, including a legacy reference with insufficient quote provenance.
 select * into m from public.payments where provider=p_provider and provider_ref=p_ref for update;
 if found then
  if m.proposal_id is distinct from p.id or m.quote_id is distinct from p_quote or m.purpose<>v_purpose or m.currency<>p_currency or m.amount*100<>p_amount_minor or m.tenant_id is distinct from target_tenant then raise exception 'Checkout reference already bound'; end if;
  if p_attempt is null or m.raw->'checkout'->>'attemptId' is distinct from p_attempt::text then raise exception 'Checkout attempt mismatch'; end if;
  if m.status not in ('pending','failed') or m.settled_at is not null then raise exception 'Checkout requires reconciliation'; end if;
  return jsonb_build_object('version',1,'paymentId',m.id,'provider',m.provider,'ref',m.provider_ref,'proposalId',m.proposal_id,'quoteId',m.quote_id,'amountMinor',p_amount_minor,'currency',m.currency,'status',m.status);
 end if;
 select * into m from public.payments where proposal_id=p.id and payments.purpose=v_purpose and quote_id is not distinct from p_quote for update;
 if not found or p_attempt is null or m.raw->'checkout'->>'attemptId' is distinct from p_attempt::text or m.provider_ref is distinct from 'attempt:'||p_attempt::text or m.provider<>p_provider or m.status<>'pending' or m.currency<>p_currency or m.amount*100<>p_amount_minor or m.tenant_id is distinct from target_tenant then raise exception 'Checkout attempt requires reconciliation'; end if;
 update public.payments set provider_ref=p_ref,raw=raw||jsonb_build_object('checkout',(raw->'checkout')||jsonb_build_object('state','bound')) where id=m.id returning * into m;
 if p_quote is null then
  update public.proposals set status='approved',approved_at=coalesce(approved_at,now()) where id=p.id;
 else
  if q.status='sent' then
   update public.quotes set status='accepted' where id=q.id;
   insert into public.activity_log(tenant_id,actor,kind,message) values(q.tenant_id,'Ripe Piper','change','Quotation accepted: '||q.id::text||'.');
  end if;
 end if;
 return jsonb_build_object('version',1,'paymentId',m.id,'provider',m.provider,'ref',m.provider_ref,'proposalId',m.proposal_id,'quoteId',m.quote_id,'amountMinor',p_amount_minor,'currency',m.currency,'status',m.status);
end $$;
revoke all on function public.register_payment_checkout(uuid,uuid,text,text,bigint,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.register_payment_checkout(uuid,uuid,text,text,bigint,text,uuid,uuid) to service_role;

create function public.apply_payment_event(p_proposal uuid,p_quote uuid,p_provider text,p_ref text,p_amount_minor bigint,p_currency text,p_status text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p public.proposals%rowtype;q public.quotes%rowtype;m public.payments%rowtype;l public.leads%rowtype;
 target_tenant uuid;expected numeric;v_purpose text;fee_id uuid;activity_id bigint;invite_id uuid;receipt jsonb;billing jsonb;reason text;at_time timestamptz:=now();
begin
 if current_user<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 if p_provider is null or p_provider not in ('stripe','razorpay') or p_status is null or p_status not in ('paid','failed') or p_amount_minor is null or p_amount_minor<=0 or p_amount_minor>999999999999 or p_ref is null or length(p_ref)>190 or (p_provider='stripe' and p_ref!~'^cs_[A-Za-z0-9_]+$') or (p_provider='razorpay' and p_ref!~'^plink_[A-Za-z0-9_]+$') or p_currency is null then raise exception 'Invalid payment event'; end if;
 -- Same lock order as checkout registration. Proposal lock also serializes different references.
 select * into p from public.proposals where id=p_proposal for update;
 if not found then return jsonb_build_object('version',1,'disposition','rejected','reason','unknown_target'); end if;
 v_purpose:='advance';target_tenant:=p.tenant_id;expected:=p.advance_amount*100;
 if p_quote is not null then
  select * into q from public.quotes where id=p_quote and proposal_id=p.id for update;
  if not found or q.tenant_id is null or q.tenant_id is distinct from p.tenant_id or q.currency<>p.currency then return jsonb_build_object('version',1,'disposition','rejected','reason','target_binding'); end if;
  v_purpose:='quote';expected:=q.total*100;target_tenant:=q.tenant_id;
 end if;
 select * into m from public.payments where provider=p_provider and provider_ref=p_ref for update;
 if not found then return jsonb_build_object('version',1,'disposition','rejected','reason','unregistered_reference'); end if;
 if m.proposal_id is distinct from p.id or m.quote_id is distinct from p_quote or m.purpose<>v_purpose or m.amount*100<>p_amount_minor or m.currency<>p_currency or m.tenant_id is distinct from target_tenant or p_currency<>p.currency or p_amount_minor<>expected or
 (p_provider='stripe' and p_currency<>'AED') or (p_provider='razorpay' and p_currency<>'INR') then
  if m.raw is null or jsonb_typeof(m.raw)='object' then update public.payments set raw=coalesce(raw,'{}'::jsonb)||jsonb_build_object('billingReview',jsonb_build_object('state','human_review_required','reason','financial_or_target_binding')) where id=m.id; end if;
  return jsonb_build_object('version',1,'disposition','rejected','reason','financial_or_target_binding');
 end if;
 if m.raw is not null and jsonb_typeof(m.raw)<>'object' then return jsonb_build_object('version',1,'disposition','rejected','reason','legacy_payload_requires_review'); end if;
 -- Immutable receipt replay, including late failed callbacks. Never downgrade paid/refunded rows.
 if m.settled_at is not null and m.status='paid' and m.raw->'billing'->'receipt'->>'disposition'='applied' then return m.raw->'billing'->'receipt'; end if;
 if m.status in ('paid','refunded') then return jsonb_build_object('version',1,'disposition','rejected','reason','legacy_or_refunded_requires_review'); end if;
 if (p_quote is null and p.status not in ('sent','approved')) or (p_quote is not null and (p.status<>'paid' or q.status<>'accepted' or q.paid_at is not null)) then
  update public.payments set raw=coalesce(raw,'{}'::jsonb)||jsonb_build_object('billingReview',jsonb_build_object('state','human_review_required','reason','target_not_open')) where id=m.id;
  return jsonb_build_object('version',1,'disposition','rejected','reason','target_not_open');
 end if;
 if p_quote is null and p.lead_id is not null then
  select * into l from public.leads where id=p.lead_id for update;
  -- A pre-client null lead is allowed; a different client's lead is never billing evidence.
  if not found or (l.tenant_id is not null and l.tenant_id is distinct from p.tenant_id) then return jsonb_build_object('version',1,'disposition','rejected','reason','target_binding'); end if;
 end if;
 if p_status='failed' then
  update public.payments set status='failed' where id=m.id;
  return jsonb_build_object('version',1,'disposition','failed','paymentId',m.id,'provider',m.provider,'ref',m.provider_ref,'proposalId',p.id,'quoteId',p_quote,'amountMinor',p_amount_minor,'currency',p_currency,'status','failed');
 end if;
 if p_quote is null then
  if target_tenant is null then
   insert into public.tenants(name,slug,country,currency,plan,package,status)
    values(coalesce(nullif(l.company,''),split_part(p.client_email,'@',2),'Client'), 'client-'||replace(p.id::text,'-',''),
     case when l.country in ('AE','IN','SA','QA') then l.country else 'OTHER' end,p.currency,p.plan,p.package,'onboarding') returning id into target_tenant;
   insert into public.invites(tenant_id,email,role) values(target_tenant,lower(p.client_email),'owner') returning id into invite_id;
  end if;
  update public.proposals set status='paid',paid_at=at_time,tenant_id=target_tenant where id=p.id;
  if p.lead_id is not null then update public.leads set status='won' where id=p.lead_id; end if;
  insert into public.fees(tenant_id,month,type,amount,currency,note) values(target_tenant,date_trunc('month',at_time)::date,'setup',m.amount,m.currency,p.advance_pct::text||'% advance on the fixed-scope price') returning id into fee_id;
  insert into public.activity_log(tenant_id,actor,kind,message) values(target_tenant,'Ripe Piper','milestone','Advance of '||m.amount::text||' '||m.currency||' received. Onboarding is awaiting team review.') returning id into activity_id;
 else
  update public.quotes set paid_at=at_time where id=q.id;
  insert into public.fees(tenant_id,month,type,amount,currency,note) values(target_tenant,date_trunc('month',at_time)::date,'quote',m.amount,m.currency,'Quotation '||q.id::text) returning id into fee_id;
  insert into public.activity_log(tenant_id,actor,kind,message) values(target_tenant,'Ripe Piper','milestone','Payment of '||m.amount::text||' '||m.currency||' received for the customisation quotation.') returning id into activity_id;
 end if;
 receipt:=jsonb_build_object('version',1,'disposition','applied','paymentId',m.id,'provider',m.provider,'ref',m.provider_ref,'proposalId',p.id,'quoteId',p_quote,'tenantId',target_tenant,'amountMinor',p_amount_minor,'currency',p_currency,'status','paid','feeId',fee_id,'activityId',activity_id,'inviteId',invite_id,'settledAt',at_time);
 -- Financial completion and manual notification disposition commit together. No delivery claim or automatic resend.
 billing:=jsonb_build_object('version',1,'receipt',receipt,'notifications',jsonb_build_object('state','human_review_required','key','billing:'||m.id::text,'clientPurpose',case when p_quote is null then 'advance_received' else 'quote_paid' end,'clientRecipientReference','proposal:'||p.id::text,'adminRecipientReference','configured_admin','automaticDelivery',false));
 update public.payments set tenant_id=target_tenant,status='paid',settled_at=at_time,
  raw=coalesce(raw,'{}'::jsonb)||jsonb_build_object('billing',billing) where id=m.id;
 return receipt;
end $$;
revoke all on function public.apply_payment_event(uuid,uuid,text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.apply_payment_event(uuid,uuid,text,text,bigint,text,text) to service_role;

-- PostgREST platform admins can edit legacy bank records and drafts, but cannot forge
-- service-owned provider acknowledgements or erase an uncertain creation attempt.
create function public.guard_managed_billing() returns trigger
language plpgsql security invoker set search_path='' as $$
declare managed boolean:=false;
begin
 -- The table owner already has maintenance/DDL authority; ordinary authenticated admins do not.
 if current_user='service_role' or current_user=(select pg_catalog.pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid=tg_relid) then
  if tg_op='DELETE' then return old; else return new; end if;
 end if;
 if tg_table_name='payments' then
  if tg_op<>'INSERT' then managed:=old.provider in ('stripe','razorpay') or old.settled_at is not null or coalesce(old.raw ?| array['checkout','billing','billingReview'],false); end if;
  if tg_op<>'DELETE' then managed:=managed or new.provider in ('stripe','razorpay') or new.settled_at is not null or coalesce(new.raw ?| array['checkout','billing','billingReview'],false); end if;
 elsif tg_table_name='proposals' then
  if tg_op='INSERT' then managed:=new.status='paid' or new.paid_at is not null;
  elsif tg_op='DELETE' then managed:=old.status='paid' or old.paid_at is not null;
  else managed:=new.paid_at is distinct from old.paid_at or ((new.status='paid' or old.status='paid') and new.status is distinct from old.status) or
    ((old.status='paid' or old.paid_at is not null) and (new.tenant_id is distinct from old.tenant_id or new.lead_id is distinct from old.lead_id or new.client_email is distinct from old.client_email or new.currency is distinct from old.currency or new.fixed_amount is distinct from old.fixed_amount or new.advance_pct is distinct from old.advance_pct)); end if;
  -- advance_amount is GENERATED ALWAYS: protecting its inputs preserves it without
  -- reading an uncomputed NEW generated value inside this BEFORE trigger.
 elsif tg_table_name='quotes' then
  if tg_op='INSERT' then managed:=new.paid_at is not null;
  elsif tg_op='DELETE' then managed:=old.paid_at is not null;
  else managed:=new.paid_at is distinct from old.paid_at or (old.paid_at is not null and (new.proposal_id is distinct from old.proposal_id or new.tenant_id is distinct from old.tenant_id or new.currency is distinct from old.currency or new.total is distinct from old.total)); end if;
 end if;
 if managed then raise exception 'Managed billing changes require the service role' using errcode='42501'; end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function public.guard_managed_billing() from public,anon,authenticated;
grant execute on function public.guard_managed_billing() to service_role;
create trigger payments_service_owned before insert or update or delete on public.payments for each row execute function public.guard_managed_billing();
create trigger proposals_paid_service_owned before insert or update or delete on public.proposals for each row execute function public.guard_managed_billing();
create trigger quotes_paid_service_owned before insert or update or delete on public.quotes for each row execute function public.guard_managed_billing();
