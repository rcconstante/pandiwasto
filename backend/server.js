import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { createApp } from "./app.js";
import { createGeminiHintProvider } from "./gemini.js";

const PORT = process.env.PORT || 3001;

function isServiceRoleKey(key) {
  if (!key) return false;
  if (key.startsWith("sb_secret_")) return true;
  try {
    const segments = key.split(".");
    return segments.length === 3 && JSON.parse(Buffer.from(segments[1], "base64url").toString()).role === "service_role";
  } catch {
    return false;
  }
}

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const legacyKey = process.env.SUPABASE_KEY?.trim();
const privilegedKey = [serviceKey, legacyKey].find(isServiceRoleKey);
const db = supabaseUrl && privilegedKey
  ? createClient(supabaseUrl, privilegedKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  : null;

const app = createApp({
  supabase: db,
  clientOrigin: new URL(process.env.CLIENT_URL || "http://localhost:5173").origin,
  hintProvider: createGeminiHintProvider({ key: process.env.GEMINI_API_KEY?.trim(), model: process.env.GEMINI_MODEL?.trim() || undefined }),
});

app.listen(PORT, () => {
  console.log("Backend running on http://localhost:" + PORT);
});
