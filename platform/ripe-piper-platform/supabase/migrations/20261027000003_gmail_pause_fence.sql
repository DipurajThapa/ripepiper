-- Serialize a selected Gmail import against account pause and reactivation.
create function public.record_gmail_product_event(p_expected_version integer,p_connection_expires timestamptz,p_tenant uuid,p_lead uuid,p_actor uuid,p_reference text,p_rights text,p_excerpt text,p_observed timestamptz,p_synthetic boolean,p_context jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare account public.tenants%rowtype;
begin
 if current_user <> 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 select * into account from public.tenants where id=p_tenant for update;
 if not found or account.status <> 'active' or p_expected_version is null or account.execution_version <> p_expected_version
  or p_connection_expires is null or p_connection_expires <= clock_timestamp() then
  raise exception 'Account or connection authority changed' using errcode='40001';
 end if;
 return public.record_product_event(p_tenant,p_lead,p_actor,p_reference,p_rights,p_excerpt,p_observed,p_synthetic,p_context);
end $$;
revoke all on function public.record_gmail_product_event(integer,timestamptz,uuid,uuid,uuid,text,text,text,timestamptz,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.record_gmail_product_event(integer,timestamptz,uuid,uuid,uuid,text,text,text,timestamptz,boolean,jsonb) to service_role;
