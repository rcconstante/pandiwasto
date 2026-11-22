import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { createApp } from "./app.js";
import { resolveHint } from "./hints.js";

const player = "87e015a2-d2de-4fd0-8bc2-746cbb27f309";
const run = "4947bafb-8fcb-41ec-bc0f-6f59731fbba0";
const attempt = "e8d9d944-5da2-4231-ba77-2037da4a0662";
const token = "signed.header.signature";
const snapshot = { runId: run, status: "active", round: 0, totalRounds: 5, hearts: 3, score: 0, xp: 0, word: "SUMAKAY", hintUsed: false, hadMiss: false };

async function startServer(t, options = {}) {
  const server = createApp({ ...options, logError: () => {} }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

function authUser() {
  return { data: { user: { id: player, email_confirmed_at: "2026-01-01T00:00:00Z" } }, error: null };
}

function post(data, authorization = token, headers = {}) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${authorization}`, ...headers },
    body: JSON.stringify(data),
  };
}

test("Local health works without a database and protected data stays unavailable", async (t) => {
  const base = await startServer(t);
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("x-powered-by"), null);
  assert.equal(health.headers.get("cache-control"), "no-store");
  assert.equal((await fetch(`${base}/api/db-test`)).status, 503);
  assert.equal((await fetch(`${base}/api/arcade/progress`)).status, 503);
});

test("The connection test checks the migrated schema without returning player data", async (t) => {
  const base = await startServer(t, { supabase: {
    from(table) {
      assert.equal(table, "pandiwasto_game_scores");
      return { select(column, options) {
        assert.equal(column, "game_id");
        assert.deepEqual(options, { head: true });
        return { limit: async () => ({ data: [{ player_id: player }], error: null }) };
      } };
    },
  } });
  const response = await fetch(`${base}/api/db-test`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("Arcade routes reject unknown origins and invalid authentication", async (t) => {
  const base = await startServer(t, { supabase: {
    auth: { getUser: async () => ({ error: { status: 401 } }) },
    rpc: () => assert.fail("Unauthorized request must not reach the database"),
  } });
  const preflight = await fetch(`${base}/api/arcade/pop/start`, {
    method: "OPTIONS", headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "POST" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.equal((await fetch(`${base}/api/arcade/progress`, { headers: { Origin: "https://example.test" } })).status, 403);
  assert.equal((await fetch(`${base}/api/arcade/progress`)).status, 401);
  assert.equal((await fetch(`${base}/api/arcade/pop/start`, post({ requestId: run }))).status, 401);
});

test("Zod rejects client-controlled scoring and returns only public snapshot fields", async (t) => {
  const calls = [];
  const base = await startServer(t, { supabase: {
    auth: { getUser: async (value) => { assert.equal(value, token); return authUser(); } },
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: { ...snapshot, root: "SAKAY", private: true }, error: null };
    },
  } });
  const endpoint = `${base}/api/arcade/pop/start`;
  assert.equal((await fetch(endpoint, post({ requestId: run, xp: 99999 }))).status, 400);
  assert.equal((await fetch(endpoint, post({ requestId: run, account_id: player }))).status, 400);
  assert.equal((await fetch(endpoint, post({ requestId: "not-valid" }))).status, 400);
  assert.equal((await fetch(endpoint, post({ requestId: "A".repeat(9_000) }))).status, 413);
  assert.equal((await fetch(endpoint, post({ requestId: run }, token, { "Content-Type": "text/plain" }))).status, 415);
  assert.deepEqual(calls, []);
  const accepted = await fetch(endpoint, post({ requestId: run }));
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), snapshot);
  assert.deepEqual(calls, [{ name: "pandiwasto_pop_start", args: { account_id: player, request_id: run } }]);
});

test("Answer retry IDs reach storage and stale or unowned runs do not expose data", async (t) => {
  const answers = [];
  const base = await startServer(t, { supabase: {
    auth: { getUser: async () => authUser() },
    rpc: async (name, args) => {
      assert.equal(name, "pandiwasto_pop_answer");
      if (args.active_run === player) return { error: { code: "PT404", details: "private" } };
      if (args.expected_round > 0) return { error: { code: "PT409", details: "private" } };
      answers.push(args);
      return { data: { ...snapshot, hearts: 2, correct: false, root: "SAKAY", points: 0, roundWord: "SUMAKAY" } };
    },
  } });
  const endpoint = `${base}/api/arcade/pop/${run}/answer`;
  const body = { answerId: attempt, expectedRound: 0, response: "SUMAKA" };
  for (let retry = 0; retry < 2; retry++) {
    const reply = await fetch(endpoint, post(body));
    assert.equal(reply.status, 200);
    assert.deepEqual(await reply.json(), { ...snapshot, hearts: 2, correct: false, points: 0, roundWord: "SUMAKAY" });
  }
  assert.deepEqual(answers[0], { account_id: player, active_run: run, answer_id: attempt, expected_round: 0, response: "SUMAKA" });
  assert.deepEqual(answers[0], answers[1]);
  const stale = await fetch(endpoint, post({ ...body, expectedRound: 1 }));
  assert.equal(stale.status, 409);
  assert.doesNotMatch(JSON.stringify(await stale.json()), /private/);
  assert.equal((await fetch(`${base}/api/arcade/pop/${player}/answer`, post(body))).status, 404);
});

test("Hints default to the authored rule and guard direct answers from a future provider", async (t) => {
  const rule = "Tingnan kung aling mga titik ang idinagdag sa loob.";
  const item = { text: rule, word: "SUMAKAY", root: "SAKAY" };
  assert.equal(await resolveHint(item), rule);
  assert.equal(await resolveHint(item, async () => "Ang sagot ay s a k a y."), rule);
  assert.equal(await resolveHint(item, async () => { throw new Error("offline"); }), rule);
  const base = await startServer(t, {
    supabase: { auth: { getUser: async () => authUser() }, rpc: async () => ({ data: item }) },
    hintProvider: async (content) => {
      assert.deepEqual(Object.keys(content).sort(), ["game", "language", "rule", "signal", "word"]);
      return "Hanapin ang idinagdag na titik sa loob ng salita.";
    },
  });
  const reply = await fetch(`${base}/api/arcade/pop/${run}/hint`, post({ expectedRound: 0 }));
  assert.equal(reply.status, 200);
  assert.deepEqual(await reply.json(), { text: "Hanapin ang idinagdag na titik sa loob ng salita." });
});

test("Admin status uses the database role check and mastery uses the authenticated account", async (t) => {
  const base = await startServer(t, { supabase: {
    auth: { getUser: async () => authUser() },
    rpc: async (name, args) => {
      assert.deepEqual(args, { account_id: player });
      return name === "pandiwasto_arcade_admin_status"
        ? { error: { code: "PT403" } }
        : { data: { skills: [{ skillId: "salitang-ugat", mastery: 0.34, attempts: 2 }] } };
    },
  } });
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await fetch(`${base}/api/arcade/admin/status`, { headers })).status, 403);
  const response = await fetch(`${base}/api/arcade/mastery`, { headers });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { skills: [{ skillId: "salitang-ugat", mastery: 0.34, attempts: 2 }] });
});

test("Score moderation has a strict input, an authenticated actor, and a safe response", async (t) => {
  const base = await startServer(t, { supabase: {
    auth: { getUser: async () => authUser() },
    rpc: async (name, args) => {
      assert.equal(name, "pandiwasto_arcade_moderate_score");
      assert.deepEqual(args, { account_id: player, game: 1, target_account_id: run, hidden: true, reason: "Reviewed the score." });
      return { data: { hidden: true, details: "private" } };
    },
  } });
  const endpoint = `${base}/api/arcade/admin/scores/moderate`;
  const body = { gameId: 1, targetAccountId: run, hidden: true, reason: " Reviewed the score. " };
  assert.equal((await fetch(endpoint, post({ ...body, reason: " " }))).status, 400);
  assert.equal((await fetch(endpoint, post({ ...body, actor: run }))).status, 400);
  const response = await fetch(endpoint, post(body));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { hidden: true });
});

test("Ranked HTTP requests use a versioned owned run and never serialize private state", async (t) => {
  let stored;
  let moves = 0;
  let savedAction;
  let savedResponse;
  const base = await startServer(t, { supabase: {
    auth: { getUser: async () => authUser() },
    rpc: async (name, args) => {
      assert.equal(args.account_id, player);
      if (name === "pandiwasto_ranked_start") {
        assert.equal(args.game, 7);
        assert.equal(args.practice, false);
        stored = { runId: run, version: 0, gameId: 7, status: "active", state: args.state };
        return { data: stored };
      }
      assert.equal(args.active_run, run);
      if (name === "pandiwasto_ranked_state") {
        if (!savedAction) return { data: stored };
        return { data: { ...stored, response: savedResponse } };
      }
      assert.equal(name, "pandiwasto_ranked_action");
      assert.equal(args.expected_version, 0);
      assert.equal(args.awarded_xp, 0);
      assert.equal(args.score, 100);
      assert.equal(args.observations[0].correct, true);
      savedAction = args.action;
      savedResponse = args.response;
      stored = { ...stored, version: 1, state: args.state };
      moves += 1;
      return { data: { ...stored, response: args.response } };
    },
  } });
  const games = `${base}/api/arcade/games`;
  assert.equal((await fetch(`${games}/1/start`, post({ requestId: run }))).status, 400);
  assert.equal((await fetch(`${games}/7/start`, post({ requestId: run, mode: "practice" }))).status, 400);
  const started = await fetch(`${games}/7/start`, post({ requestId: run }));
  assert.equal(started.status, 200);
  const initial = await started.json();
  assert.equal(initial.version, 0);
  assert.ok(!("state" in initial) && !("rounds" in initial));
  const answer = stored.state.rounds[0].answer;
  const move = { requestId: attempt, version: 0, action: { type: "answer", choice: answer } };
  const endpoint = `${games}/7/${run}/move`;
  assert.equal((await fetch(endpoint, post({ ...move, score: 500 }))).status, 400);
  assert.equal((await fetch(`${games}/6/${run}/move`, post(move))).status, 404);
  for (let retry = 0; retry < 2; retry++) {
    const accepted = await fetch(endpoint, post(move));
    assert.equal(accepted.status, 200);
    const result = await accepted.json();
    assert.equal(result.version, 1);
    assert.equal(result.score, 100);
    assert.equal(result.feedback.answer, answer);
    assert.ok(!("state" in result));
  }
  assert.equal(moves, 1);
  const latest = await fetch(`${games}/7/${run}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(latest.status, 200);
  assert.equal((await latest.json()).version, 1);
});
