import type { Env } from "./env";
import { Db, DbError } from "./lib/db";
import { fillShell, postPage, indexPage, type Post } from "./lib/blog";
import { postLead, getSlots, postBook, postCalculator, postNewsletter, getNewsletterConfirm, postOptOut } from "./routes/public";
import { viewProposal, approveProposal, stripeWebhook, razorpayWebhook, acceptQuote } from "./routes/proposals";
import { processMeeting, reconcileBooking, draftProposal, sendProposal, createQuote, sendQuote, inviteUser, runAdsSync } from "./routes/admin";
import { json, html, HttpError } from "./routes/http";
import { runScheduled } from "./jobs";
import { recordSubjectRequest } from "./foundation/requests";
import { prepareTenant, pauseTenant } from "./foundation/tenants";
import { testAction } from "./foundation/actions";
import { acceptInvites } from "./foundation/invites";
import { saveBrief, addProspectEvidence, prospectShortlist, recordProductEvent, importReviewLeads } from "./foundation/prospecting-routes";

import { tenantConnection } from "./foundation/connections";
import { campaignPlans } from "./foundation/campaigns";

type Handler = (req: Request, env: Env, ctx: ExecutionContext, p: string[]) => Promise<Response>;
const routes: [string, RegExp, Handler][] = [
  ["POST", /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/connection$/, (r,e,_c,p)=>tenantConnection(r,e,p[0])],
  ["POST", /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/campaigns$/, (r,e,_c,p)=>campaignPlans(r,e,p[0])],
  ["POST", /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/brief$/, (r,e,_c,p)=>saveBrief(r,e,p[0])],
  ["POST", /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/prospect-evidence$/, (r,e,_c,p)=>addProspectEvidence(r,e,p[0])],
  ["POST", /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/prospect-import$/, (r,e,_c,p)=>importReviewLeads(r,e,p[0])],
  ["POST", /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/product-event$/, (r,e,_c,p)=>recordProductEvent(r,e,p[0])],
  ["POST", /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/shortlist$/, (r,e,_c,p)=>prospectShortlist(r,e,p[0])],
  ["POST", /^\/api\/lead$/, (r, e, c) => postLead(r, e, c)],
  ["GET", /^\/api\/slots$/, (r, e) => getSlots(r, e)],
  ["POST", /^\/api\/book$/, (r, e) => postBook(r, e)],
  ["POST", /^\/api\/calculator$/, (r, e, c) => postCalculator(r, e, c)],
  ["POST", /^\/api\/newsletter$/, (r, e, c) => postNewsletter(r, e, c)],
  ["GET", /^\/api\/newsletter\/confirm$/, (r, e) => getNewsletterConfirm(r, e)],
  ["POST", /^\/api\/opt-out$/, (r, e) => postOptOut(r, e)],
  ["GET", /^\/p\/([0-9a-f-]{36})$/, (_r, e, _c, p) => viewProposal(p[0], e)],
  ["POST", /^\/p\/([0-9a-f-]{36})\/approve$/, (_r, e, _c, p) => approveProposal(p[0], e)],
  ["POST", /^\/webhooks\/stripe$/, (r, e) => stripeWebhook(r, e)],
  ["POST", /^\/webhooks\/razorpay$/, (r, e) => razorpayWebhook(r, e)],
  ["POST", /^\/api\/portal\/quotes\/([0-9a-f-]{36})\/accept$/, (r, e, _c, p) => acceptQuote(r, e, p[0])],
  ["POST", /^\/api\/admin\/meetings\/([0-9a-f-]{36})\/reconcile$/, (r, e, _c, p) => reconcileBooking(r, e, p[0])],
  ["POST", /^\/api\/admin\/meetings\/([0-9a-f-]{36})\/process$/, (r, e, _c, p) => processMeeting(r, e, p[0])],
  ["POST", /^\/api\/admin\/meetings\/([0-9a-f-]{36})\/draft-proposal$/, (r, e, _c, p) => draftProposal(r, e, p[0])],
  ["POST", /^\/api\/admin\/proposals\/([0-9a-f-]{36})\/send$/, (r, e, _c, p) => sendProposal(r, e, p[0])],
  ["POST", /^\/api\/admin\/quotes$/, (r, e) => createQuote(r, e)],
  ["POST", /^\/api\/admin\/quotes\/([0-9a-f-]{36})\/send$/, (r, e, _c, p) => sendQuote(r, e, p[0])],
  ["POST", /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/invite$/, (r, e, _c, p) => inviteUser(r, e, p[0])],
  ["POST", /^\/api\/portal\/accept-invites$/, (r, e) => acceptInvites(r, e)],
  ["POST", /^\/api\/admin\/ads\/sync$/, (r, e) => runAdsSync(r, e)],
  ["POST", /^\/api\/admin\/subject-requests$/, (r, e) => recordSubjectRequest(r, e)],
  ["POST", /^\/api\/admin\/tenants$/, (r, e) => prepareTenant(r, e)],
  ["POST", /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/pause$/, (r, e, _c, p) => pauseTenant(r, e, p[0])],
  ["POST", /^\/api\/admin\/actions\/([0-9a-f-]{36})\/test$/, (r, e, _c, p) => testAction(r, e, p[0])],
  ["GET", /^\/blog\/?$/, (_r, e) => blogIndex(e)],
  ["GET", /^\/blog\/([a-z0-9-]{3,90})\/?$/, (_r, e, _c, p) => blogPost(e, p[0])],
];

let shellCache: { html: string; at: number } | null = null;
async function shell(env: Env): Promise<string> {
  if (shellCache && Date.now() - shellCache.at < 10 * 60_000) return shellCache.html;
  const res = await fetch(`${env.SITE_URL}/blog-shell.html`, { cf: { cacheTtl: 600 } } as RequestInit);
  if (!res.ok) throw new Error("The blog page template is missing. Deploy the website with blog-shell.html.");
  shellCache = { html: await res.text(), at: Date.now() };
  return shellCache.html;
}

async function blogIndex(env: Env) {
  const posts = await new Db(env).select<Post>("posts", "status=eq.published&order=published_at.desc&select=slug,title,description,body_md,cover_path,cover_alt,author_name,published_at,updated_at");
  return html(fillShell(await shell(env), indexPage(env.SITE_URL, posts)), 200, "public, max-age=300");
}

async function blogPost(env: Env, slug: string) {
  const post = await new Db(env).one<Post>("posts", `slug=eq.${slug}&status=eq.published&select=*`);
  if (!post) return html("<h1>Article not found</h1>", 404);
  return html(fillShell(await shell(env), postPage(env.SITE_URL, post)), 200, "public, max-age=300");
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    for (const [method, re, h] of routes) {
      const m = url.pathname.match(re);
      if (m && req.method === method) {
        try { return await h(req, env, ctx, m.slice(1)); }
        catch (e) {
          if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
          console.error("request_failed", { route: re.source, status: e instanceof DbError ? e.status : 500 });
          return json({ ok: false, error: "Something went wrong on our side. Please try again, or email hello@ripepiper.com." }, 500);
        }
      }
    }
    return json({ ok: false, error: "Not found." }, 404);
  },
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(event.cron, env).then(r => console.log(JSON.stringify(r))));
  },
};
