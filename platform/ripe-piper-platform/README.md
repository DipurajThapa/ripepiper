# Ripe Piper platform

The system behind RipePiper.com: lead capture, bookings with Google Meet, reminders, AI call notes and minutes, pre-proposals with a 10% advance, Stripe and Razorpay payments, the Google Sheet CRM, the blog CMS, and the multi-tenant client dashboard.

## 1. How it fits together

```
Visitor ──► RipePiper.com (Cloudflare Pages: static website, /portal, /admin)
              │  forms, booking, newsletter, opt-out
              ▼
        API Worker (Cloudflare Workers: /api/*, /webhooks/*, /p/*, /blog*)
              │                       │                       │
              ▼                       ▼                       ▼
   Supabase Postgres + Auth     Google Workspace APIs     Stripe (AED) · Razorpay (INR)
   (source of truth, RLS)       Calendar · Meet · Gmail   Claude API (notes, proposals)
              │                 Sheets (CRM copy)         Google Ads · Meta · LinkedIn
              ▼
   Google Sheet CRM tabs: Website_Leads, Meetings, Proposals, Payments
```

- **The database is the source of truth.** Every lead, meeting, proposal and payment is copied to the *B2B Outbound Engine* Google Sheet within five minutes. The existing `Sheet1` (outbound engine) is never changed.
- **Tenants:** every client company is a tenant. Row-level security in Postgres makes sure a client user receives only rows of their own tenant. Ripe Piper's own pipeline (`tenant_id = NULL`) is visible to admins only.
- **Roles:** *Admin* (Ripe Piper), *Client owner* (can update deals, accept quotations, invite viewers) and *Client viewer* (read only).

## 2. The client journey

| Step | What happens | Where |
|---|---|---|
| 1. Inquiry | Form → lead saved, scored, deduplicated, founder alerted within a minute | `POST /api/lead` |
| 2. Qualify | Personal email → ask for work email. Deals under AED 10,000 → polite "not yet". Others → free slots | same call |
| 3. Book | Slot checked against Google Calendar and existing bookings (database blocks double booking). Calendar event with a Google Meet link, invitation and confirmation email | `POST /api/book` |
| 4. Remind | Emails 24 hours and 1 hour before the call. Each reminder is sent once, even if the job overlaps | cron, every 5 min |
| 5. Notes and minutes | 20 minutes after the call, the Meet transcript is fetched and Claude writes notes, minutes and structured requirements. No transcript after 3 hours → no-show or "held without transcript" alert | cron, or admin button |
| 6. Pre-proposal | Admin creates the draft; AI writes the text, **code inserts the prices** from the published price list and calculates the 10% advance. Admin edits and sends | Admin → Proposals |
| 7. Approve and pay | Client opens the secret link, approves, pays the advance (Stripe for AED, Razorpay for INR) | `/p/<token>` |
| 8. Start | Verified webhook → proposal marked paid → client account (tenant) created → client invited as owner → fee recorded → client emailed. Webhook replays never create duplicates | `/webhooks/*` |
| 9. Customisations | Quoted after the proposal is locked. Total calculated on the server. Client owner accepts and pays in the dashboard | Admin → Proposals; Portal → Proposals and quotes |
| 10. Live dashboard | Leads, qualified leads, funnel, ideal-customer match, sources, ad spend by platform, fees, won revenue, return on investment, deals, activity timeline | `/portal/` |

**Fixed-scope price used for the 10% advance:** Revive Sprint = sprint fee; single event = event fee; monthly engine = setup fee + 3 months (the minimum term). Change `src/lib/pricing.ts` and the website prices together if prices change.

## 3. Transparency built into the client dashboard

Based on agency reporting research and our own rules:

- Every number shows the change against the previous month.
- Fees and ad spend sit next to won revenue, and return on investment uses one written formula: *(won revenue − our fees − ad spend) ÷ (our fees + ad spend)*.
- Every fee line says what it covers, including the 10% advance and each performance fee.
- The attribution model is named on the sources table. Lead source and click IDs (UTM, gclid, fbclid, li_fat_id) are kept from the first visit through to the deal.
- An activity timeline records what we changed, why, and what happens next.
- The page shows when the ad data was last updated.
- Client owners update their own deal stages and values, so revenue is not our estimate.

## 4. Setup (about half a day)

### 4.1 Supabase
1. Create a project on the **Pro plan**. Free projects pause after 7 days without activity and have no daily backups.
2. Run, in order: `supabase/migrations/0001_core.sql`, `0002_security_and_views.sql`, `0003_fx_rates.sql`, then `supabase/seed.sql` (adds the two launch articles).
3. **Authentication → Providers:** turn on *Email* (magic link) and *Google*. Add `https://ripepiper.com/portal/` and `https://ripepiper.com/admin/` as redirect URLs.
4. Sign in once at `/admin/`, then make yourself an administrator:
   `update public.profiles set is_admin = true where email = 'you@ripepiper.com';`
5. Put the project URL and the **anon** key in the website file `assets/config.js`. Never put the service role key in the website.

### 4.2 Google Workspace
1. Use a Workspace edition that includes Meet transcripts (**Business Standard or higher**). In the Admin console, turn on transcription for your organisation.
2. In Google Cloud, create a project. Enable the Calendar, Gmail, Sheets, Drive and Google Meet REST APIs. Create an OAuth client (Web).
3. Generate a refresh token for your own account with these scopes: `calendar`, `gmail.send`, `spreadsheets`, `drive.readonly`, `meetings.space.readonly` (for example with the OAuth 2.0 Playground, using your own client ID).
4. When you create a meeting, set Google Meet to transcribe automatically (*Video call options → Meeting records → Transcribe the meeting*), or switch transcription on at the start of each call. Transcripts start only when the host joins on the web.

### 4.3 Payments
- **Stripe (AED):** create a UAE account, copy the secret key, and add a webhook to `https://ripepiper.com/webhooks/stripe` for `checkout.session.completed` and `checkout.session.async_payment_failed`.
- **Razorpay (INR):** Stripe accepts new Indian businesses by invitation only, so INR payments use Razorpay. Add a webhook to `https://ripepiper.com/webhooks/razorpay` for `payment_link.paid` and `payment.failed`.

### 4.4 Ad platforms (read-only reporting)
- **Google Ads:** apply for a developer token with **Basic access** (review usually takes about five business days, or a few hours with brand verification of your Cloud project). Add client accounts under your manager (MCC) account.
- **Meta:** create a Business app with `ads_read` and a system user token; each client grants your business access to their ad account. Expect app review and business verification.
- **LinkedIn:** apply for the Advertising API (Development tier reads accounts your member can access). Each client gives your LinkedIn member a role on their ad account.
- Spend is converted into the client's currency using `fx_rates`. The USD rate is fixed by the AED peg (3.6725). **Update the INR rate monthly** in the admin database.

### 4.5 Deploy the API Worker
```bash
npm install
npx wrangler secret put SUPABASE_URL           # repeat for every secret listed in wrangler.toml
npx wrangler deploy
```
Then deploy the website folder to Cloudflare Pages on the same domain. The Worker routes (`/api/*`, `/webhooks/*`, `/p/*`, `/blog*`) take priority over the static site.

### 4.6 Optional
- **Cloudflare Turnstile** on the forms: set `TURNSTILE_SECRET` and add the widget to the forms.
- **WhatsApp reminders:** only for people who contacted you on WhatsApp first, using approved utility templates `meeting_reminder_24h` and `meeting_reminder_1h`. Set `WHATSAPP_ENABLED=true`.

## 5. Tests

```bash
npm test        # 49 tests
```
- `test/db.test.ts`: runs the real migrations on Postgres (PGlite) and proves tenant isolation, admin access, viewer vs owner rights, duplicate-lead protection, double-booking protection, the advance calculation, Sheet queueing and the ROI maths.
- `test/flow.test.ts`: runs the Worker end to end with simulated services: inquiry → slots → booking with Meet link → second booking of the same slot refused → approval → Stripe redirect → forged webhook refused → signed webhook starts the client account → replay creates nothing new → short payment does not start work → reminders sent once.
- `test/logic.test.ts`: routing, scoring, pricing, slots in GST, reminder windows, webhook signatures, AI output checks, Sheet mapping, blog safety, currency conversion.
- `test/seed.test.ts`: the launch articles load and render safely.

## 6. Known limits (verified, not assumed)

1. **Meet transcripts** need a supported Workspace edition and transcription switched on for the call. Without a transcript, paste your notes in Admin → Meetings and the AI creates the minutes from them.
2. **AI output is a draft.** You review notes and every pre-proposal before it is sent. The AI never sets prices.
3. **Ad data access needs approvals** from Google, Meta and LinkedIn, and each client must grant access to their ad account.
4. **The newsletter** collects sign-ups with double opt-in. Sending the monthly issue needs a sending tool (for example Google Workspace for small lists, or a newsletter service as the list grows).
5. **Policy to confirm:** the website currently says the Revive Sprint fee is refundable if fewer than two qualified meetings are booked. The new flow takes a 10% advance on the fixed-scope price. Decide how the refund applies to the advance and update the terms page before launch.
