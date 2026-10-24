import {reviewedBookingUrl} from './revive-draft';

export type ReviveStrategyInput={setupVersion:number;canonicalNeed:string;segment:string;relationshipRationale:string;valueProposition:string;evidenceReference:string;
 cta:{kind:'reply';prompt:string}|{kind:'booking';url:string;reference:string;reviewed:true};goal:'qualified_conversation'|'meeting_held';confirmed:true};
const fields=['setupVersion','canonicalNeed','segment','relationshipRationale','valueProposition','evidenceReference','cta','goal','confirmed'];
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=max&&!/[\u0000-\u001f\u007f<>`{}\[\]]|\$\{|<%|%>|%\w+%/.test(v);
/** Shape only. PostgreSQL binds the setup, owner, sources and audience atomically. */
export function reviveStrategyError(value:any):string|null {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!fields.includes(k))||!Number.isInteger(value.setupVersion)||value.setupVersion<1||value.setupVersion>999999999||value.confirmed!==true
  ||!text(value.canonicalNeed,100)||!text(value.segment,160)||!text(value.relationshipRationale,1000)||!text(value.valueProposition,500)||!text(value.evidenceReference,240)||!['qualified_conversation','meeting_held'].includes(value.goal))return 'Review the current setup version, canonical need, segment, relationship rationale, value, evidence reference and goal.';
 const c=value.cta;
 if(!c||typeof c!=='object'||Array.isArray(c))return 'Choose one reviewed reply or booking call to action.';
 if(c.kind==='reply'&&Object.keys(c).every(k=>['kind','prompt'].includes(k))&&text(c.prompt,240))return null;
 if(c.kind==='booking'&&Object.keys(c).every(k=>['kind','url','reference','reviewed'].includes(k))&&c.reviewed===true&&text(c.reference,80)&&reviewedBookingUrl(c.url))return null;
 return 'Choose one reply prompt or a reviewed public HTTPS booking URL with its source reference. Booking ownership and availability remain unverified.';
}
