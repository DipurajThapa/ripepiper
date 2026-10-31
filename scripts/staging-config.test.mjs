import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const staging=readFileSync(new URL('../platform/ripe-piper-platform/wrangler.staging.toml',import.meta.url),'utf8');
test('prepared isolated Worker config has no production routing or automatic work',()=>{
 assert.match(staging,/name = "ripe-piper-api-staging"/);assert.match(staging,/routes = \[\]/);assert.match(staging,/crons = \[\]/);assert.match(staging,/directory = \"\.\.\/\.\.\/\.staging-site\"/);assert.match(staging,/not_found_handling = \"none\"/);
 assert.match(staging,/SITE_URL = "https:\/\/ripe-piper-api-staging\.dipuraj-thapa\.workers\.dev"/);assert.match(staging,/PAID_AI_ENABLED = "false"/);assert.match(staging,/WHATSAPP_ENABLED = "false"/);
 assert.doesNotMatch(staging,/zone_name\s*=|ripepiper\.com|(?:SECRET|API_KEY|REFRESH_TOKEN)\s*=/);
});

test('provider jobs stay default-off in production and staging configuration',()=>{
 const production=readFileSync(new URL('../platform/ripe-piper-platform/wrangler.toml',import.meta.url),'utf8');
 for(const flag of ['MEETING_TRANSCRIPTS_ENABLED','SHEETS_SYNC_ENABLED','ADS_SYNC_ENABLED'])for(const source of [production,staging])assert.match(source,new RegExp(flag+' = "false"'));
});
test('public unsubscribe static pages use no-store and no-referrer',()=>{
 const headers=readFileSync(new URL('../site/_headers',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 for(const path of ['/unsubscribe.html','/unsubscribe'])assert.ok(headers.includes(path+'\n  Cache-Control: no-store\n  Referrer-Policy: no-referrer'));
});
