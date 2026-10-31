import {beforeAll,afterAll,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import {asOperator} from './helpers/access';
const actor='a5111111-1111-4111-8111-111111111111';let db:PGlite;
const q=async(sql:string,args:any[]=[]) => (await db.query<any>(sql,args)).rows;
async function intake(tenant:string,email:string,ref:string,rights='qa-rights',company='QA company'){
 await db.exec('set role service_role');try{return (await q('select import_review_lead($1,$2,$3,$4,$5,$6,$7,$8) result',[tenant,actor,email,company,ref,rights,'2026-10-22T00:00:00Z',true]))[0].result;}finally{await db.exec('reset role');}
}
async function tenant(){const id=(await q(`insert into tenants(name,slug,country,currency,status)values('QA import',$1,'AE','AED','onboarding')returning id`,[crypto.randomUUID()]))[0].id;await asOperator(db,{tenantId:id,profileId:actor});return id;}
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const file of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(file,dir),'utf8'));
 await q(`insert into auth.users(id,email,email_confirmed_at)values($1,'qa-import-staff@example.invalid',now())`,[actor]);await q('update profiles set is_admin=true where id=$1',[actor]);
},30000);
afterAll(async()=>db?.close());
it('exact source retry returns the original lead and observation, without new campaign, rights or activation',async()=>{
 const t=await tenant(),first=await intake(t,'QA-OLD@example.invalid','qa-row-1'),second=await intake(t,'qa-old@example.invalid','qa-row-1');
 expect(first.state).toBe('created');expect(second).toEqual({...first,state:'duplicate'});
 expect((await q('select count(*)::int n from leads where tenant_id=$1',[t]))[0].n).toBe(1);
 expect((await q('select count(*)::int n from lead_observations where tenant_id=$1',[t]))[0].n).toBe(1);
 for(const table of ['contact_rights','campaigns','outbound_actions','revive_reviews'])expect((await q(`select count(*)::int n from ${table} where tenant_id=$1`,[t]))[0].n).toBe(0);
 expect((await q('select status from tenants where id=$1',[t]))[0].status).toBe('onboarding');
});
it('source collision with changed email or rights rejects without creating an orphan lead',async()=>{
 const t=await tenant();await intake(t,'qa-one@example.invalid','qa-row-2');
 await expect(intake(t,'qa-two@example.invalid','qa-row-2')).rejects.toThrow(/Source reference conflict/);
 await expect(intake(t,'qa-one@example.invalid','qa-row-2','changed-rights')).rejects.toThrow(/Source reference conflict/);
 expect((await q('select count(*)::int n from leads where tenant_id=$1',[t]))[0].n).toBe(1);
});
it('same-tenant identity links a new source while another tenant retains an independent identity',async()=>{
 const t=await tenant(),x=await tenant(),first=await intake(t,'qa-shared@example.invalid','qa-shared-ref');
 const linked=await intake(t,'qa-shared@example.invalid','qa-second-ref'),foreign=await intake(x,'qa-shared@example.invalid','qa-shared-ref');
 expect(linked.state).toBe('linked');expect(linked.lead_id).toBe(first.lead_id);expect(linked.observation_id).not.toBe(first.observation_id);
 expect(foreign.state).toBe('created');expect(foreign.lead_id).not.toBe(first.lead_id);
});
it('reimport preserves existing unsubscribe, global suppression and company instead of silently authorizing it',async()=>{
 const t=await tenant(),first=await intake(t,'qa-stop@example.invalid','qa-initial','qa-rights','Original company');
 await q(`update leads set status='unsubscribed' where id=$1`,[first.lead_id]);await q(`insert into suppression(email,reason)values('qa-stop@example.invalid','QA stop')`);
 expect((await intake(t,'qa-stop@example.invalid','qa-new-source','qa-rights','Changed import company')).state).toBe('linked');
 expect((await q('select status,company from leads where id=$1',[first.lead_id]))[0]).toEqual({status:'unsubscribed',company:'Original company'});
 expect((await q('select count(*)::int n from suppression where email=$1',['qa-stop@example.invalid']))[0].n).toBe(1);
 expect((await q('select count(*)::int n from contact_rights where tenant_id=$1',[t]))[0].n).toBe(0);
});
