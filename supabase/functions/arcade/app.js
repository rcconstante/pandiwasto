import { z } from "npm:zod@4.6.7";
import { mountAdminResearch } from "./adminResearch.js";
import { resolveHint } from "./hints.js";
import { mountRankedRoutes } from "./ranked-routes.js";

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
const hintBody = z.strictObject({ expectedRound });
const endBody = z.strictObject({});
const moderationBody = z.strictObject({
  gameId: z.number().int().min(1).max(7),
  targetAccountId: uuid,
  hidden: z.boolean(),
  reason: z.string().trim().min(1).max(300),
});
const progress = z.object({ xp: positiveCount, bestScores: z.record(z.string().regex(/^[1-7]$/), positiveCount) });
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
  hadMiss: z.boolean(),
  studyActive: z.boolean().optional(),
  hintAllowed: z.boolean().optional(),
});
const answerSnapshot = snapshot.extend({
  correct: z.boolean(),
  root: promptWord.nullish(),
  points: positiveCount.max(100),
  roundWord: promptWord,
});
const hint = z.object({ text: z.string().min(1).max(300), word: promptWord.optional(), root: promptWord.optional() });
const mastery = z.object({
  skills: z.array(z.object({ skillId: z.string().min(1).max(80), mastery: z.number().min(0).max(1), attempts: positiveCount })),
});
const adminStatus = z.object({ players: positiveCount, completedRuns: positiveCount, publishedScores: positiveCount });
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

        const { data, error } = await supabase.auth.getUser(token);
        if (error && (!error.status || error.status >= 500 || error.status === 429)) {
          throw new ArcadeError(503, "Sign-in verification is unavailable. Try again shortly.");
        }
        if (error || !uuid.safeParse(data?.user?.id).success) {
          throw new ArcadeError(401, "Your sign-in session has expired.");
        }
        if (data.user.is_anonymous || !data.user.email_confirmed_at) {
          throw new ArcadeError(403, "Confirm your email to use the arcade.");
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

        return await handler({ params, body, rpc, json });
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

  mountRankedRoutes(arcade, { ArcadeError, logError });
  mountAdminResearch(arcade, route);
  arcade.get("/progress", route({ name: "pandiwasto_arcade_progress", response: progress }));
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
  arcade.post("/pop/:runId/hint", route({
    name: "pandiwasto_pop_hint", params: runParams, body: hintBody, response: hint,
    args: ({ runId }, input) => ({ active_run: runId, expected_round: input.expectedRound }),
    transform: async (value) => ({ text: await resolveHint(value, hintProvider) }),
  }));
  arcade.post("/pop/:runId/end", route({
    name: "pandiwasto_pop_end", params: runParams, body: endBody, response: snapshot,
    args: ({ runId }) => ({ active_run: runId }),
  }));
  return handleRequest;
}
