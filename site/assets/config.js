/* Public configuration for the signed-in areas. Fill these in after creating the Supabase project.
   The anon key is safe to publish: row-level security decides what each user can read.
   Leave supabaseUrl empty to run the dashboard and admin with sample data. */
window.RP_CONFIG = {
  supabaseUrl: "",       // e.g. "https://abcd1234.supabase.co"
  supabaseAnonKey: "",
  live: false, // Set true only after the API, Supabase and security checks are configured
  apiBase: "",           // Same-origin Worker routes; set explicitly for a different API origin
  turnstileSiteKey: ""   // Public Cloudflare Turnstile site key; required for live public forms
};
