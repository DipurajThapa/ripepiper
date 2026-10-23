import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const staging=readFileSync(new URL('../platform/ripe-piper-platform/wrangler.staging.toml',import.meta.url),'utf8');
test('prepared isolated Worker config has no production routing or automatic work',()=>{
 assert.match(staging,/name = "ripe-piper-api-staging"/);assert.match(staging,/routes = \[\]/);assert.match(staging,/crons = \[\]/);assert.match(staging,/directory = \"\.\.\/\.\.\/\.staging-site\"/);assert.match(staging,/not_found_handling = \"none\"/);
 assert.match(staging,/SITE_URL = "https:\/\/ripe-piper-api-staging\.dipuraj-thapa\.workers\.dev"/);assert.match(staging,/PAID_AI_ENABLED = "false"/);assert.match(staging,/WHATSAPP_ENABLED = "false"/);
 assert.doesNotMatch(staging,/zone_name\s*=|ripepiper\.com|(?:SECRET|API_KEY|REFRESH_TOKEN)\s*=/);
});
