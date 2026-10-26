/** Bounded account research. All source content is data; no contact authority or writes. */
import type {Env} from '../env';
import {Db} from '../lib/db';
import {bad,json} from '../routes/http';
import {validInstant} from './prospecting';
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const identifier=/^[a-zA-Z0-9_-]{1,80}$/;
const object=(x:any)=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=(x:any,n:number):x is string=>typeof x==='string'&&!!x.trim()&&x.length<=n&&!/[\u0000-\u001f\u007f]/.test(x);
const exact=(x:any,keys:string[])=>object(x)&&Object.keys(x).every(k=>keys.includes(k));
const plain=(x:string)=>x.replace(/<[^>]*>/g,' ').replace(/&(?:lt|gt);/gi,' ').replace(/&amp;/gi,'&').replace(/&#(?:x[0-9a-f]+|\d+);/gi,' ').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
export const businessIndicators=['company_post','supplier_request','expansion','product_launch','operational_problem','directory_listing','event_participation','first_party_enquiry','referral'] as const;
export function discoveryHostname(value:unknown):value is string{
 return typeof value==='string'&&value.length<=253&&value===value.toLowerCase()&&value.includes('.')&&/^[a-z0-9.-]+$/.test(value)&&
 !/^\d+(?:\.\d+)*$/.test(value)&&!/(?:^|\.)(?:localhost|local|localdomain|corp|internal|test|invalid|example|onion|home|lan|arpa|localhostdomain)$/.test(value)&&
 !/(?:^|\.)(?:example\.(?:com|net|org))$/.test(value)&&value.split('.').every(s=>!!s&&s.length<=63&&!s.startsWith('-')&&!s.endsWith('-'))&&/^[a-z]{2,63}$/.test(value.split('.').at(-1)!);
}
export function discoveryUrl(value:unknown):string|null{
 if(typeof value!=='string'||value.length>1000||/[\\\u0000-\u0020\u007f#]/.test(value))return null;
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!discoveryHostname(u.hostname)||/^https:\/\/[^/]*:\d+/i.test(value))return null;return u.href.length<=1000?u.href:null;}catch{return null;}
}
export type DiscoverySource={id:string;tenantId:string;kind:'greenhouse'|'lever'|'business_feed';board?:string;company:string;companyDomain:string;industries:string[];permissionReference:string;expiresAt:string;enabled:boolean;synthetic:boolean;region?:'global'|'eu';url?:string};
export type DiscoveryParameters={industries:string[];geographies:string[];keywords:string[];excludeKeywords:string[];targetRoles:string[];lookbackDays:number};
export type Candidate={id:string;sourceId:string;company:string;companyDomain:string;sourceUrl:string;title:string;excerpt:string;location:string;indicator:string;sourceDate:string|null;deadline:string|null;dateKind:'updated'|'published'|'unknown';observedAt:string;matchedKeywords:string[];targetRoles:string[];priority:'research';contactState:'unknown';intent:'unverified';industryBasis:'operator_declared';synthetic:boolean};
export type SourceResult={sourceId:string;state:'ok'|'incomplete'|'held';count:number;excluded:number;invalid:number;filtered:number;reason:string;retryAfterSeconds?:number};
export function discoveryRegistry(env:Env):DiscoverySource[]{
 const raw=env.SIGNAL_DISCOVERY_SOURCES??'[]',hostsRaw=env.SIGNAL_DISCOVERY_FEED_HOSTS??'[]';
 if(new TextEncoder().encode(raw).length>32768||hostsRaw.length>6000)throw Error('configuration');
 const rows=JSON.parse(raw),hosts=JSON.parse(hostsRaw);
 if(!Array.isArray(rows)||rows.length>20||!Array.isArray(hosts)||hosts.length>20||hosts.some(h=>!discoveryHostname(h))||new Set(hosts).size!==hosts.length)throw Error('configuration');
 const ids=new Set(),identities=new Set(),counts=new Map<string,number>();
 for(const s of rows){
  if(!exact(s,['id','tenantId','kind','board','company','companyDomain','industries','permissionReference','expiresAt','enabled','synthetic','region','url'])||typeof s.id!=='string'||!uuid.test(s.id)||typeof s.tenantId!=='string'||!uuid.test(s.tenantId)||!['greenhouse','lever','business_feed'].includes(s.kind)||!text(s.company,240)||!discoveryHostname(s.companyDomain)||!Array.isArray(s.industries)||s.industries.length>20||s.industries.some((x:any)=>!text(x,100))||!text(s.permissionReference,240)||!validInstant(s.expiresAt)||typeof s.enabled!=='boolean'||typeof s.synthetic!=='boolean'||(s.region!==undefined&&!['global','eu'].includes(s.region)))throw Error('configuration');
  s.id=s.id.toLowerCase();s.tenantId=s.tenantId.toLowerCase();
  if(s.kind==='business_feed'){if(s.board!==undefined||!discoveryUrl(s.url)||!hosts.includes(new URL(s.url).hostname))throw Error('configuration');}
  else if(typeof s.board!=='string'||!identifier.test(s.board)||s.url!==undefined||(s.kind==='greenhouse'&&s.region==='eu'))throw Error('configuration');
  const key=JSON.stringify([s.tenantId,s.kind,s.kind==='business_feed'?'global':s.region??'global',s.kind==='business_feed'?discoveryUrl(s.url):s.board]);
  if(ids.has(s.id)||identities.has(key))throw Error('configuration');ids.add(s.id);identities.add(key);
  if(s.enabled){const count=(counts.get(s.tenantId)??0)+1;counts.set(s.tenantId,count);if(count>5)throw Error('configuration');}
 }
 return rows;
}
export function discoveryParameters(x:any):DiscoveryParameters|null{
 const names=['industries','geographies','keywords','excludeKeywords','targetRoles'];
 if(!exact(x,[...names,'lookbackDays'])||!Number.isInteger(x.lookbackDays)||x.lookbackDays<1||x.lookbackDays>90)return null;
 const result:any={lookbackDays:x.lookbackDays};
 for(const k of names){const a=x[k];if(!Array.isArray(a)||a.length>10||(['geographies','keywords','targetRoles'].includes(k)&&!a.length)||a.some(t=>!text(t,100)||(/[<>{}\[\]`$]/.test(t)||/%\w+%/.test(t))))return null;result[k]=a.map(t=>t.trim());if(new Set(result[k].map((t:string)=>t.toLowerCase())).size!==a.length)return null;}
 return result;
}
class SourceFailure extends Error{constructor(message:string,public retryAfterSeconds?:number){super(message);}}
async function fetchSource(s:DiscoverySource){
 const url=s.kind==='business_feed'?s.url!:s.kind==='greenhouse'?`https://boards-api.greenhouse.io/v1/boards/${s.board}/jobs?content=true`:`https://${s.region==='eu'?'api.eu.lever.co':'api.lever.co'}/v0/postings/${s.board}?mode=json&limit=100&skip=0`;
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const work=async()=>{
  const r=await fetch(url,{method:'GET',redirect:'error',signal:controller.signal,headers:{Accept:'application/json'}});
  if(!r.ok){const h=r.headers.get('retry-after')??'',seconds=/^\d{1,6}$/.test(h)?Number(h):Number.isFinite(Date.parse(h))?Math.ceil((Date.parse(h)-Date.now())/1000):NaN;throw new SourceFailure(`http_${r.status}`,seconds>=0&&seconds<=86400?seconds:undefined);}
  const mime=r.headers.get('content-type')??'';
  if(r.redirected||(r.url&&r.url!==url)||!/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(mime)||(/charset=/i.test(mime)&&!/charset\s*=\s*["']?utf-8(?:["']?\s*(?:;|$))/i.test(mime))||Number(r.headers.get('content-length')??0)>262144||!r.body)throw new SourceFailure('malformed_source');
  const reader=r.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  const cancel=()=>{void reader.cancel().catch(()=>{});};controller.signal.addEventListener('abort',cancel,{once:true});
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){void reader.cancel().catch(()=>{});throw new SourceFailure('source_too_large');}chunks.push(value);}}finally{controller.signal.removeEventListener('abort',cancel);reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));}catch{throw new SourceFailure('malformed_source');}
 };
 try{return await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new SourceFailure('source_timeout'));},15000);})]);}finally{if(timer)clearTimeout(timer);}
}
const phrase=(hay:string,term:string)=>{const escaped=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp((/^[\p{L}\p{N}_]/u.test(term)?'(?<![\\p{L}\\p{N}_])':'')+escaped+(/[\p{L}\p{N}_]$/u.test(term)?'(?![\\p{L}\\p{N}_])':''),'iu').test(hay);};
const sha=async(s:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(v=>v.toString(16).padStart(2,'0')).join('');
const signature=(x:any):string=>JSON.stringify(x,(_k,v)=>object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
async function processRows(rows:any[],sourceId:string,s:DiscoverySource|null,p:DiscoveryParameters,synthetic:boolean,now:number,sampleComplete:boolean,seenUrls=new Set<string>(),seenTexts=new Set<string>()){
 const result:SourceResult={sourceId,state:'ok',count:0,excluded:0,invalid:0,filtered:0,reason:'complete'};const candidates:Candidate[]=[],ids=new Map<string,string>();
 for(const row of rows){if(row&&typeof row.id==='string'||row&&typeof row.id==='number'){const id=String(row.id),sig=signature(row);if(ids.has(id)&&ids.get(id)!==sig)return {candidates:[],result:{...result,state:'held' as const,reason:'conflicting_ids'}};ids.set(id,sig);}}
 const visited=new Set<string>();
 for(const r of [...rows].sort((a,b)=>String(a?.id??'').localeCompare(String(b?.id??'')))){
  if(r&&(typeof r.id==='string'||typeof r.id==='number')){if(visited.has(String(r.id)))continue;visited.add(String(r.id));}
  let company:string,domain:string,title:string,body:string,location:string,url:string|null,date:string|null,kind:Candidate['dateKind'],indicator:string,industries:string[],id:string;
  if(!object(r)){result.invalid++;continue;}
  const business=!s||s.kind==='business_feed';
  if(business){
   if(!exact(r,['id','company','companyDomain','sourceUrl','publishedAt','title','text','location','industry','indicator','deadline'])||!text(r.id,80)||!text(r.company,240)||!discoveryHostname(r.companyDomain)||!text(r.title,240)||!(typeof r.text==='string'&&!!r.text.trim()&&r.text.length<=2000)||!text(r.location,240)||!text(r.industry,100)||!businessIndicators.includes(r.indicator)||!(r.publishedAt===null&&r.indicator==='directory_listing'||validInstant(r.publishedAt))||!(r.deadline===null||validInstant(r.deadline))||(r.indicator==='supplier_request'&&r.deadline===null)){result.invalid++;continue;}
   company=r.company;domain=r.companyDomain;title=r.title;body=r.text;location=r.location;url=discoveryUrl(r.sourceUrl);date=r.publishedAt;kind=date?'published':'unknown';indicator=r.indicator;industries=[r.industry];
  }else{
   const gh=s.kind==='greenhouse';title=gh?r.title:r.text;body=gh?r.content:r.descriptionPlain;location=gh?r.location?.name:r.categories?.location;url=discoveryUrl(gh?r.absolute_url:r.hostedUrl);date=gh?r.updated_at:null;kind=gh?'updated':'unknown';indicator='job_posting';company=s.company;domain=s.companyDomain;industries=s.industries;
   if(!identifier.test(String(r.id??''))||!text(title,240)||typeof body!=='string'||!body.trim()||body.length>200000||!text(location,240)||(gh&&!validInstant(date))){result.invalid++;continue;}
  }
  if(!url||(date!==null&&(!validInstant(date)||Date.parse(date)>now))){result.invalid++;continue;}
  title=plain(title);body=plain(body);location=plain(location);company=plain(company);
  if(!title||!body||!location||!company){result.invalid++;continue;}
  const hay=(title+' '+body).toLowerCase(),matched=p.keywords.filter(k=>phrase(hay,k));
  if((date!==null&&Date.parse(date)<now-p.lookbackDays*86400000)||(business&&r.deadline!==null&&Date.parse(r.deadline)<=now)||!matched.length||!p.geographies.some(g=>phrase(location,g))||(p.industries.length&&!p.industries.some(i=>industries.some(j=>j.toLowerCase().trim()===i.toLowerCase())))||p.excludeKeywords.some(k=>phrase(hay+' '+location+' '+company,k))){result.filtered++;continue;}
  if(business){const u=domain+'|'+url,t=domain+'|'+body.toLowerCase();if(seenUrls.has(u)||seenTexts.has(t)){result.filtered++;continue;}seenUrls.add(u);seenTexts.add(t);}
  id=sourceId+':'+(s?String(r.id):await sha(domain+'|'+url));
  candidates.push({id,sourceId,company,companyDomain:domain,sourceUrl:url,title,excerpt:body.slice(0,1200),location,indicator,sourceDate:date===null?null:new Date(date).toISOString(),deadline:business&&r.deadline!==null?new Date(r.deadline).toISOString():null,dateKind:kind,observedAt:new Date(now).toISOString(),matchedKeywords:matched,targetRoles:p.targetRoles,priority:'research',contactState:'unknown',intent:'unverified',industryBasis:'operator_declared',synthetic});
 }
 result.count=candidates.length;result.excluded=result.invalid+result.filtered;
 if(result.invalid||!sampleComplete){result.state='incomplete';result.reason=result.invalid?'invalid_evidence':'incomplete_sample';}
 return {candidates,result};
}
export async function signalDiscovery(env:Env,tenantId:string,operation:string,b:any,db:Db){
 if(!object(b)||typeof b.synthetic!=='boolean')return bad('Discovery mode must be explicit.');
 const tenant=await db.one<any>('tenants',`id=eq.${tenantId}&select=id,status`);
 if(!tenant||tenant.id!==tenantId||tenant.status!=='active')return bad('An active client is required.',403);
 const registry=env.SIGNAL_DISCOVERY_SOURCES,hosts=env.SIGNAL_DISCOVERY_FEED_HOSTS,now=Date.now();let sources:DiscoverySource[];
 try{sources=discoveryRegistry(env).filter(s=>s.tenantId===tenantId&&s.synthetic===b.synthetic&&s.enabled&&Date.parse(s.expiresAt)>now).sort((a,b)=>a.id.localeCompare(b.id));}catch{return bad('Discovery source configuration needs operator repair.',503);}
 const safety={ok:true,tenantId,synthetic:b.synthetic,contactAllowed:false,delivery:'not_sent',persisted:false};
 if(operation==='discovery-status')return json({...safety,sources:sources.map(({id,company,kind,expiresAt})=>({id,company,kind,expiresAt}))});
 const p=discoveryParameters(b.parameters);if(!p)return bad('Invalid discovery parameters.');
 let candidates:Candidate[]=[],sourceResults:SourceResult[]=[];const seenUrls=new Set<string>(),seenTexts=new Set<string>();
 if(operation==='analyse-posts'){
  if(b.reviewed!==true||!text(b.permissionReference,240)||!Array.isArray(b.posts)||b.posts.length>50)return bad('Review the permitted export and provide at most 50 business records.');
  const parsed=await processRows(b.posts,'operator-export',null,p,b.synthetic,now,true);candidates=parsed.candidates;sourceResults=[parsed.result];
 }else{
  for(const s of sources){
   try{const data=await fetchSource(s);let rows:any[],complete=true;
    if(s.kind==='greenhouse'){if(!object(data)||!Array.isArray(data.jobs)||!object(data.meta)||!Number.isInteger(data.meta.total)||data.meta.total<data.jobs.length)throw new SourceFailure('malformed_source');rows=data.jobs;complete=data.meta.total<=rows.length;}
    else if(s.kind==='lever'){if(!Array.isArray(data))throw new SourceFailure('malformed_source');rows=data;complete=rows.length<100;}
    else{if(!exact(data,['items','complete'])||!Array.isArray(data.items)||typeof data.complete!=='boolean')throw new SourceFailure('malformed_source');rows=data.items;complete=data.complete;}
    if(rows.length>100)throw new SourceFailure('source_row_limit');
    const parsed=await processRows(rows,s.id,s,p,b.synthetic,now,complete,seenUrls,seenTexts);candidates.push(...parsed.candidates);sourceResults.push(parsed.result);
   }catch(e){sourceResults.push({sourceId:s.id,state:'held',count:0,excluded:0,invalid:0,filtered:0,reason:e instanceof SourceFailure?e.message:'source_unavailable',...(e instanceof SourceFailure&&e.retryAfterSeconds!==undefined?{retryAfterSeconds:e.retryAfterSeconds}:{})});}
  }
 }
 const active=await db.one<any>('tenants',`id=eq.${tenantId}&status=eq.active&select=id,status`);
 if(!active||active.id!==tenantId||active.status!=='active'||registry!==env.SIGNAL_DISCOVERY_SOURCES||hosts!==env.SIGNAL_DISCOVERY_FEED_HOSTS||sources.some(s=>Date.parse(s.expiresAt)<=Date.now()))return bad('Discovery source changed or client paused. Run again after review.',503);
 const finalNow=Date.now();candidates=candidates.filter(c=>{if((c.deadline!==null&&Date.parse(c.deadline)<=finalNow)||(c.sourceDate!==null&&Date.parse(c.sourceDate)<finalNow-p.lookbackDays*86400000)){const r=sourceResults.find(r=>r.sourceId===c.sourceId)!;r.count--;r.filtered++;r.excluded++;return false;}return true;});
 candidates.sort((a,b)=>a.id.localeCompare(b.id));if(candidates.length>100){candidates=candidates.slice(0,100);for(const r of sourceResults){const n=candidates.filter(c=>c.sourceId===r.sourceId).length;if(n<r.count){r.state='incomplete';r.reason='candidate_limit';r.count=n;}}}
 const activity=new Map<string,{companyDomain:string;company:string;count:number;windowDays:number;sampleOnly:true}>();for(const c of candidates)if(c.indicator==='company_post'){const a=activity.get(c.companyDomain)??{companyDomain:c.companyDomain,company:c.company,count:0,windowDays:p.lookbackDays,sampleOnly:true};a.count++;activity.set(c.companyDomain,a);}
 return json({...safety,candidates,sourceResults,complete:sourceResults.length>0&&sourceResults.every(r=>r.state==='ok'),searchQueries:p.keywords.slice(0,5).map(k=>`${k} ${p.geographies[0]}`),...(operation==='analyse-posts'?{postingActivity:[...activity.values()]}:{})});
}
