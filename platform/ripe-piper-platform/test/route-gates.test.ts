import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
// Service-role reads bypass RLS, so the Worker gate is the confidentiality boundary for every tenant path.
const root=new URL('../src/',import.meta.url),read=(f:string)=>readFileSync(new URL(f,root),'utf8');
const index=read('index.ts');
const imports=new Map<string,string>();
for(const m of index.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'](\.\/[^"']+)["']/g))
 for(const name of m[1].split(',')){const [orig,alias]=name.trim().split(/\s+as\s+/);if(orig)imports.set((alias??orig).trim(),m[2]+'.ts');}
function source(name:string){
 const file=imports.get(name);if(!file)throw Error(`No import for ${name}`);
 let text=read(file),fn=name;
 const re=text.match(new RegExp(`export\\s*\\{\\s*(\\w+)\\s+as\\s+${name}\\s*\\}\\s*from\\s*'(\\.[^']+)'`));
 if(re){fn=re[1];text=readFileSync(new URL(re[2]+'.ts',new URL(file,root)),'utf8');}
 const start=text.search(new RegExp(`export async function ${fn}\\(`));if(start<0)throw Error(`No handler ${name}`);
 const next=text.slice(start+1).search(/\nexport /);return text.slice(start,next<0?undefined:start+1+next);
}
const routes=[...index.matchAll(/\["(GET|POST)",\s*\/\^(.+?)\$\/,\s*\([^)]*\)\s*=>\s*(\w+)\(/g)].map(m=>({path:m[2],handler:m[3]}));
// Platform-level stops and the go-live gate (decision: no grant), and owner-or-platform-admin access administration.
const PLATFORM=new Set(['pauseTenant','activateTenant']),OWNER_OR_PLATFORM=new Set(['inviteUser','operatorGrants','tenantMode']);

describe('tenant route gates',()=>{
 const tenantRoutes=routes.filter(r=>r.path.includes('tenants\\/([0-9a-f-]{36})'));
 it('finds the tenant routes',()=>expect(tenantRoutes.length).toBeGreaterThanOrEqual(20));
 it.each(tenantRoutes.map(r=>[r.handler,r.path]))('%s gates on tenant authority',handler=>{
  const src=source(handler);
  if(PLATFORM.has(handler))expect(src).toMatch(/requireUser\(req, env, true\)|requirePlatformAdmin\(/);
  else if(OWNER_OR_PLATFORM.has(handler))expect(src).toContain('requireOwnerOrPlatformAdmin(');
  else expect(src).toMatch(/requireTenant\(req,\s*env,\s*\w+,\s*'(read|operate|approve)'\)/);
  if(!PLATFORM.has(handler))expect(src).not.toMatch(/requireUser\(req,\s*env,\s*true\)/);
 });
 it.each(['testAction','reviewConsultation'])('%s resolves the record tenant before acting',handler=>expect(source(handler)).toContain('tenantAccess(env,'));
});
