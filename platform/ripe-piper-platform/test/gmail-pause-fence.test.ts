import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readFileSync,readdirSync} from 'node:fs';
import {tenantConnection,googleBindingDigest} from '../src/foundation/connections';
import type {Env} from '../src/env';
let db:PGlite;
const actor='11111111-1111-4111-8111-111111111111',connection='22222222-2222-4222-8222-222222222222',hash='a'.repeat(64);
beforeAll(async()=>{
 db=new PGlite({extensions:{btree_gist}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const f of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(f,dir),'utf8'));
 await db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,'admin@example.invalid',now())`,[actor]);await db.query('update profiles set is_admin=true where id=$1',[actor]);
},30000);
afterAll(async()=>{vi.unstubAllGlobals();await db?.close();});
async function scope(){
 await db.exec('reset role');
 const tenant=(await db.query<any>(`insert into tenants(name,slug,country,currency,status) values('Fixture',$1,'AE','AED','active') returning id,execution_version`,['fixture-'+crypto.randomUUID()])).rows[0];
 const lead=(await db.query<any>(`insert into leads(tenant_id,source,email) values($1,'import','contact@business.example') returning id`,[tenant.id])).rows[0].id;
 await db.exec('set role service_role');return {...tenant,lead,expires:new Date(Date.now()+600000).toISOString()};
}
const register=(t:any,expected=0,digest=hash,id=connection)=>db.query<any>('select public.register_tenant_google_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result',[t.id,actor,expected,t.execution_version,id,digest,'staff@example.invalid','calendar@example.invalid','approved-source',t.expires]);
function evidence(t:any,ref='message',authority=1,digest=hash){return [t.execution_version,t.expires,t.id,t.lead,actor,`gmail:${connection}:${ref}`,'approved-source','Reviewed message',new Date(Date.now()-10000).toISOString(),false,JSON.stringify({product:'response',kind:'reply',threadRef:`gmail:${connection}:thread`,disposition:'human',need:'',authority:'',timing:''}),authority,digest];}
const record='select public.record_authorized_gmail_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) id';
it('registers exact CAS, keeps namespace stable, rejects old/core/generic bypasses and preserves historical outcomes after revoke',async()=>{
 const t=await scope();expect((await register(t)).rows[0].result).toEqual({version:1,status:'verified',authorityVersion:1});
 await expect(register(t)).rejects.toThrow('authority changed');
 await expect(register(t,1,hash,'33333333-3333-4333-8333-333333333333')).rejects.toThrow('authority changed');
 const args=evidence(t);const id=(await db.query<any>(record,args)).rows[0].id;expect((await db.query<any>(record,args)).rows[0].id).toBe(id);
 const legacy='select public.record_gmail_product_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)';await expect(db.query(legacy,args.slice(0,11))).rejects.toThrow('does not exist');
 const generic='select public.record_product_event($1,$2,$3,$4,$5,$6,$7,$8,$9) id';const manual=[t.id,t.lead,actor,`GMAIL:${connection}:forged`,'approved-source','Reviewed message',args[8],false,args[10]];
 await expect(db.query(generic,manual)).rejects.toThrow('durable authority');
 await expect(db.query(generic,[...manual.slice(0,3),'manual-reply',...manual.slice(4)])).rejects.toThrow('existing reviewed response');
 await expect(db.query('select public.record_product_event_authorized_core($1,$2,$3,$4,$5,$6,$7,$8,$9,null,null,null,null)',manual)).rejects.toThrow('durable authority');
 expect((await db.query<any>('select public.revoke_tenant_google_authority($1,$2,1) result',[t.id,actor])).rows[0].result).toEqual({version:1,status:'revoked',authorityVersion:2});
 await expect(db.query(record,evidence(t,'after-revoke'))).rejects.toThrow('authority changed');
 const outcome=JSON.stringify({product:'response',kind:'outcome',threadRef:`gmail:${connection}:thread`,outcome:'opportunity',reason:'Historical review'});
 expect((await db.query<any>(generic,[...manual.slice(0,3),'manual-outcome',...manual.slice(4,8),outcome])).rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
 for(const thread of [`gmail:${connection}:fabricated`,`gmail:33333333-3333-4333-8333-333333333333:thread`])await expect(db.query(generic,[...manual.slice(0,3),'manual-foreign',...manual.slice(4,8),JSON.stringify({product:'response',kind:'outcome',threadRef:thread,outcome:'won',reason:'Invalid'})])).rejects.toThrow('existing reviewed response');
 const foreign=await scope();await expect(db.query(generic,[foreign.id,foreign.lead,...manual.slice(2,3),'foreign-outcome',...manual.slice(4,8),outcome])).rejects.toThrow('existing reviewed response');
 expect((await register(t,2,'b'.repeat(64))).rows[0].result.authorityVersion).toBe(3);await expect(db.query(record,evidence(t,'stale-hash',3))).rejects.toThrow('authority changed');
 expect((await db.query<any>(record,evidence(t,'rotated',3,'b'.repeat(64)))).rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
},30000);
it('fences authority against pause/reactivation, expiry, malformed metadata, actor revocation and browser roles',async()=>{
 const t=await scope();await register(t);
 await db.query(`select public.pause_tenant_execution($1,'pause fixture')`,[t.id]);await expect(db.query(record,evidence(t))).rejects.toThrow('authority changed');
 // Revocation is available while paused.
 await db.query('select public.revoke_tenant_google_authority($1,$2,1)',[t.id,actor]);
 await db.exec('reset role');await db.query(`update tenants set status='active' where id=$1`,[t.id]);await db.exec('set role service_role');
 await expect(register(t,2)).rejects.toThrow('authority changed');t.execution_version=(await db.query<any>('select execution_version from tenants where id=$1',[t.id])).rows[0].execution_version;
 await register(t,2);await db.query(`update tenant_google_authority set expires_at=clock_timestamp(),version=version+1 where tenant_id=$1`,[t.id]);await expect(db.query(record,evidence(t,'expired',4))).rejects.toThrow('authority changed');
 await expect(register({...t,expires:new Date(Date.now()-1000).toISOString()},4)).rejects.toThrow('Invalid connection metadata');
 await db.exec('reset role');await db.query('update auth.users set email_confirmed_at=null where id=$1',[actor]);await db.exec('set role service_role');await expect(register(t,3)).rejects.toThrow('Verified staff');await expect(db.query('select public.revoke_tenant_google_authority($1,$2,3)',[t.id,actor])).rejects.toThrow('Verified staff');
 await db.exec('reset role');await db.query('update auth.users set email_confirmed_at=now() where id=$1',[actor]);
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);await expect(db.query('select * from public.tenant_google_authority')).rejects.toThrow('permission denied');await expect(register(t,3)).rejects.toThrow('permission denied');await expect(db.query(record,evidence(t))).rejects.toThrow('permission denied');await db.exec('reset role');
 }
},30000);
it('executes Worker register/read/import/revoke against the actual SQL contract with isolated provider fixtures',async()=>{
 const t=await scope();const c={id:connection,tenantId:t.id,mailbox:'staff@example.invalid',calendarId:'calendar@example.invalid',purposeReference:'approved-source',expiresAt:t.expires,enabled:true,clientId:'fixture',clientSecret:'secret',refreshToken:'refresh'};
 const env={SUPABASE_URL:'https://db.example.invalid',GOOGLE_TENANT_CONNECTIONS:JSON.stringify([c])} as Env;
 const message={id:'message',threadId:'thread',internalDate:String(Date.now()-1000),sizeEstimate:100,labelIds:['INBOX'],payload:{mimeType:'text/plain',headers:[{name:'From',value:'contact@business.example'},{name:'To',value:c.mailbox},{name:'Subject',value:'Fixture'}],body:{data:btoa('Reviewed inbound fixture')}}};
 let reads=0;
 vi.stubGlobal('fetch',async(input:string,init?:RequestInit)=>{
  const u=new URL(input);
  if(u.pathname==='/auth/v1/user')return Response.json({id:actor,email:'admin@example.invalid'});
  if(u.host==='db.example.invalid'){
   try{
    if(u.pathname.includes('/rpc/')){const name=u.pathname.split('/').at(-1)!;if(!/^[a-z_]+$/.test(name))throw Error('Invalid fixture function');const args=JSON.parse(String(init?.body));const keys=Object.keys(args);if(keys.some(k=>!/^p_[a-z_]+$/.test(k)))throw Error('Invalid fixture argument');const result=await db.query<any>(`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) result`,Object.values(args));return Response.json(result.rows[0].result);}
    const table=u.pathname.split('/').at(-1)!;if(!['profiles','tenants','tenant_google_authority','leads'].includes(table))throw Error('Invalid fixture table');const where:string[]=[],values:string[]=[];
    for(const [key,v] of u.searchParams){if(['select','limit'].includes(key))continue;if(!/^[a-z_]+$/.test(key)||!v.startsWith('eq.'))throw Error('Invalid fixture filter');values.push(v.slice(3));where.push(`${key}=$${values.length}`);}
    return Response.json((await db.query<any>(`select ${u.searchParams.get('select')??'*'} from public.${table} where ${where.join(' and ')}`,values)).rows);
   }catch(e:any){return Response.json({code:e.code,message:e.message},{status:e.code==='40001'?409:e.code==='42501'?403:400});}
  }
  if(u.host==='oauth2.googleapis.com')return Response.json({access_token:'fixture',expires_in:3600});
  reads++;
  if(u.pathname.endsWith('/profile'))return Response.json({emailAddress:c.mailbox});
  if(u.pathname.includes('/calendarList/'))return Response.json({id:c.calendarId,accessRole:'reader'});
  if(u.pathname.endsWith('/message'))return Response.json(message);
  throw Error('Unexpected provider fixture read');
 });
 const run=(body:object)=>tenantConnection(new Request('https://worker.example.invalid',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify(body)}),env,t.id);
 expect((await run({operation:'preview',lead_id:t.lead,message_id:'message'})).status).toBe(409);expect(reads).toBe(0);
 const registered=await run({operation:'register',expectedVersion:0,reviewed:true});expect(await registered.json()).toEqual({version:1,status:'verified',authorityVersion:1});
 expect((await db.query<any>('select binding_hash from tenant_google_authority where tenant_id=$1',[t.id])).rows[0].binding_hash).toBe(await googleBindingDigest(c));
 const preview=await (await run({operation:'preview',lead_id:t.lead,message_id:'message'})).json() as any;
 const body={operation:'import',lead_id:t.lead,message_id:'message',reviewed:true,digest:preview.message.digest};
 const imported=await run(body);expect(imported.status).toBe(201);const saved=await imported.json() as any;expect((await (await run(body)).json() as any).id).toBe(saved.id);
 env.GOOGLE_TENANT_CONNECTIONS='malformed';expect(await (await run({operation:'revoke',expectedVersion:1})).json()).toEqual({version:1,status:'revoked',authorityVersion:2});
 env.GOOGLE_TENANT_CONNECTIONS=JSON.stringify([c]);const priorReads=reads;expect((await run(body)).status).toBe(409);expect(reads).toBe(priorReads);
 vi.unstubAllGlobals();
},30000);
