import { stagingBindings } from './staging-bindings.mjs';
import { cp, mkdir, readFile, readdir, writeFile, stat, rm, lstat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const previewConfig = { live: false, supabaseUrl: '', supabaseAnonKey: '', apiBase: '', turnstileSiteKey: '' };
export const csp = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'self'";

async function buildSitePreview(destination, configuration, policy, notice) {
  if (resolve(destination) === resolve(root, 'site')) throw new Error('Never overwrite the source site');
  await mkdir(destination, { recursive: true });
  await cp(resolve(root, 'site'), destination, { recursive: true });
  await writeFile(resolve(destination, 'assets/config.js'), `window.RP_CONFIG = ${JSON.stringify(configuration)};\n`);
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith('.html')) {
        let html = await readFile(path, 'utf8');
        html = html.replace(/<head>/i, `<head><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="${policy}">`);
        html = html.replace(/<body[^>]*>/i, `$&<aside role="status" style="padding:12px;background:#fff3c4;color:#222;text-align:center">${notice}</aside>`);
        await writeFile(path, html);
      }
    }
  }
  await walk(destination);
  await writeFile(resolve(destination, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  await writeFile(resolve(destination, '_headers'), `/*\n  X-Robots-Tag: noindex, nofollow\n  Content-Security-Policy: ${policy}; frame-ancestors 'none'\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n/assets/config.js\n  Cache-Control: no-store\n`);
  return destination;
}

export async function buildPreview(destination = resolve(root, '.preview')) {
  return buildSitePreview(destination, previewConfig, csp, 'Development preview · Sample data only · No submissions, bookings or messages are sent.');
}

// Reuse the existing website and preview builder; never alter Pages or source config.
export async function buildStagingPreview(env) {
  const bindings = stagingBindings(env);
  const destination = resolve(root, '.staging-site');
  try { if ((await lstat(destination)).isSymbolicLink()) throw Error('Staging output cannot be a symlink.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  async function rejectLinks(directory) {
    for (const entry of await readdir(directory, {withFileTypes:true})) {
      if (entry.isSymbolicLink()) throw Error('Source preview cannot contain symlinks.');
      if (entry.isDirectory()) await rejectLinks(resolve(directory, entry.name));
    }
  }
  await rejectLinks(resolve(root, 'site'));
  const configuration = {live:false, supabaseUrl:bindings.SUPABASE_URL, supabaseAnonKey:bindings.SUPABASE_ANON_KEY, apiBase:'', turnstileSiteKey:''};
  const policy = csp.replace("connect-src 'none'", "connect-src 'self' https://wgomywhuzyboxlckopca.supabase.co wss://wgomywhuzyboxlckopca.supabase.co");
  await rm(destination, {recursive:true,force:true});
  return buildSitePreview(destination, configuration, policy, 'Isolated staging · Test data only · Public lead and booking forms disabled.');
}

export function previewServer(directory) {
  const base = resolve(directory);
  return createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', csp + "; frame-ancestors 'none'");
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end('Preview is read-only'); return; }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (/^\/(api|webhooks|p)(\/|$)/.test(pathname)) { res.writeHead(403); res.end('External operations disabled'); return; }
      let path = resolve(base, '.' + pathname);
      const rel = relative(base, path);
      if (rel.startsWith('..' + sep) || rel === '..' || pathname.includes('\0')) throw new Error('Invalid path');
      let info;
      try { info = await stat(path); } catch { path += '.html'; info = await stat(path); }
      if (info.isDirectory()) path = resolve(path, 'index.html');
      const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.txt':'text/plain' };
      res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
      const bytes = await readFile(path); res.writeHead(200); res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (!['build', 'serve', 'staging'].includes(command)) throw new Error('Use: node scripts/preview.mjs build|serve|staging');
  const directory = command === 'staging' ? await buildStagingPreview(process.env) : await buildPreview();
  if (command === 'serve') previewServer(directory).listen(4173, '127.0.0.1', () => console.log('Read-only preview: http://127.0.0.1:4173'));
  else console.log((command === 'staging' ? 'Isolated staging site built at ' : 'Safe preview built at ') + directory);
}
