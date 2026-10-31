-- Tenant connection registry (hybrid model, wave 4). One row per tenant+provider+account; credentials are sealed in
-- the Worker (AES-GCM, AAD tenant|connection|provider) and stored only in ripepiper_private, which only service_role reaches.
-- Actor checks reuse ripepiper_private.can_operate. tenant_google_authority (the read-only pilot) is backfilled here and
-- mirrored on every write, so the registry carries its status and version; tenant_google_authority_current (and through it
-- record_authorized_gmail_event) also requires the registry row to be connected.

create table public.tenant_connections (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 provider text not null check(provider in ('google_workspace','microsoft_365','whatsapp_cloud','hubspot','linkedin','sms')),
 -- Mailbox (lowercase) once consent completes; null only while a chosen channel waits for consent.
 account_identity text check(account_identity is null or (octet_length(account_identity) between 3 and 320 and account_identity=lower(account_identity))),
 purposes text[] not null check(cardinality(purposes) between 1 and 3 and (
  (provider in ('google_workspace','microsoft_365') and purposes<@array['mail_send','mail_read','calendar'])
  or (provider in ('whatsapp_cloud','sms') and purposes<@array['messaging'])
  or (provider='linkedin' and purposes<@array['profile_link']) or (provider='hubspot' and purposes<@array['crm_sync']))),
 scopes_granted text[] not null default '{}' check(cardinality(scopes_granted)<=16 and octet_length(array_to_string(scopes_granted,' '))<=4096),
 status text not null check(status in ('disabled','pending_consent','connected','error','revoked')),
 last_checked_at timestamptz,
 last_error_code text check(last_error_code ~ '^[a-z0-9_]{1,64}$'),
 version integer not null check(version>0),
 consented_by uuid references public.profiles(id),
 consented_at timestamptz,
 expires_at timestamptz check(expires_at is null or isfinite(expires_at)),
 revoked_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 -- Only mailbox providers have an adapter: WhatsApp, LinkedIn, SMS and HubSpot are interest flags until approved.
 check(status<>'connected' or (provider in ('google_workspace','microsoft_365') and account_identity is not null and consented_by is not null)),
 check((status='revoked')=(revoked_at is not null)),
 unique(tenant_id,id),
 unique nulls not distinct (tenant_id,provider,account_identity)
);
alter table public.tenant_connections enable row level security;
revoke all on public.tenant_connections from public,anon,authenticated;
grant select,insert,update on public.tenant_connections to service_role;

-- Same rule as guard_google_authority_version; a health stamp alone (no authority change) keeps the version.
create function public.guard_tenant_connection_version() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (tg_op='INSERT' and new.version<>1) or (tg_op='UPDATE' and (new.id<>old.id or new.tenant_id<>old.tenant_id or new.provider<>old.provider
  or (new.version<>old.version+1 and not (new.version=old.version
   and to_jsonb(new)-'last_checked_at'-'last_error_code'-'updated_at'=to_jsonb(old)-'last_checked_at'-'last_error_code'-'updated_at')))) then
  raise exception 'Connection authority changed' using errcode='40001';
 end if;
 return new;
end $$;
revoke all on function public.guard_tenant_connection_version() from public,anon,authenticated;

-- Members and grantees read status metadata only (never secrets); a platform admin without a grant sees nothing.
-- Not security_invoker: the table has no browser grants, so the view filters to readable tenants itself.
-- security_barrier: a caller's own predicates (e.g. an erroring expression) never see rows before can_read_tenant filters them.
create view public.tenant_connection_status with (security_barrier) as
select c.id,c.tenant_id,c.provider,c.account_identity,c.purposes,c.scopes_granted,c.status,c.last_checked_at,c.last_error_code,
 c.version,c.consented_at,c.expires_at,c.revoked_at,c.updated_at
from public.tenant_connections c where public.can_read_tenant(c.tenant_id);
revoke all on public.tenant_connection_status from public,anon;
grant select on public.tenant_connection_status to authenticated;

create table ripepiper_private.tenant_connection_secrets (
 connection_id uuid primary key references public.tenant_connections(id) on delete cascade,
 key_id text not null check(key_id ~ '^[a-z0-9-]{1,32}$'),
 iv bytea not null check(octet_length(iv)=12),
 ciphertext bytea not null check(octet_length(ciphertext) between 17 and 16384),
 updated_at timestamptz not null default now()
);
-- Single-use OAuth state: only its SHA-256 is stored; tenant, actor and purposes come from here, never the browser.
create table ripepiper_private.oauth_states (
 state_hash text primary key check(state_hash ~ '^[0-9a-f]{64}$'),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 actor_id uuid not null references public.profiles(id) on delete cascade,
 provider text not null check(provider in ('google_workspace','microsoft_365')),
 purposes text[] not null check(cardinality(purposes) between 1 and 2 and purposes<@array['mail_send','calendar']),
 expected_identity text check(expected_identity is null or (octet_length(expected_identity) between 3 and 320 and expected_identity=lower(expected_identity))),
 key_id text not null check(key_id ~ '^[a-z0-9-]{1,32}$'),
 verifier_iv bytea not null check(octet_length(verifier_iv)=12),
 verifier_ciphertext bytea not null check(octet_length(verifier_ciphertext) between 17 and 512),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 check(expires_at>created_at and expires_at<=created_at+interval '10 minutes')
);
revoke all on ripepiper_private.tenant_connection_secrets,ripepiper_private.oauth_states from public,anon,authenticated;
grant select,insert,update,delete on ripepiper_private.tenant_connection_secrets,ripepiper_private.oauth_states to service_role;

-- A send snapshots the connection it used; the composite key keeps it inside the action's tenant.
alter table public.outbound_actions add column connection_id uuid, add column connection_version integer check(connection_version>0),
 add check((connection_id is null)=(connection_version is null)),
 add foreign key (tenant_id,connection_id) references public.tenant_connections(tenant_id,id);
create function public.guard_action_connection_snapshot() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.connection_id is not null and (new.connection_id is distinct from old.connection_id or new.connection_version is distinct from old.connection_version) then
  raise exception 'Connection snapshot is immutable' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function public.guard_action_connection_snapshot() from public,anon,authenticated;
create trigger action_connection_snapshot before update of connection_id,connection_version on public.outbound_actions for each row execute function public.guard_action_connection_snapshot();

-- Pilot connection ids are only unique per tenant; the registry id is derived from both so pilots never collide.
create function public.pilot_connection_id(p_tenant uuid,p_connection uuid) returns uuid language sql immutable set search_path='' as $$ select md5(p_tenant::text||':'||p_connection::text)::uuid $$;
revoke all on function public.pilot_connection_id(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pilot_connection_id(uuid,uuid) to service_role;

-- ---------------------------------------------------------------- backfill (before the version guard: versions carry over)
insert into public.tenant_connections(id,tenant_id,provider,account_identity,purposes,status,version,consented_by,consented_at,expires_at,revoked_at)
select public.pilot_connection_id(a.tenant_id,a.connection_id),a.tenant_id,'google_workspace',a.mailbox,array['mail_read','calendar'],case when a.revoked then 'revoked' else 'connected' end,
 a.version,a.verified_by,a.verified_at,a.expires_at,case when a.revoked then a.verified_at end
from public.tenant_google_authority a;
create trigger tenant_connection_version before insert or update on public.tenant_connections for each row execute function public.guard_tenant_connection_version();

-- Every pilot write (RPC or direct) lands in the registry in the same transaction; an authority change bumps its version.
-- A pilot write also takes the row back to the read-only pilot binding: any OAuth secret, send purpose and scope sealed onto it
-- is dropped, so a pilot revoke/re-verify (or mailbox change) can never resurrect or re-target a sending credential.
create function public.mirror_google_authority() returns trigger language plpgsql security invoker set search_path='' as $$
declare s text:=case when new.revoked then 'revoked' else 'connected' end; pid uuid:=public.pilot_connection_id(new.tenant_id,new.connection_id);
begin
 if not exists(select 1 from public.tenant_connections where id=pid) then
  insert into public.tenant_connections(id,tenant_id,provider,account_identity,purposes,status,version,consented_by,consented_at,expires_at,revoked_at)
  values(pid,new.tenant_id,'google_workspace',new.mailbox,array['mail_read','calendar'],s,1,new.verified_by,new.verified_at,new.expires_at,case when new.revoked then now() end);
  return null;
 end if;
 update public.tenant_connections c set account_identity=new.mailbox,status=s,consented_by=new.verified_by,consented_at=new.verified_at,expires_at=new.expires_at,
  purposes=array['mail_read','calendar'],scopes_granted='{}',revoked_at=case when new.revoked then coalesce(c.revoked_at,now()) end,last_error_code=null,version=c.version+1,updated_at=now()
 where c.id=pid and (c.account_identity,c.status,c.consented_by,c.consented_at,c.expires_at) is distinct from (new.mailbox,s,new.verified_by,new.verified_at,new.expires_at);
 if found then delete from ripepiper_private.tenant_connection_secrets where connection_id=pid; end if;
 return null;
end $$;
revoke all on function public.mirror_google_authority() from public,anon,authenticated;
create trigger google_authority_registry after insert or update on public.tenant_google_authority for each row execute function public.mirror_google_authority();

-- Pilot reads additionally need the registry row connected and unexpired (a registry revoke or error stops them).
do $current$
declare fn constant regprocedure:='public.tenant_google_authority_current(uuid,uuid,integer,integer,text)'::regprocedure;
 src text:=pg_get_functiondef(fn); pattern constant text:='and not a[.]revoked and a[.]expires_at>clock_timestamp[(][)]'; hits int;
begin
 select count(*) into hits from regexp_matches(src,pattern,'g');
 if hits<>1 then raise exception 'Registry rewrite drift in %: expected 1 match, found %',fn,hits; end if;
 execute regexp_replace(src,pattern,'and not a.revoked and a.expires_at>clock_timestamp() and exists(select 1 from public.tenant_connections c where c.id=public.pilot_connection_id(a.tenant_id,a.connection_id) and c.status=''connected'' and (c.expires_at is null or c.expires_at>clock_timestamp()))');
end $current$;

-- ---------------------------------------------------------------- RPCs (service_role only; actor checks via can_operate)
create function ripepiper_private.log_connection(p_tenant uuid,p_actor uuid,p_message text) returns void language sql security invoker set search_path='' as $$
 insert into public.activity_log(tenant_id,actor,kind,message,visible_to_client)
 select p_tenant,coalesce((select left(coalesce(nullif(trim(a.full_name),''),a.email),320) from public.profiles a where a.id=p_actor),'Ripe Piper'),'change',left(p_message,2000),true
$$;
revoke all on function ripepiper_private.log_connection(uuid,uuid,text) from public,anon,authenticated;
grant execute on function ripepiper_private.log_connection(uuid,uuid,text) to service_role;

-- Onboarding: chosen channels become pending_consent rows; unchosen channels have no row (disabled).
create function public.select_tenant_channels(p_tenant uuid,p_actor uuid,p_channels jsonb) returns jsonb language plpgsql set search_path='' as $$
declare ch jsonb; names text[]:='{}';
begin
 if current_user<>'service_role' then raise exception 'Not authorised' using errcode='42501'; end if;
 perform 1 from public.tenants where id=p_tenant and status<>'ended' for update;
 if not found or not ripepiper_private.can_operate(p_tenant,p_actor,'operate') then raise exception 'Not authorised' using errcode='42501'; end if;
 if jsonb_typeof(p_channels)<>'array' or jsonb_array_length(p_channels) not between 1 and 6
  or (select count(distinct c->>'provider') from jsonb_array_elements(p_channels) c)<>jsonb_array_length(p_channels) then
  raise exception 'Invalid channel selection' using errcode='22023'; end if;
 for ch in select * from jsonb_array_elements(p_channels) loop
  if jsonb_typeof(ch->'purposes')<>'array' then raise exception 'Invalid channel selection' using errcode='22023'; end if;
  -- A provider that already has a live account keeps it; selection never touches consented rows.
  if not exists(select 1 from public.tenant_connections where tenant_id=p_tenant and provider=ch->>'provider' and account_identity is not null and status<>'revoked') then
   insert into public.tenant_connections(tenant_id,provider,purposes,status,version)
   values(p_tenant,ch->>'provider',array(select distinct x from jsonb_array_elements_text(ch->'purposes') x order by x),'pending_consent',1)
   on conflict (tenant_id,provider,account_identity) do update set purposes=excluded.purposes,status='pending_consent',revoked_at=null,version=public.tenant_connections.version+1,updated_at=now()
    where public.tenant_connections.purposes is distinct from excluded.purposes or public.tenant_connections.status<>'pending_consent';
  end if;
  names:=names||(ch->>'provider');
 end loop;
 perform ripepiper_private.log_connection(p_tenant,p_actor,'Channels selected: '||array_to_string(names,', '));
 return (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'provider',c.provider,'status',c.status,'version',c.version) order by c.provider),'[]')
  from public.tenant_connections c where c.tenant_id=p_tenant and c.provider=any(names) and c.status<>'revoked');
end $$;

create function public.begin_oauth_state(p_tenant uuid,p_actor uuid,p_provider text,p_purposes text[],p_state_hash text,p_expected_identity text,p_key_id text,p_iv text,p_ciphertext text)
returns timestamptz language plpgsql set search_path='' as $$
declare expires timestamptz:=now()+interval '10 minutes';
begin
 if current_user<>'service_role' then raise exception 'Not authorised' using errcode='42501'; end if;
 if not exists(select 1 from public.tenants where id=p_tenant and status<>'ended') or not ripepiper_private.can_operate(p_tenant,p_actor,'operate') then
  raise exception 'Not authorised' using errcode='42501'; end if;
 delete from ripepiper_private.oauth_states where expires_at<=now();
 if (select count(*) from ripepiper_private.oauth_states where tenant_id=p_tenant)>=20 then raise exception 'Too many pending connections' using errcode='22023'; end if;
 insert into ripepiper_private.oauth_states(state_hash,tenant_id,actor_id,provider,purposes,expected_identity,key_id,verifier_iv,verifier_ciphertext,expires_at)
 values(p_state_hash,p_tenant,p_actor,p_provider,array(select distinct x from unnest(p_purposes) x order by x),p_expected_identity,p_key_id,decode(p_iv,'base64'),decode(p_ciphertext,'base64'),expires);
 return expires;
end $$;

-- Single use: the row is deleted whatever happens next; expired or no longer authorised returns null.
create function public.consume_oauth_state(p_provider text,p_state_hash text) returns jsonb language plpgsql set search_path='' as $$
declare s ripepiper_private.oauth_states%rowtype;
begin
 if current_user<>'service_role' then raise exception 'Not authorised' using errcode='42501'; end if;
 delete from ripepiper_private.oauth_states where state_hash=p_state_hash and provider=p_provider returning * into s;
 if s.state_hash is null or s.expires_at<=now() or not ripepiper_private.can_operate(s.tenant_id,s.actor_id,'operate') then return null; end if;
 return jsonb_build_object('tenantId',s.tenant_id,'actorId',s.actor_id,'provider',s.provider,'purposes',to_jsonb(s.purposes),'expectedIdentity',s.expected_identity,
  'keyId',s.key_id,'iv',encode(s.verifier_iv,'base64'),'ciphertext',encode(s.verifier_ciphertext,'base64'));
end $$;

-- p_connection is the id the secret's AAD was sealed with: the existing row for this account, the pending row, or a new id.
create function public.register_tenant_connection(p_tenant uuid,p_actor uuid,p_connection uuid,p_provider text,p_identity text,p_purposes text[],p_scopes text[],p_key_id text,p_iv text,p_ciphertext text)
returns jsonb language plpgsql set search_path='' as $$
declare c public.tenant_connections%rowtype;
begin
 if current_user<>'service_role' then raise exception 'Not authorised' using errcode='42501'; end if;
 perform 1 from public.tenants where id=p_tenant and status<>'ended' for update;
 if not found or not ripepiper_private.can_operate(p_tenant,p_actor,'operate') then raise exception 'Not authorised' using errcode='42501'; end if;
 if p_connection is null or p_provider is null or p_provider not in ('google_workspace','microsoft_365') or p_identity is null or p_identity<>lower(p_identity)
  or p_identity !~ '^[^[:space:]@<>",;]{1,64}@[^[:space:]@<>",;]{1,255}$' or coalesce(cardinality(p_purposes),0)=0 or not p_purposes<@array['mail_send','calendar']
  or p_scopes is null or exists(select 1 from unnest(p_scopes) x where x is null or x !~ '^[!-~]+$' or octet_length(x)>256) then
  raise exception 'Invalid connection' using errcode='22023'; end if;
 select * into c from public.tenant_connections where id=p_connection for update;
 if c.id is null then
  if exists(select 1 from public.tenant_connections where tenant_id=p_tenant and provider=p_provider and account_identity=p_identity) then
   raise exception 'Connection authority changed' using errcode='40001'; end if;
  insert into public.tenant_connections(id,tenant_id,provider,account_identity,purposes,scopes_granted,status,version,consented_by,consented_at)
  values(p_connection,p_tenant,p_provider,p_identity,array(select distinct x from unnest(p_purposes) x order by x),p_scopes,'connected',1,p_actor,now()) returning * into c;
 elsif c.tenant_id<>p_tenant or c.provider<>p_provider or c.account_identity<>p_identity then
  raise exception 'Connection authority changed' using errcode='40001';
 else
  update public.tenant_connections set account_identity=p_identity,purposes=array(select distinct x from unnest(p_purposes) x order by x),scopes_granted=p_scopes,
   status='connected',consented_by=p_actor,consented_at=now(),revoked_at=null,last_error_code=null,version=version+1,updated_at=now()
  where id=p_connection returning * into c;
 end if;
 insert into ripepiper_private.tenant_connection_secrets(connection_id,key_id,iv,ciphertext) values(c.id,p_key_id,decode(p_iv,'base64'),decode(p_ciphertext,'base64'))
 on conflict (connection_id) do update set key_id=excluded.key_id,iv=excluded.iv,ciphertext=excluded.ciphertext,updated_at=now();
 perform ripepiper_private.log_connection(p_tenant,p_actor,format('%s mailbox %s connected for %s',case p_provider when 'google_workspace' then 'Google Workspace' else 'Microsoft 365' end,p_identity,array_to_string(c.purposes,', ')));
 return jsonb_build_object('connectionId',c.id,'version',c.version,'status',c.status);
end $$;

create function public.revoke_tenant_connection(p_tenant uuid,p_actor uuid,p_connection uuid,p_expected_version integer) returns jsonb language plpgsql set search_path='' as $$
declare c public.tenant_connections%rowtype;
begin
 if current_user<>'service_role' then raise exception 'Not authorised' using errcode='42501'; end if;
 perform 1 from public.tenants where id=p_tenant for update;
 select * into c from public.tenant_connections where id=p_connection and tenant_id=p_tenant for update;
 -- Another tenant's connection is indistinguishable from no authority.
 if c.id is null or not ripepiper_private.can_operate(p_tenant,p_actor,'operate') then raise exception 'Not authorised' using errcode='42501'; end if;
 if p_expected_version is null or c.version<>p_expected_version then raise exception 'Connection authority changed' using errcode='40001'; end if;
 delete from ripepiper_private.tenant_connection_secrets where connection_id=c.id;
 if c.status='revoked' then return jsonb_build_object('connectionId',c.id,'version',c.version,'status',c.status); end if;
 -- A pilot row revokes through its own table so both stay in step (the mirror bumps the registry once).
 update public.tenant_google_authority set revoked=true,version=version+1 where tenant_id=p_tenant and public.pilot_connection_id(tenant_id,connection_id)=c.id and not revoked;
 update public.tenant_connections set status='revoked',revoked_at=now(),version=version+1,updated_at=now() where id=c.id and status<>'revoked';
 select * into c from public.tenant_connections where id=p_connection;
 perform ripepiper_private.log_connection(p_tenant,p_actor,format('%s connection %s revoked',c.provider,coalesce(c.account_identity,'(pending)')));
 return jsonb_build_object('connectionId',c.id,'version',c.version,'status',c.status);
end $$;

-- Preflight before every provider call; another tenant's connection id is simply false.
create function public.tenant_connection_current(p_tenant uuid,p_connection uuid,p_execution_version integer,p_version integer,p_purpose text) returns boolean
language sql volatile set search_path='' as $$
 select current_user='service_role' and exists(select 1 from public.tenants t join public.tenant_connections c on c.tenant_id=t.id
  where t.id=p_tenant and t.status='active' and t.execution_version=p_execution_version and c.id=p_connection and c.version=p_version
   and c.status='connected' and (c.expires_at is null or c.expires_at>clock_timestamp()) and p_purpose=any(c.purposes))
$$;

-- Newest connected row for the purpose with its sealed secret (pilot rows have none, so they never resolve here).
create function public.tenant_connection_credential(p_tenant uuid,p_purpose text) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',c.id,'tenantId',c.tenant_id,'provider',c.provider,'identity',c.account_identity,'version',c.version,'purposes',to_jsonb(c.purposes),
  'scopes',to_jsonb(c.scopes_granted),'executionVersion',t.execution_version,'keyId',s.key_id,'iv',encode(s.iv,'base64'),'ciphertext',encode(s.ciphertext,'base64'))
 from public.tenant_connections c join public.tenants t on t.id=c.tenant_id join ripepiper_private.tenant_connection_secrets s on s.connection_id=c.id
 where current_user='service_role' and c.tenant_id=p_tenant and t.status='active' and c.status='connected' and p_purpose=any(c.purposes)
  and (c.expires_at is null or c.expires_at>now())
 order by c.consented_at desc,c.id limit 1
$$;

-- Provider-rotated refresh token (Microsoft): re-sealed under the current key without changing authority.
create function public.reseal_tenant_connection_secret(p_tenant uuid,p_connection uuid,p_version integer,p_key_id text,p_iv text,p_ciphertext text) returns boolean
language plpgsql set search_path='' as $$
begin
 if current_user<>'service_role' then raise exception 'Not authorised' using errcode='42501'; end if;
 update ripepiper_private.tenant_connection_secrets s set key_id=p_key_id,iv=decode(p_iv,'base64'),ciphertext=decode(p_ciphertext,'base64'),updated_at=now()
 from public.tenant_connections c where c.id=s.connection_id and c.id=p_connection and c.tenant_id=p_tenant and c.version=p_version and c.status='connected';
 return found;
end $$;

-- Stable codes only, never provider bodies. A failure moves a connected row to error and bumps its version (stops sends).
create function public.record_connection_health(p_tenant uuid,p_connection uuid,p_code text) returns jsonb language plpgsql set search_path='' as $$
declare c public.tenant_connections%rowtype;
begin
 if current_user<>'service_role' then raise exception 'Not authorised' using errcode='42501'; end if;
 if p_code !~ '^[a-z0-9_]{1,64}$' then raise exception 'Invalid health code' using errcode='22023'; end if;
 select * into c from public.tenant_connections where id=p_connection and tenant_id=p_tenant for update;
 if c.id is null then raise exception 'Not authorised' using errcode='42501'; end if;
 if p_code is not null and c.status='connected' then
  update public.tenant_connections set status='error',last_checked_at=now(),last_error_code=p_code,version=version+1,updated_at=now() where id=c.id returning * into c;
  perform ripepiper_private.log_connection(p_tenant,null,format('%s connection %s needs attention (%s); sending through it has stopped',c.provider,c.account_identity,p_code));
 else
  update public.tenant_connections set last_checked_at=now(),last_error_code=p_code,updated_at=now() where id=c.id returning * into c;
 end if;
 return jsonb_build_object('connectionId',c.id,'version',c.version,'status',c.status);
end $$;

do $grants$
declare f text;
begin
 foreach f in array array['public.select_tenant_channels(uuid,uuid,jsonb)','public.begin_oauth_state(uuid,uuid,text,text[],text,text,text,text,text)',
  'public.consume_oauth_state(text,text)','public.register_tenant_connection(uuid,uuid,uuid,text,text,text[],text[],text,text,text)',
  'public.revoke_tenant_connection(uuid,uuid,uuid,integer)','public.tenant_connection_current(uuid,uuid,integer,integer,text)',
  'public.tenant_connection_credential(uuid,text)','public.reseal_tenant_connection_secret(uuid,uuid,integer,text,text,text)',
  'public.record_connection_health(uuid,uuid,text)'] loop
  execute format('revoke all on function %s from public,anon,authenticated',f);
  execute format('grant execute on function %s to service_role',f);
 end loop;
end $grants$;
