import { createClient } from "@supabase/supabase-js";

const KEEP_LOGIN_KEY = "picklester.keep-login";

function browserStorage() {
  if (typeof window === "undefined") return undefined;
  const keep = window.localStorage.getItem(KEEP_LOGIN_KEY) !== "false";
  return keep ? window.localStorage : window.sessionStorage;
}

const authStorage = {
  getItem(key: string) {
    if (typeof window === "undefined") return null;
    return browserStorage()?.getItem(key) ?? null;
  },
  setItem(key: string, value: string) {
    browserStorage()?.setItem(key, value);
  },
  removeItem(key: string) {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  },
};

export function getKeepMeLoggedIn() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(KEEP_LOGIN_KEY) !== "false";
}

export function setKeepMeLoggedIn(keep: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEEP_LOGIN_KEY, String(keep));
  if (!keep) {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith("sb-")) window.localStorage.removeItem(key);
    }
  }
}

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
    storage: authStorage,
  },
});
