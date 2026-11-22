import cors from "cors";
import express from "express";
import { z } from "zod";
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

function fail(res, status, error) {
  return res.status(status).json({ error });
}

function accountRateLimiter() {
  const windows = new Map();
  const minute = 60_000;
  let nextSweep = 0;

  return (_req, res, next) => {
    const now = Date.now();
    if (now >= nextSweep) {
      for (const [user, window] of windows) {
        if (window.until <= now) windows.delete(user);
      }
      nextSweep = now + minute;
    }

    const playerId = res.locals.playerId;
    let window = windows.get(playerId);
    if (!window || window.until <= now) {
      if (!window && windows.size >= 10_000) return fail(res.set("Retry-After", "60"), 429, "Arcade is busy. Try again shortly.");
      window = { count: 0, until: now + minute };
      windows.set(playerId, window);
    }
    if (window.count >= 180) {
      return fail(res.set("Retry-After", String(Math.ceil((window.until - now) / 1000))), 429, "Too many arcade requests. Try again shortly.");
    }
    window.count += 1;
    next();
  };
}

export function createApp({
  supabase = null,
  clientOrigin = "http://localhost:5173",
  hintProvider,
  logError = console.error,
} = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    next();
  });
  app.use((req, res, next) => {
    const origin = req.get("Origin");
    if (origin && origin !== clientOrigin) return fail(res, 403, "Origin is not allowed.");
    next();
  });
  app.use(cors({ origin: clientOrigin, methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Authorization", "Content-Type"] }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", message: "PandiWasto backend is running" });
  });

  app.get("/api/db-test", async (_req, res) => {
    if (!supabase) return fail(res, 503, "Supabase is not configured (running in local-only mode).");
    const { error } = await supabase.from("pandiwasto_game_scores").select("game_id", { head: true }).limit(1);
    if (error) return fail(res, 503, "The database connection test could not be completed.");
    res.json({ status: "ok" });
  });

  const arcade = express.Router();
  arcade.use((req, res, next) => {
    if (req.method === "POST" && !req.is("application/json")) return fail(res, 415, "Send the request as JSON.");
    next();
  });
  arcade.use(express.json({ limit: "8kb" }));
  arcade.use(async (req, res, next) => {
    if (!supabase) return fail(res, 503, "Online arcade is not configured. Local preview is available.");
    const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(req.get("Authorization") ?? "")?.[1];
    if (!token || token.length > 12_000) return fail(res, 401, "Sign in to use the online arcade.");

    const { data, error } = await supabase.auth.getUser(token);
    if (error && (!error.status || error.status >= 500 || error.status === 429)) {
      return fail(res, 503, "Sign-in verification is unavailable. Try again shortly.");
    }
    if (error || !uuid.safeParse(data?.user?.id).success) return fail(res, 401, "Your sign-in session has expired.");
    if (data.user.is_anonymous || !data.user.email_confirmed_at) return fail(res, 403, "Confirm your email to use the online arcade.");
    res.locals.playerId = data.user.id;
    next();
  });
  arcade.use(accountRateLimiter());

  async function rpc(res, name, args) {
    const { data, error } = await supabase.rpc(name, { ...args, account_id: res.locals.playerId });
    if (error) {
      const publicError = PUBLIC_RPC_ERRORS.get(error.code);
      if (publicError) return fail(res, ...publicError);
      logError("Arcade data request failed", { operation: name, code: error.code });
      return fail(res, 503, "Arcade storage is unavailable. Try again shortly.");
    }
    return data;
  }

  function route({ name, params, body, args, response, transform }) {
    return async (req, res) => {
      const parsedParams = params?.safeParse(req.params);
      const parsedBody = body?.safeParse(req.body);
      if (parsedParams?.error || parsedBody?.error) return fail(res, 400, "Invalid arcade request.");

      const data = await rpc(res, name, args?.(parsedParams?.data, parsedBody?.data));
      if (res.headersSent) return;
      const result = response.safeParse(data);
      if (!result.success) {
        logError("Unexpected arcade response", { operation: name });
        return fail(res, 503, "Arcade storage returned an unexpected response.");
      }
      return res.json(transform ? await transform(result.data) : result.data);
    };
  }

  mountRankedRoutes(arcade, { rpc, fail, logError });
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
  app.use("/api/arcade", arcade);
  app.use((_req, res) => fail(res, 404, "API route not found."));
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === "entity.too.large") return fail(res, 413, "Arcade request is too large.");
    if (error.type === "entity.parse.failed" || error instanceof URIError) return fail(res, 400, "Invalid arcade request.");
    logError("Arcade request failed", { type: error.name });
    return fail(res, 500, "The arcade request could not be completed.");
  });
  return app;
}
