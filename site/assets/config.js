/* Public configuration for the signed-in areas. Fill these in after creating the Supabase project.
   The anon key is safe to publish: row-level security decides what each user can read.
   Leave supabaseUrl empty to run the dashboard and admin with sample data. */
window.RP_CONFIG = {
  supabaseUrl: "",       // e.g. "https://abcd1234.supabase.co"
  supabaseAnonKey: "",
  live: false, // Set true only after the API, Supabase and security checks are configured
  apiBase: "",           // Must stay same-origin ("" = Worker routes on this host); the API sends no CORS headers
  turnstileSiteKey: "",  // Public Cloudflare Turnstile site key; required for live public forms
  whatsappNumber: "",    // E.164 digits without + (e.g. "9715XXXXXXXX"); empty hides every WhatsApp contact link
  whatsappReminders: false // Show the booking-form WhatsApp reminder opt-in; enable with the Worker WHATSAPP_ENABLED flag
};
