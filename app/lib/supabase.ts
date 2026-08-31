import { createClient } from "@supabase/supabase-js";

// These are public browser credentials. Keeping a checked-in fallback prevents
// the client bundle from crashing when a hosting build does not inject
// NEXT_PUBLIC_* values.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  || "https://vqieqybctuywwcppzqor.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || "sb_publishable_JD0ItGs9SvXIWZdMns81Ig_uE8pyAC0";

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Picklester Supabase environment variables are missing.");
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
