import { z } from "npm:zod@4.6.7";
import { mountAdminAccounts } from "./adminAccounts.js";
import { mountAdminResearch } from "./adminResearch.js";
import { createHintResolver, hintLadder, masteryBand } from "./hints.js";
import { mountRankedRoutes } from "./ranked-routes.js";
import { mountTeacherRoutes } from "./teacher.js";

const uuid = z.uuid();
const positiveCount = z.number().int().nonnegative();
const promptWord = z.string().regex(/^[A-Z]{1,32}$/);
const expectedRound = z.number().int().min(0).max(4);
const runParams = z.strictObject({ runId: uuid });
const startBody = z.strictObject({ requestId: uuid });
const answerBody = z.strictObject({
  answerId: uuid,
  expectedRound,
  response: z.string().regex(/^[A-Z]{0,32}$/),
});
const hintBody = z.strictObject({ expectedRound, level: z.number().int().min(1).max(3), auto: z.boolean().optional() });
const tapBody = z.strictObject({
  tapId: uuid,
  expectedRound,
  removed: z.array(z.number().int().min(0).max(11)).min(1).max(12),
});
const endBody = z.strictObject({});
const moderationBody = z.strictObject({
  gameId: z.number().int().min(1).max(7),
  targetAccountId: uuid,
  hidden: z.boolean(),
  reason: z.string().trim().min(1).max(300),
});
const progress = z.object({
  xp: positiveCount,
  bestScores: z.record(z.string().regex(/^[1-7]$/), positiveCount),
  developer: z.object({ available: z.boolean(), enabled: z.boolean() }).optional(),
});
const snapshot = z.object({
  runId: uuid,
  status: z.enum(["active", "completed", "abandoned"]),
  round: z.number().int().min(0).max(5),
  totalRounds: z.literal(5),
  hearts: z.number().int().min(0).max(3),
  score: positiveCount.max(500),
  xp: positiveCount.max(100),
  word: promptWord.nullish(),
  hintUsed: z.boolean(),
  hintLevel: z.number().int().min(0).max(3),
  hadMiss: z.boolean(),
  studyActive: z.boolean().optional(),
  hintAllowed: z.boolean().optional(),
});
const answerSnapshot = snapshot.extend({
  correct: z.boolean(),
  root: promptWord.nullish(),
  points: positiveCount.max(100),
  roundWord: promptWord,
  roundHearts: z.number().int().min(0).max(3).optional(),
});
const popHint = z.object({
  level: z.number().int().min(1).max(3), fresh: z.boolean(), text: z.string().min(1).max(300),
  word: promptWord, root: promptWord, skill: z.string().min(1).max(80),
});
const mastery = z.object({
  skills: z.array(z.object({
    skillId: z.string().min(1).max(80), mastery: z.number().min(0).max(1), attempts: positiveCount, mastered: z.boolean(),
  })),
});
const roles = z.object({ admin: z.boolean(), teacher: z.boolean() });
const adminStatus = z.object({
  players: positiveCount, completedRuns: positiveCount, publishedScores: positiveCount, hints: positiveCount.optional(), aiHints: positiveCount.optional(),
});
const moderation = z.object({ hidden: z.boolean() });

const PUBLIC_RPC_ERRORS = new Map([
  ["PT400", [400, "Invalid arcade request."]],
  ["PT403", [403, "You do not have access to this action."]],
  ["PT404", [404, "The requested arcade record could not be found."]],
  ["PT409", [409, "The game state has changed. Reload the run before trying again."]],
  ["PT503", [503, "Arcade storage is unavailable. Check database setup."]],
  ["PGRST202", [503, "Arcade storage is unavailable. Check database setup."]],
]);

const MAX_BODY_BYTES = 8 * 1024;

class ArcadeError extends Error {
  constructor(status, message, headers) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

async function readJson(request) {
  const contentType = request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new ArcadeError(415, "Send the request as JSON.");
  if (!request.body) throw new ArcadeError(400, "Invalid arcade request.");

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        throw new ArcadeError(413, "Arcade request is too large.");
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    if (error instanceof ArcadeError) throw error;
    throw new ArcadeError(400, "Invalid arcade request.");
  } finally {
    reader.releaseLock();
  }
}

function accountRateLimiter() {
  const windows = new Map();
  const minute = 60_000;
  let nextSweep = 0;

  return (playerId) => {
    const now = Date.now();
    if (now >= nextSweep) {
      for (const [id, window] of windows) {
        if (window.until <= now) windows.delete(id);
      }
      nextSweep = now + minute;
    }

    let window = windows.get(playerId);
    if (!window || window.until <= now) {
      if (!window && windows.size >= 10_000) {
        throw new ArcadeError(429, "Arcade is busy. Try again shortly.", { "Retry-After": "60" });
      }
      window = { count: 0, until: now + minute };
      windows.set(playerId, window);
    }
    if (window.count >= 180) {
      throw new ArcadeError(429, "Too many arcade requests. Try again shortly.", {
        "Retry-After": String(Math.ceil((window.until - now) / 1000)),
      });
    }
    window.count += 1;
  };
}

// A page load sends several requests with the same token. Remembering a verified token briefly
// skips repeated Auth round trips; a suspension still applies within this window.
function verifiedUserCache({ ttlMs = 20_000, limit = 2_000, now = Date.now } = {}) {
  const entries = new Map();
  return {
    get(token) {
      const entry = entries.get(token);
      if (entry && entry.until > now()) return entry.user;
      entries.delete(token);
      return undefined;
    },
    set(token, user) {
      if (entries.size >= limit) entries.delete(entries.keys().next().value);
      entries.set(token, { user, until: now() + ttlMs });
    },
    // shortcut: forgets only this instance's copy; another running instance keeps it for up to ttlMs.
    forget(userId) {
      for (const [token, entry] of entries) if (entry.user.id === userId) entries.delete(token);
    },
  };
}

/**
 * @param {{
 *   supabase?: import("npm:@supabase/supabase-js@2.119.0").SupabaseClient | null,
 *   allowedOrigins?: string[],
 *   hintProvider?: ReturnType<typeof import("./gemini.js").createGeminiHintProvider>,
 *   logError?: typeof console.error,
 * }} [options]
 */
export function createArcadeHandler({
  supabase = null,
  allowedOrigins = [],
  hintProvider,
  logError = console.error,
} = {}) {
  const routes = [];
  const register = (method, path, handler) => routes.push({
    method, pattern: new URLPattern({ pathname: "/arcade" + path }), handler,
  });
  const arcade = {
    get: (path, handler) => register("GET", path, handler),
    post: (path, handler) => register("POST", path, handler),
  };
  const checkRateLimit = accountRateLimiter();
  const verifiedUsers = verifiedUserCache();

  async function handleRequest(request) {
    const origin = request.headers.get("Origin");
    const headers = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Vary": "Origin",
    });
    const json = (value, status = 200, extraHeaders) => {
      const responseHeaders = new Headers(headers);
      for (const [name, value] of Object.entries(extraHeaders ?? {})) responseHeaders.set(name, value);
      return Response.json(value, { status, headers: responseHeaders });
    };

    if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) {
      return json({ error: "Origin is not allowed." }, 403);
    }
    headers.set("Access-Control-Allow-Origin", allowedOrigins.length ? origin ?? allowedOrigins[0] : "*");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info");
    headers.set("Access-Control-Expose-Headers", "Retry-After");

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/arcade/health") return json({ status: "ok" });

    try {
      for (const { method, pattern, handler } of routes) {
        if (method !== request.method) continue;
        const match = pattern.exec(url.href);
        if (!match) continue;

        if (!supabase) throw new ArcadeError(503, "Arcade storage is unavailable. Check database setup.");
        const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(request.headers.get("Authorization") ?? "")?.[1];
        if (!token || token.length > 12_000) throw new ArcadeError(401, "Sign in to use the arcade.");

        const data = { user: verifiedUsers.get(token) };
        if (!data.user) {
          const { data: verified, error } = await supabase.auth.getUser(token);
          if (error && (!error.status || error.status >= 500 || error.status === 429)) {
            throw new ArcadeError(503, "Sign-in verification is unavailable. Try again shortly.");
          }
          if (error || !uuid.safeParse(verified?.user?.id).success) {
            throw new ArcadeError(401, "Your sign-in session has expired.");
          }
          if (verified.user.is_anonymous || !verified.user.email_confirmed_at) {
            throw new ArcadeError(403, "Confirm your email to use the arcade.");
          }
          // Suspension blocks new sign-ins at Auth; this also stops tokens issued before it.
          if (verified.user.banned_until && Date.parse(verified.user.banned_until) > Date.now()) {
            throw new ArcadeError(403, "This account is suspended.");
          }
          data.user = verified.user;
          verifiedUsers.set(token, verified.user);
        }

        checkRateLimit(data.user.id);
        const params = Object.fromEntries(Object.entries(match.pathname.groups).map(([key, value]) => [key, decodeURIComponent(value)]));
        const body = method === "POST" ? await readJson(request) : undefined;
        const rpc = async (name, args) => {
          const { data: result, error: rpcError } = await supabase.rpc(name, { ...args, account_id: data.user.id });
          if (!rpcError) return result;
          const publicError = PUBLIC_RPC_ERRORS.get(rpcError.code);
          if (publicError) throw new ArcadeError(...publicError);
          logError("Arcade data request failed", { operation: name, code: rpcError.code });
          throw new ArcadeError(503, "Arcade storage is unavailable. Try again shortly.");
        };

        return await handler({ params, body, rpc, json, accountId: data.user.id, authAdmin: supabase.auth.admin });
      }
      return json({ error: "API route not found." }, 404);
    } catch (error) {
      if (error instanceof ArcadeError) return json({ error: error.message }, error.status, error.headers);
      if (error instanceof URIError) return json({ error: "Invalid arcade request." }, 400);
      logError("Arcade request failed", { type: error.name });
      return json({ error: "The arcade request could not be completed." }, 500);
    }
  }

  function route({ name, params, body, args, response, transform }) {
    return async ({ params: routeParams, body: input, rpc, json }) => {
      const parsedParams = params?.safeParse(routeParams);
      const parsedBody = body?.safeParse(input);
      if (parsedParams?.error || parsedBody?.error) throw new ArcadeError(400, "Invalid arcade request.");

      const data = await rpc(name, args?.(parsedParams?.data, parsedBody?.data));
      const result = response.safeParse(data);
      if (!result.success) {
        logError("Unexpected arcade response", { operation: name });
        throw new ArcadeError(503, "Arcade storage returned an unexpected response.");
      }
      return json(transform ? await transform(result.data) : result.data);
    };
  }

  const resolveHint = createHintResolver(hintProvider);
  // The hint is already shown; a failed research log must not break play. Returns the hint id for ratings.
  async function logHint(rpc, { runId, skillId, itemIndex, level, text, source, model, latencyMs, cacheHit, trigger, promptVersion, inputTokens, outputTokens }) {
    try {
      const logged = await rpc("pandiwasto_hint_log", {
        active_run: runId, skill: skillId, item_index: itemIndex, hint_level: level, hint_text: text,
        hint_source: source, model_name: model, latency_ms: Math.round(latencyMs), cache_hit: cacheHit,
        hint_trigger: trigger, prompt_version: promptVersion ?? null, input_tokens: inputTokens ?? null, output_tokens: outputTokens ?? null,
      });
      return typeof logged?.hintId === "number" ? logged.hintId : undefined;
    } catch {
      logError("Hint log failed", { runId });
      return undefined;
    }
  }
  // The learner's mastery band, sent to the hint model. Skipped when no model is configured.
  async function hintBand(rpc, skillId) {
    if (!resolveHint.usesProvider) return undefined;
    try {
      return masteryBand((await rpc("pandiwasto_hint_mastery", { skill: skillId }))?.mastery);
    } catch {
      return undefined;
    }
  }

  mountRankedRoutes(arcade, { ArcadeError, logError, resolveHint, logHint, hintBand });
  arcade.post("/hints/rate", route({
    name: "pandiwasto_hint_rate",
    body: z.strictObject({ runId: uuid, hintId: z.number().int().positive(), helpful: z.boolean() }),
    args: (_params, input) => ({ active_run: input.runId, hint_id: input.hintId, helpful: input.helpful }),
    response: z.object({ helpful: z.boolean() }),
  }));
  const surveyResponses = z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.number().int().min(1).max(5));
  arcade.get("/survey/status", route({ name: "pandiwasto_survey_status", response: z.object({ submitted: z.boolean() }) }));
  arcade.post("/survey/submit", route({
    name: "pandiwasto_survey_submit",
    body: z.strictObject({ responses: surveyResponses.refine((value) => Object.keys(value).length > 0 && Object.keys(value).length <= 20), comment: z.string().trim().max(1000).optional() }),
    args: (_params, input) => ({ responses: input.responses, comment: input.comment ?? null }),
    response: z.object({ submitted: z.literal(true) }),
  }));
  mountAdminResearch(arcade, route);
  mountAdminAccounts(arcade, { ArcadeError, route, forgetUser: (userId) => verifiedUsers.forget(userId) });
  mountTeacherRoutes(arcade, route);
  arcade.get("/roles", route({ name: "pandiwasto_roles", response: roles }));
  // Admin check of the hint provider with a fixed sample item: no learner data is sent.
  arcade.post("/admin/hints/check", async ({ rpc, json }) => {
    const access = roles.safeParse(await rpc("pandiwasto_roles"));
    if (!access.success || !access.data.admin) throw new ArcadeError(403, "You do not have access to this action.");
    if (!hintProvider) return json({ configured: false, ok: false, error: "GEMINI_API_KEY is not set for the arcade function." });
    const started = Date.now();
    try {
      const text = await hintProvider({
        word: "SUMAKAY", rule: "May gitlapi sa loob. Tingnan ang mga titik pagkatapos ng unang titik.",
        fact: "May gitlapi sa loob. Tingnan ang mga titik pagkatapos ng unang titik.", level: 1, wrong: [], signal: AbortSignal.timeout(8_000),
      });
      const reply = typeof text === "string" ? { text } : text;
      return json({ configured: true, ok: true, model: hintProvider.model ?? null, text: reply?.text, latencyMs: Date.now() - started });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const available = message.includes("404") ? await hintProvider.listModels?.().catch(() => undefined) : undefined;
      return json({ configured: true, ok: false, model: hintProvider.model ?? null, error: message, latencyMs: Date.now() - started, available });
    }
  });
  arcade.get("/progress", route({ name: "pandiwasto_arcade_progress", response: progress }));
  arcade.post("/developer/mode", route({
    name: "pandiwasto_developer_mode",
    body: z.strictObject({ enabled: z.boolean() }),
    args: (_params, input) => ({ enable_testing: input.enabled }),
    response: progress,
  }));
  arcade.post("/developer/reset", route({
    name: "pandiwasto_developer_reset",
    body: z.strictObject({ scope: z.enum(["xp", "gameplay"]), requestId: uuid }),
    args: (_params, input) => ({ reset_scope: input.scope, reset_id: input.requestId }),
    response: progress,
  }));
  arcade.get("/mastery", route({ name: "pandiwasto_arcade_mastery", response: mastery }));
  arcade.get("/admin/status", route({ name: "pandiwasto_arcade_admin_status", response: adminStatus }));
  arcade.post("/admin/scores/moderate", route({
    name: "pandiwasto_arcade_moderate_score", body: moderationBody, response: moderation,
    args: (_params, input) => ({ game: input.gameId, target_account_id: input.targetAccountId, hidden: input.hidden, reason: input.reason }),
  }));
  arcade.post("/pop/start", route({
    name: "pandiwasto_pop_start", body: startBody, response: snapshot,
    args: (_params, input) => ({ request_id: input.requestId }),
  }));
  arcade.post("/pop/:runId/answer", route({
    name: "pandiwasto_pop_answer", params: runParams, body: answerBody, response: answerSnapshot,
    args: ({ runId }, input) => ({ active_run: runId, answer_id: input.answerId, expected_round: input.expectedRound, response: input.response }),
    transform: ({ root, ...state }) => state.correct || state.status === "completed" ? { ...state, root } : state,
  }));
  arcade.post("/pop/:runId/tap", route({
    name: "pandiwasto_pop_tap", params: runParams, body: tapBody,
    response: z.discriminatedUnion("outcome", [
      snapshot.extend({ outcome: z.literal("continue") }),
      answerSnapshot.extend({ outcome: z.literal("miss") }),
      answerSnapshot.extend({ outcome: z.literal("solved"), root: promptWord }),
      answerSnapshot.extend({ outcome: z.literal("skip"), root: promptWord }),
    ]),
    args: ({ runId }, input) => ({ active_run: runId, tap_id: input.tapId, expected_round: input.expectedRound, removed: input.removed }),
    transform: (value) => value.outcome === "miss" && value.status !== "completed" ? { ...value, root: undefined } : value,
  }));
  arcade.post("/pop/:runId/hint", async ({ params, body, rpc, json }) => {
    const run = runParams.safeParse(params);
    const input = hintBody.safeParse(body);
    if (!run.success || !input.success) throw new ArcadeError(400, "Invalid arcade request.");
    const item = popHint.safeParse(await rpc("pandiwasto_pop_hint", {
      active_run: run.data.runId, expected_round: input.data.expectedRound, requested_level: input.data.level,
    }));
    if (!item.success) {
      logError("Unexpected arcade response", { operation: "pandiwasto_pop_hint" });
      throw new ArcadeError(503, "Arcade storage returned an unexpected response.");
    }
    const { level, fresh, text, word, root, skill } = item.data;
    const band = level < 3 ? await hintBand(rpc, skill) : undefined;
    const hint = await resolveHint({ text: hintLadder(1, level, text, [root]), fact: text, level, word, secrets: [root], cacheKey: "1:" + word, band });
    const hintId = fresh
      ? await logHint(rpc, { runId: run.data.runId, skillId: skill, itemIndex: input.data.expectedRound, level, trigger: input.data.auto ? "auto" : "requested", ...hint })
      : undefined;
    return json({ text: hint.text, level, ...(hintId ? { hintId } : {}) });
  });
  arcade.post("/pop/:runId/end", route({
    name: "pandiwasto_pop_end", params: runParams, body: endBody, response: snapshot,
    args: ({ runId }) => ({ active_run: runId }),
  }));
  return handleRequest;
}
