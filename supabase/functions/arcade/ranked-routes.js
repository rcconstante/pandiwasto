import { z } from "npm:zod@4.6.7";
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
  hintLevel: number.max(3),
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

export function mountRankedRoutes(router, { ArcadeError, logError, resolveHint, logHint }) {
  function projectResult(json, value, run) {
    const parsed = publicRun.safeParse({ ...value, studyActive: run.studyActive, hintAllowed: run.hintAllowed });
    if (parsed.success) return json({ ...parsed.data, serverNow: Date.now() });
    logError("Unexpected ranked arcade projection");
    throw new ArcadeError(503, "Arcade storage returned an unexpected response.");
  }

  function getRun(value, expectedGame, expectedRun) {
    const parsed = rankedEnvelope.safeParse(value);
    if (!parsed.success) {
      logError("Unexpected ranked arcade snapshot");
      throw new ArcadeError(503, "Arcade storage returned an unexpected response.");
    }
    const run = parsed.data;
    if (run.gameId !== expectedGame || (expectedRun && run.runId !== expectedRun)) {
      throw new ArcadeError(404, "The requested arcade record could not be found.");
    }
    if (!isRankedState(run.state, expectedGame)) {
      logError("Ranked arcade snapshot uses an unsupported engine version", { gameId: expectedGame });
      throw new ArcadeError(503, "This saved game is temporarily unavailable.");
    }
    return run;
  }

  router.post("/games/:gameId/start", async ({ params, body, rpc, json }) => {
    const parsed = startParams.safeParse(params);
    const input = startBody.safeParse(body);
    if (!parsed.success || !input.success) throw new ArcadeError(400, "Invalid arcade request.");
    const { gameId } = parsed.data;
    const { requestId, mode } = input.data;
    if (mode === "practice" && gameId !== 2) throw new ArcadeError(400, "Practice mode is only available for Whack-a-Word.");
    const data = await rpc("pandiwasto_ranked_start", {
      game: gameId, request_id: requestId, state: createRankedState(gameId, mode), practice: mode === "practice",
    });
    const run = getRun(data, gameId);
    return projectResult(json, projectRanked(run), run);
  });

  router.get("/games/:gameId/:runId", async ({ params, rpc, json }) => {
    const parsed = gameParams.safeParse(params);
    if (!parsed.success) throw new ArcadeError(400, "Invalid arcade request.");
    const { gameId, runId } = parsed.data;
    const data = await rpc("pandiwasto_ranked_state", { active_run: runId });
    const run = getRun(data, gameId, runId);
    return projectResult(json, projectRanked(run), run);
  });

  router.post("/games/:gameId/:runId/move", async ({ params: routeParams, body, rpc, json }) => {
    const now = Date.now();
    const params = gameParams.safeParse(routeParams);
    const input = moveBody.safeParse(body);
    if (!params.success || !input.success) throw new ArcadeError(400, "Invalid arcade request.");
    const { gameId, runId } = params.data;
    const { requestId, version, action } = input.data;
    const actionKey = { version, action };
    const stored = await rpc("pandiwasto_ranked_state", { active_run: runId, request_id: requestId, action: actionKey });
    const run = getRun(stored, gameId, runId);
    if (run.response != null) return projectResult(json, run.response, run);
    if (run.status !== "active" || run.version !== version) throw new ArcadeError(409, "The game state has changed. Reload the run before trying again.");

    let next;
    try {
      next = moveRanked(run.state, action, now);
    } catch (error) {
      if (error instanceof RankedMoveError) throw new ArcadeError(error.status, error.message);
      throw error;
    }
    const hint = next.hintRequest && await resolveHint(next.hintRequest);
    if (hint) next.state = { ...next.state, hint: hint.text };

    const result = publicRun.parse(projectRanked({
      runId, version: version + 1, status: next.abandon ? "abandoned" : next.complete ? "completed" : "active", state: next.state,
    }, now));
    const saved = await rpc("pandiwasto_ranked_action", {
      active_run: runId, request_id: requestId, expected_version: version, action: actionKey,
      state: next.state, response: result, complete: next.complete, abandon: next.abandon,
      score: next.state.score, awarded_xp: next.complete ? next.state.xp : 0,
      observations: next.observations, hint_context: next.hintContext ?? null,
    });
    const committed = getRun(saved, gameId, runId);
    if (hint) await logHint(rpc, { runId, skillId: next.hintContext.skillId, itemIndex: next.hintContext.itemIndex, level: next.hintRequest.level, ...hint });
    return projectResult(json, committed.response, committed);
  });
}
