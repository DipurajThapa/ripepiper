/** Every secret and setting the Worker needs. Set secrets with `wrangler secret put NAME`. */
export interface Env {
  // Supabase
  SUPABASE_URL: string;               // https://<project>.supabase.co
  SUPABASE_SERVICE_ROLE_KEY: string;  // server only; never sent to a browser
  SUPABASE_ANON_KEY: string;          // public key used by the portal and admin pages

  // Google (one OAuth client; refresh token of the founder's Workspace account)
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REFRESH_TOKEN: string;       // scopes: calendar, gmail.send, spreadsheets, meetings.space.readonly, drive.readonly
  GOOGLE_CALENDAR_ID: string;         // usually "primary"
  CRM_SHEET_ID: string;               // the B2B Outbound Engine spreadsheet
  MAIL_FROM: string;                  // e.g. "Ripe Piper <hello@ripepiper.com>"
  ADMIN_ALERT_EMAIL: string;

  GOOGLE_TENANT_CONNECTIONS?: string; // server-secret JSON; explicit read-only pilot bindings, never exposed to browser

  // AI
  ANTHROPIC_API_KEY: string;
  AI_MODEL: string;                   // e.g. "claude-sonnet-5-5"

  // Payments
  STRIPE_SECRET_KEY: string;          // AED clients
  STRIPE_WEBHOOK_SECRET: string;
  RAZORPAY_KEY_ID: string;            // INR clients
  RAZORPAY_KEY_SECRET: string;
  RAZORPAY_WEBHOOK_SECRET: string;

  // Ads (read-only reporting)
  GOOGLE_ADS_DEVELOPER_TOKEN: string;
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: string;  // manager (MCC) account id, digits only
  META_ACCESS_TOKEN: string;             // system user token with ads_read
  LINKEDIN_ACCESS_TOKEN: string;         // r_ads, r_ads_reporting

  // WhatsApp Cloud API (optional reminders to people who opted in)
  WHATSAPP_ENABLED?: string;          // "true" to enable
  WHATSAPP_TOKEN?: string;
  WHATSAPP_PHONE_ID?: string;

  TURNSTILE_SECRET?: string;
  SYNTHETIC_SINK_ENABLED?: string;    // explicit development-only action test; never real delivery
  SITE_URL: string;                   // https://ripepiper.com
}
