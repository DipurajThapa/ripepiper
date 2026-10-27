create table public.agency_suppression (email text primary key, reason text not null, created_at timestamptz not null default now());
create table public.agency_opt_out_requests (token_hash text primary key, email text not null, expires_at timestamptz not null default now()+interval '24 hours', confirmed_at timestamptz);
alter table public.agency_suppression enable row level security;
alter table public.agency_opt_out_requests enable row level security;
revoke all on public.agency_suppression, public.agency_opt_out_requests from public, anon, authenticated;
grant all on public.agency_suppression, public.agency_opt_out_requests to service_role;

create function public.confirm_agency_opt_out(p_hash text) returns boolean language plpgsql security definer set search_path='' as $$
declare r public.agency_opt_out_requests%rowtype;
begin
 select * into r from public.agency_opt_out_requests where token_hash=p_hash;
 if not found then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(r.email,0));
 select * into r from public.agency_opt_out_requests where token_hash=p_hash for update;
 if not found then return false; end if;
 if r.confirmed_at is not null then return true; end if;
 if r.expires_at<=now() then return false; end if;
 insert into public.agency_suppression(email,reason) values(r.email,'verified public opt-out') on conflict(email) do nothing;
 update public.newsletter_subscribers set status='unsubscribed',unsubscribed_at=coalesce(unsubscribed_at,now()) where email=r.email;
 delete from public.agency_opt_out_requests where email=r.email and token_hash<>p_hash;
 update public.agency_opt_out_requests set confirmed_at=coalesce(confirmed_at,now()) where token_hash=p_hash;
 return true;
end $$;
create function public.request_agency_newsletter(p_email text) returns uuid language plpgsql security definer set search_path='' as $$
declare token uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_email,0));
 if exists(select 1 from public.agency_suppression where email=p_email) or exists(select 1 from public.suppression where email=p_email) then return null; end if;
 insert into public.newsletter_subscribers(email,status,consent_at) values(p_email,'pending',now())
 on conflict(email) do update set consent_at=now() where public.newsletter_subscribers.status='pending'
 returning confirm_token into token;
 return token;
end $$;
create function public.confirm_agency_newsletter(p_token uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare e text;
begin
 select email into e from public.newsletter_subscribers where confirm_token=p_token;
 if e is null then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(e,0));
 update public.newsletter_subscribers set status='confirmed',confirmed_at=now()
 where email=e and confirm_token=p_token and status='pending' and not exists(select 1 from public.agency_suppression where email=e) and not exists(select 1 from public.suppression where email=e);
 return found;
end $$;
revoke all on function public.confirm_agency_opt_out(text),public.request_agency_newsletter(text),public.confirm_agency_newsletter(uuid) from public,anon,authenticated;
grant execute on function public.confirm_agency_opt_out(text),public.request_agency_newsletter(text),public.confirm_agency_newsletter(uuid) to service_role;

create function public.issue_agency_opt_out(p_email text,p_hash text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_email,0));
 if exists(select 1 from public.agency_opt_out_requests where email=p_email and expires_at>now()+interval '23 hours 59 minutes') then return false; end if;
 insert into public.agency_opt_out_requests(token_hash,email) values(p_hash,p_email);
 return true;
end $$;
revoke all on function public.issue_agency_opt_out(text,text) from public,anon,authenticated;
grant execute on function public.issue_agency_opt_out(text,text) to service_role;
