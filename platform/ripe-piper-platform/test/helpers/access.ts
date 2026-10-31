import type {PGlite} from '@electric-sql/pglite';

const GRANTOR_EMAIL='grantor@fixture.invalid';

/** Synthetic verified platform admin that authorises contract grants; never production seed data. */
async function grantor(db:PGlite){
 const found=(await db.query<{id:string}>('select id from public.profiles where email=$1',[GRANTOR_EMAIL])).rows[0];
 if(found)return found.id;
 const id=crypto.randomUUID();
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,GRANTOR_EMAIL]);
 await db.query('update public.profiles set is_admin=true where id=$1',[id]);
 return id;
}

/** Marks the profile as an operator and gives it an active contract grant on one tenant (runs as the fixture owner). */
export async function asOperator(db:PGlite,{tenantId,profileId,capabilities=['read','operate','approve']}:{tenantId:string;profileId:string;capabilities?:string[]}){
 await db.query('update public.profiles set is_operator=true where id=$1',[profileId]);
 return (await db.query<{id:string}>(`insert into public.operator_grants(tenant_id,operator_id,capabilities,authority,authorised_by,contract_reference,expires_at)
  values($1,$2,$3,'contract',$4,'fixture contract',now()+interval '30 days') returning id`,[tenantId,profileId,capabilities,await grantor(db)])).rows[0].id;
}

/** Makes the profile the tenant's client admin (memberships owner). */
export async function asOwner(db:PGlite,{tenantId,profileId}:{tenantId:string;profileId:string}){
 await db.query(`insert into public.memberships(tenant_id,user_id,role) values($1,$2,'owner') on conflict (tenant_id,user_id) do update set role='owner'`,[tenantId,profileId]);
}
