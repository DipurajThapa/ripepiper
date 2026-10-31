import {vi} from 'vitest';
import {Db} from '../../src/lib/db';

/** Spies Db.rpc: the requireTenant gate (tenant_access) answers `allow`, every other RPC goes to the returned mock, so call assertions stay about the route's own RPCs. */
export function gateRpc(allow:(args:{p_tenant:string;p_actor:string;p_capability:string})=>boolean=()=>true){
 const rpc=vi.fn<(name:string,args?:any)=>Promise<any>>();
 vi.spyOn(Db.prototype,'rpc').mockImplementation((async(name:string,args:any)=>name==='tenant_access'?allow(args):rpc(name,args)) as any);
 return rpc;
}
