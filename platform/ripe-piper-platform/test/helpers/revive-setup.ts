import type {PGlite} from '@electric-sql/pglite';

/** Explicit synthetic configuration for existing regression fixtures, never production seed data. */
export function setupBody(actor:string,reference='interview:fixture',overrides:Record<string,unknown>={}){
 return {website:null,supportedClaims:[],sourceInventory:[{type:'interview',reference,rightsReference:'Synthetic fixture review only'}],relationshipSummary:{text:'Reviewed earlier enquiries whose project was deferred.',reference},senderName:'Fixture owner',senderEmail:'staff@example.invalid',ownerId:actor,market:'AE',language:'en',timezone:'UTC',salesCapacityPerWeek:10,outcomeWindowDays:30,workingDays:[1,2,3,4,5,6,7],startMinute:0,endMinute:1440,dailyContactCap:25,...overrides};
}
/** The four optional brand keys, as setupBody overrides; synthetic values only. */
export function brandProfile(name='Fixture owner',overrides:Record<string,unknown>={}){
 return {replyTo:'replies@example.invalid',signature:`${name}\nHead of Sales`,booking:{url:'https://calendar.google.com/calendar/appointments/schedules/fixture',reference:'booking:reviewed-fixture'},legalFooter:{postalAddress:'1 Fixture Street, Dubai, AE',reference:'legal:reviewed-fixture'},...overrides};
}
export function strategyBody(setupVersion:number,need='lead follow-up',reference='interview:fixture',overrides:Record<string,unknown>={}){
 return {setupVersion,canonicalNeed:need,segment:'Reviewed existing enquiries',relationshipRationale:'The reviewed earlier enquiry was deferred; current need is assessed separately.',valueProposition:'Discuss the reviewed offer where it remains relevant.',evidenceReference:reference,cta:{kind:'reply',prompt:'Is this still relevant for your team?'},goal:'qualified_conversation',confirmed:true,...overrides};
}
export async function fixtureService(db:PGlite,name:string,args:any[]){
 const before=(await db.query<any>('select current_user role')).rows[0].role;
 await db.exec('set role service_role');
 try{return (await db.query<any>(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args)).rows[0].value;}
 finally{await db.exec(before==='service_role'?'set role service_role':'reset role');}
}
export async function seedReviveSetup(db:PGlite,tenant:string,actor:string,overrides:Record<string,unknown>={}){
 const brief=(await db.query<any>('select version,body from business_briefs where tenant_id=$1 order by version desc limit 1',[tenant])).rows[0];
 if(!brief)throw Error('The regression fixture must create its reviewed business brief first');
 const context=await fixtureService(db,'revive_setup_context',[tenant,actor]);
 const body=setupBody(actor,brief.body.source.reference,overrides);
 const ack=await fixtureService(db,'save_revive_setup',[tenant,actor,context.setup?.version??0,brief.version,'reviewed',body]);
 return {setup:ack,body,strategy:strategyBody(ack.version,brief.body.needs[0],brief.body.source.reference),brief};
}
export async function resolvedReviveStrategy(db:PGlite,tenant:string,actor:string,leadIds:string[],strategy:ReturnType<typeof strategyBody>){
 const audience=await fixtureService(db,'build_revive_audience',[tenant,actor,{leadIds,confirmed:true}]);
 return {audience,strategy:await fixtureService(db,'build_revive_strategy',[tenant,actor,strategy,audience])};
}
