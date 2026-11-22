import { z } from "zod";
import { createRankedState, isRankedState, moveRanked, projectRanked, RankedMoveError } from "./ranked-games.js";

const uuid = z.uuid();
const number = z.number().int().nonnegative();
const game = z.string().regex(/^[2-7]$/).transform(Number);
const startParams = z.object({ gameId: game });
const gameParams = startParams.extend({ runId: uuid });
const startBody = z.strictObject({
  requestId: uuid,
  mode: z.enum(["ranked", "practice"]).default("ranked"),
});
const actionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("answer"), choice: z.string().min(1).max(80) }),
  z.strictObject({ type: z.literal("flip"), cardId: number.max(9) }),
  z.strictObject({ type: z.literal("hint") }),
  z.strictObject({ type: z.literal("next") }),
  z.strictObject({ type: z.literal("timeout") }),
  z.strictObject({ type: z.literal("finish") }),
  z.strictObject({ type: z.literal("abandon") }),
]);
const moveBody = z.strictObject({ requestId: uuid, version: number, action: actionSchema });
const gameId = number.min(2).max(7);
const status = z.enum(["active", "completed", "abandoned"]);
const rankedEnvelope = z.object({
  runId: uuid, gameId, status, version: number, state: z.unknown(), response: z.unknown().optional(),
  studyActive: z.boolean().optional(), hintAllowed: z.boolean().optional(),
});
const publicRun = z.object({
  runId: uuid, gameId, status, version: number,
  mode: z.enum(["ranked", "practice"]),
  round: number, totalRounds: number.nullable(), phase: z.enum(["playing", "review"]),
  serverNow: number, score: number, xp: number,
  feedback: z.object({
    kind: z.enum(["correct", "wrong", "timeout", "match", "mismatch", "board-complete"]), text: z.string(),
    points: number, answer: z.string().optional(),
  }).nullable(),
  hint: z.string().nullable(),
  studyActive: z.boolean().optional(),
  hintAllowed: z.boolean().optional(),
  rejected: z.array(z.string()),
  results: z.array(z.object({ text: z.string(), points: number, meaning: z.string().optional() })),
  options: z.array(z.object({
    id: z.string(), label: z.string(), type: z.string().optional(), affix: z.string().optional(), suffix: z.string().optional(),
  })).optional(),
  word: z.string().optional(),
  root: z.string().optional(),
  sentence: z.string().optional(),
  verb: z.string().optional(),
  hearts: number.max(3).optional(),
  hits: number.optional(),
  deadline: number.nullable().optional(),
  hideAt: number.nullable().optional(),
  pairsFound: number.optional(),
  pairsTotal: number.optional(),
  moves: number.optional(),
  cards: z.array(z.object({ id: number.max(9), word: z.string().nullable(), matched: z.boolean(), hinted: z.boolean() })).optional(),
});

export function mountRankedRoutes(router, { rpc, fail, logError }) {
  function projectResult(res, value, run) {
    const parsed = publicRun.safeParse({ ...value, studyActive: run.studyActive, hintAllowed: run.hintAllowed });
    if (parsed.success) return res.json({ ...parsed.data, serverNow: Date.now() });
    logError("Unexpected ranked arcade projection");
    return fail(res, 503, "Arcade storage returned an unexpected response.");
  }

  function getRun(res, value, expectedGame, expectedRun) {
    const parsed = rankedEnvelope.safeParse(value);
    if (!parsed.success) {
      logError("Unexpected ranked arcade snapshot");
      fail(res, 503, "Arcade storage returned an unexpected response.");
      return null;
    }
    const run = parsed.data;
    if (run.gameId !== expectedGame || (expectedRun && run.runId !== expectedRun)) {
      fail(res, 404, "The requested arcade record could not be found.");
      return null;
    }
    if (!isRankedState(run.state, expectedGame)) {
      logError("Ranked arcade snapshot uses an unsupported engine version", { gameId: expectedGame });
      fail(res, 503, "This saved game is temporarily unavailable.");
      return null;
    }
    return run;
  }

  router.post("/games/:gameId/start", async (req, res) => {
    const parsed = startParams.safeParse(req.params);
    const input = startBody.safeParse(req.body);
    if (!parsed.success || !input.success) return fail(res, 400, "Invalid arcade request.");
    const { gameId } = parsed.data;
    const { requestId, mode } = input.data;
    if (mode === "practice" && gameId !== 2) return fail(res, 400, "Practice mode is only available for Whack-a-Word.");
    const data = await rpc(res, "pandiwasto_ranked_start", {
      game: gameId, request_id: requestId, state: createRankedState(gameId, mode), practice: mode === "practice",
    });
    if (res.headersSent) return;
    const run = getRun(res, data, gameId);
    if (run) return projectResult(res, projectRanked(run), run);
  });

  router.get("/games/:gameId/:runId", async (req, res) => {
    const parsed = gameParams.safeParse(req.params);
    if (!parsed.success) return fail(res, 400, "Invalid arcade request.");
    const { gameId, runId } = parsed.data;
    const data = await rpc(res, "pandiwasto_ranked_state", { active_run: runId });
    if (res.headersSent) return;
    const run = getRun(res, data, gameId, runId);
    if (run) return projectResult(res, projectRanked(run), run);
  });

  router.post("/games/:gameId/:runId/move", async (req, res) => {
    const now = Date.now();
    const params = gameParams.safeParse(req.params);
    const input = moveBody.safeParse(req.body);
    if (!params.success || !input.success) return fail(res, 400, "Invalid arcade request.");
    const { gameId, runId } = params.data;
    const { requestId, version, action } = input.data;
    const actionKey = { version, action };
    const stored = await rpc(res, "pandiwasto_ranked_state", { active_run: runId, request_id: requestId, action: actionKey });
    if (res.headersSent) return;
    const run = getRun(res, stored, gameId, runId);
    if (!run) return;
    if (run.response != null) return projectResult(res, run.response, run);
    if (run.status !== "active" || run.version !== version) return fail(res, 409, "The game state has changed. Reload the run before trying again.");

    let next;
    try {
      next = moveRanked(run.state, action, now);
    } catch (error) {
      if (error instanceof RankedMoveError) return fail(res, error.status, error.message);
      throw error;
    }

    const result = publicRun.parse(projectRanked({
      runId, version: version + 1, status: next.abandon ? "abandoned" : next.complete ? "completed" : "active", state: next.state,
    }, now));
    const saved = await rpc(res, "pandiwasto_ranked_action", {
      active_run: runId, request_id: requestId, expected_version: version, action: actionKey,
      state: next.state, response: result, complete: next.complete, abandon: next.abandon,
      score: next.state.score, awarded_xp: next.complete ? next.state.xp : 0,
      observations: next.observations, hint_context: next.hintContext ?? null,
    });
    if (res.headersSent) return;
    const committed = getRun(res, saved, gameId, runId);
    if (committed) return projectResult(res, committed.response, committed);
  });
}
