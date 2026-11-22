import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const supabaseClient = url && key?.startsWith("sb_publishable_")
  ? createClient(url, key, { auth: { flowType: "pkce" } })
  : null;

export const authClient = supabaseClient?.auth ?? null;
