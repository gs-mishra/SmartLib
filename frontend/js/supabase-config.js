// Existing Supabase project configuration for the legacy frontend.
// The anon/publishable key is intended for browser use; protect data with RLS policies.
const supabaseConfig = {
  url: "https://ksarwkaseogpljtcjusq.supabase.co",
  anonKey: "sb_publishable_eFD7Vdl0yfidyDHWRvZyPg_FTh7XeCO",
};
const isSupabaseConfigured = () =>
  Boolean(supabaseConfig.url && supabaseConfig.anonKey);
window.supabaseConfig = supabaseConfig;
window.isSupabaseConfigured = isSupabaseConfigured;
