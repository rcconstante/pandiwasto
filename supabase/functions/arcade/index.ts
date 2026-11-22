import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { createArcadeHandler } from "./app.js";
import { createGeminiHintProvider } from "./gemini.js";

const url = Deno.env.get("SUPABASE_URL");
const secretKey: string | undefined = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default
  ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = url && secretKey
  ? createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  : null;

const allowedOrigins = (Deno.env.get("ARCADE_ALLOWED_ORIGINS") ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
const hintProvider = createGeminiHintProvider({
  key: Deno.env.get("GEMINI_API_KEY")?.trim(),
  model: Deno.env.get("GEMINI_MODEL")?.trim() || undefined,
});

Deno.serve(createArcadeHandler({ supabase, allowedOrigins, hintProvider }));
