# Ripe Piper pilot: owner setup guide

Every step below is something only the owner can do, because it involves your accounts or passwords. Never paste a key, secret or password into chat. Put each one in your password manager first, then paste it only into the screen named in the step.

Pilot decisions (31 October 2026): send from `dipuraj.thapa@gmail.com`, at most 2 new contacts a day for 7 days. The owner reviews the first four notes before they go out. Everything runs on the isolated test server (staging), never on production.

## A. The three test-server keys (GitHub)

These let the automated deploy put the Ripe Piper server on the test server. Add each one in GitHub at **DipurajThapa/ripepiper > Settings > Secrets and variables > Actions > New repository secret**. The name must match exactly.

| Secret name | Where to get the value |
|---|---|
| `RIPEPIPER_STAGING_CLOUDFLARE_API_TOKEN` | Cloudflare dashboard > your profile icon > **My Profile > API Tokens > Create Token**. Use the **Edit Cloudflare Workers** template, limit it to your account, then create it. Cloudflare shows the token once. |
| `RIPEPIPER_STAGING_SERVICE_ROLE_KEY` | Supabase dashboard > the **staging** project (reference `wgomywhuzyboxlckopca`) > **Project Settings > API Keys > Legacy API Keys** tab > `service_role` key. It is a long value starting `eyJ`. |
| `RIPEPIPER_STAGING_ANON_KEY` | Same screen > `anon` / `public` key, also starting `eyJ`. |

Use the legacy `eyJ...` keys, not the newer `sb_publishable_` / `sb_secret_` keys. The deploy check reads the project reference and role from inside the key, and only the legacy keys carry them. Supabase says legacy keys are being retired in late 2026, so this check will need updating before then. Never use the production project's keys.

## B. The eleven database changes (approved for the test server)

You approved applying them to the test server on 31 October 2026. Applying them needs a Supabase sign-in, which only you can do:

1. In the app's terminal, run `npx supabase login` and approve the browser window that opens.
2. Tell me when that's done. I'll link the staging project, list which changes it already has, and apply only the missing ones. When the terminal asks for the **database password**, type it there. It's in Supabase > staging project > **Project Settings > Database** (reset it there if you don't have it).

I stop if the list shows anything other than the first 35 changes already applied.

## C. The encryption key for mailbox connections

This key locks the stored mailbox sign-ins. If you lose it, every connected mailbox has to reconnect.

1. Open **PowerShell** (Start menu, type PowerShell) and paste:
   ```
   $b=[byte[]]::new(32); [System.Security.Cryptography.RandomNumberGenerator]::Fill($b); [Convert]::ToBase64String($b)
   ```
   It prints one line of about 44 characters ending in `=`. That's the key.
2. Save it in your password manager as **Ripe Piper connection key k1 (staging)**.
3. After the first test-server deploy (step E), open Cloudflare dashboard > **Workers & Pages > ripe-piper-api-staging > Settings > Variables and Secrets > Add**, choose type **Secret**, and add two entries:
   - Name `CONNECTION_KEYS`, value `{"k1":"PASTE-THE-KEY-HERE"}` (keep the quotes and braces).
   - Name `CONNECTION_KEY_CURRENT`, value `k1`.

Secrets survive later deploys. Plain variables set in the dashboard do not, so mailbox sign-in is already switched on in the repository's staging settings (`OAUTH_ENABLED = "true"`).

## D. The Google sign-in app (for `dipuraj.thapa@gmail.com`)

1. Go to console.cloud.google.com, sign in as `dipuraj.thapa@gmail.com`, and create a project named **Ripe Piper**.
2. **APIs & Services > Library**: enable **Gmail API** and **Google Calendar API**.
3. **Google Auth Platform** (also labelled "OAuth consent screen"):
   - **Branding:** app name Ripe Piper, support email `dipuraj.thapa@gmail.com`.
   - **Audience:** user type **External**, leave it in **Testing**, and add `dipuraj.thapa@gmail.com` under **Test users**.
   - **Data Access:** add the scopes `.../auth/gmail.send`, `.../auth/calendar.events`, `.../auth/calendar.freebusy` and `.../auth/gmail.readonly` (read is for spotting replies, section F).
   - **Clients > Create client:** type **Web application**. Under **Authorised redirect URIs** add exactly `https://ripe-piper-api-staging.dipuraj-thapa.workers.dev/api/oauth/google/callback`.
4. Copy the **Client ID** and **Client secret** into your password manager. Google may show the secret only once.
5. In Cloudflare (same screen as C3), add two secrets: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

While the app stays in **Testing**, Google lets your own test account use every scope above without verification, including the read scope. Google also expires the sign-in after 7 days in Testing mode, so for a 7-day pilot expect to reconnect once from the portal's Connect button. Google verification is only needed later, before other companies connect their mailboxes.

## E. First test-server deploy

After A is done, tell me and I'll start the deploy from a fresh branch (the procedure is in DEVELOPMENT.md, "Staging deploy"). Then do C3 and D5, and connect the mailbox from the client portal on the test server.

## F. Your mailbox

`dipuraj.thapa@gmail.com` is a personal Gmail address. Google already handles its sender authentication (the email-security records called SPF, DKIM and DMARC), so you have no DNS to change. What I still need from you:

- **A postal address for the email footer.** Every outreach email carries one, and the sending code refuses to send without it. A Ripe Piper business address in Dubai is the usual choice.

At 2 new contacts a day you are far below Gmail's limits. Replies land in your normal inbox. Once the read scope is connected, the platform can also spot them and stop any further follow-ups.
