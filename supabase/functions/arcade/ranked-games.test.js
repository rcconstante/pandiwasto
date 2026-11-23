import assert from "node:assert/strict";
import { createRankedState, moveRanked, projectRanked, RankedMoveError } from "./ranked-games.js";

const runId = "4947bafb-8fcb-41ec-bc0f-6f59731fbba0";
const epoch = 100_000;
const frame = (state, now = epoch) => projectRanked({ runId, version: 0, status: "active", state }, now);

Deno.test("Whack-a-Word gives the three-level hint ladder and extends the answer window", () => {
  const state = createRankedState(2, "ranked", epoch);
  assert.deepEqual(state.hintContext, { skillId: "kayarian-ng-salita", itemIndex: 0 });
  const word = state.deck[state.deckIndex];
  const hinted = moveRanked(state, { type: "hint" }, epoch + 9000);
  assert.equal(hinted.state.hintLevel, 1);
  assert.equal(hinted.hintRequest.level, 1);
  assert.ok(hinted.hintRequest.secrets.includes(word.text));
  assert.ok(hinted.state.deadline >= epoch + 9000 + 5000, "reading the hint does not use up the answer window");
  let ladder = hinted;
  for (const level of [2, 3]) ladder = moveRanked(ladder.state, { type: "hint" }, epoch + 9000 + level);
  assert.equal(ladder.state.hintLevel, 3);
  assert.throws(() => moveRanked(ladder.state, { type: "hint" }, epoch + 9010), RankedMoveError);
  const answered = moveRanked(ladder.state, { type: "answer", choice: word.type }, epoch + 9020);
  assert.equal(answered.observations[0].hintUsed, true);
});

for (const gameId of [3, 5, 6, 7]) {
  Deno.test("Ranked choice game " + gameId + " validates choices, hints, scoring and finish", () => {
    let state = createRankedState(gameId, "ranked", epoch);
    assert.equal(state.rounds.length, 5);
    assert.equal(frame(state).round, 0);
    assert.equal(frame(state).options.length, gameId === 5 ? 2 : 4);
    assert.equal("rounds" in frame(state), false);
    assert.equal("answer" in frame(state), false);
    assert.throws(() => moveRanked(state, { type: "answer", choice: "not-an-option" }, epoch), RankedMoveError);
    assert.throws(() => moveRanked(state, { type: "finish" }, epoch), RankedMoveError);

    const item = state.rounds[0];
    const wrong = item.view.options.find(({ id }) => id !== item.answer).id;
    const retry = moveRanked(state, { type: "answer", choice: wrong }, epoch + 45);
    assert.equal(retry.state.score, 0);
    assert.equal(retry.state.feedback.kind, "wrong");
    assert.equal(retry.observations[0].firstAttempt, true);
    assert.equal(retry.observations[0].responseMs, 45);
    assert.equal(retry.observations[0].correct, false);
    assert.equal("answer" in retry.state.feedback, false);
    const secondMiss = moveRanked(retry.state, { type: "answer", choice: wrong }, epoch + 50);
    assert.equal(secondMiss.state.hearts, 1);
    const skipped = moveRanked(secondMiss.state, { type: "answer", choice: wrong }, epoch + 51);
    assert.equal(skipped.state.hearts, 0);
    assert.equal(skipped.state.feedback.answer, item.summary);
    assert.equal(skipped.state.phase, "review");
    const fresh = moveRanked(skipped.state, { type: "next" }, epoch + 52);
    assert.equal(fresh.state.hearts, 3);
    assert.equal(fresh.state.round, 1);

    const guided = moveRanked(retry.state, { type: "hint" }, epoch + 60);
    assert.deepEqual(guided.hintContext, { skillId: item.skill, itemIndex: 0 });
    assert.equal(guided.hintRequest.level, 1);
    assert.equal(frame(guided.state).hintLevel, 1);
    let ladder = guided;
    for (const level of [2, 3]) {
      ladder = moveRanked(ladder.state, { type: "hint" }, epoch + 60 + level);
      assert.equal(ladder.state.hintLevel, level);
      assert.ok(ladder.hintRequest.secrets.includes(item.summary));
      // Level 2 restates every option's rule; level 3 examples must not show this item's answer.
      if (ladder.state.hint.startsWith("Halimbawa")) assert.ok(!ladder.state.hint.toLowerCase().includes(item.summary.toLowerCase()));
    }
    assert.equal(ladder.state.hintContext, null);
    assert.throws(() => moveRanked(ladder.state, { type: "hint" }, epoch + 64), RankedMoveError);
    const solved = moveRanked(guided.state, { type: "answer", choice: item.answer }, epoch + 110);
    assert.equal(solved.state.score, 50);
    assert.equal(solved.state.feedback.answer, item.summary);
    assert.equal(solved.observations[0].firstAttempt, false);
    assert.equal(solved.observations[0].hintUsed, true);
    assert.equal(solved.complete, false);
    state = solved.state;
    for (let round = 1; round <= 4; round += 1) {
      state = moveRanked(state, { type: "next" }, epoch + round * 1000).state;
      const complete = moveRanked(state, { type: "answer", choice: state.rounds[round].answer }, epoch + round * 1000 + 100);
      assert.equal(complete.complete, round === 4);
      state = complete.state;
    }
    assert.equal(state.score, 450);
    assert.equal(state.xp, 100);
    assert.equal(state.results.length, 5);
    const lastItem = state.rounds[4];
    const lastWrong = lastItem.view.options.find(({ id }) => id !== lastItem.answer).id;
    let missedFinal = { ...state, phase: "playing", hearts: 3, rejected: [], results: state.results.slice(0, -1), xp: 0 };
    for (let miss = 1; miss <= 3; miss += 1) {
      const result = moveRanked(missedFinal, { type: "answer", choice: lastWrong }, epoch + 5000 + miss);
      assert.equal(result.complete, miss === 3);
      missedFinal = result.state;
    }
    assert.equal(missedFinal.xp, 80);
  });
}

Deno.test("Whack retries the same word after a miss, refills hearts after review, and awards XP for hits", () => {
  const start = createRankedState(2, "ranked", epoch);
  assert.equal(frame(start).deadline, epoch + 10_000);
  assert.throws(() => moveRanked(start, { type: "timeout" }, epoch + 9_999), RankedMoveError);
  const timeout = moveRanked(start, { type: "answer", choice: start.deck[0].type }, epoch + 10_000);
  assert.equal(timeout.state.hearts, 2);
  assert.equal(timeout.observations[0].timedOut, true);
  assert.equal(timeout.state.feedback.kind, "timeout");
  assert.equal(timeout.state.score, 0);

  let state = moveRanked(timeout.state, { type: "next" }, epoch + 10_000).state;
  assert.equal(state.round, 0);
  assert.equal(state.hearts, 2);
  for (let hit = 0; hit < 5; hit += 1) {
    const now = epoch + 10_000 + hit * 200;
    state = moveRanked(state, { type: "answer", choice: state.deck[state.deckIndex].type }, now + 100).state;
    state = moveRanked(state, { type: "next" }, now + 200).state;
  }
  assert.equal(state.hits, 5);
  assert.equal(state.score, 500);
  assert.equal(state.xp, 50);
  assert.equal(state.deadline, epoch + 20_000);
  assert.equal(moveRanked(state, { type: "finish" }, epoch + 11_010).complete, true);

  state = moveRanked(state, { type: "timeout" }, state.deadline).state;
  state = moveRanked(state, { type: "next" }, epoch + 20_000).state;
  state = moveRanked(state, { type: "timeout" }, state.deadline).state;
  state = moveRanked(state, { type: "next" }, state.beganAt + 30_000).state;
  const lose = moveRanked(state, { type: "timeout" }, state.deadline);
  assert.equal(lose.complete, false);
  assert.equal(lose.state.hearts, 0);
  assert.equal(lose.state.xp, 50);
  const advance = moveRanked(lose.state, { type: "next" }, state.deadline + 100).state;
  assert.equal(advance.round, 6);
  assert.equal(advance.hearts, 3);

  const practice = createRankedState(2, "practice", epoch);
  assert.equal(frame(practice).deadline, null);
  assert.throws(() => moveRanked(practice, { type: "timeout" }, epoch + 50_000), RankedMoveError);
  assert.equal(moveRanked(practice, { type: "answer", choice: practice.deck[0].type }, epoch + 50_000).state.xp, 10);
  assert.throws(() => createRankedState(3, "practice", epoch), RankedMoveError);
});

Deno.test("Memory conceals cards, tracks mismatches, and banks three board scores", () => {
  let now = epoch;
  let state = createRankedState(4, "ranked", now);
  assert.equal(frame(state).cards.length, 6);
  assert.ok(frame(state).cards.every((card) => card.word === null));
  assert.throws(() => moveRanked(state, { type: "flip", cardId: 7 }, now), RankedMoveError);
  const firstPair = state.boards[0].cards[0].pair.compound;
  const unmatched = state.boards[0].cards.findIndex((card) => card.pair.compound !== firstPair);
  state = moveRanked(state, { type: "flip", cardId: 0 }, ++now).state;
  assert.equal(frame(state, now).cards.filter((card) => card.word).length, 1);
  const wrong = moveRanked(state, { type: "flip", cardId: unmatched }, ++now);
  assert.equal(wrong.state.feedback.kind, "mismatch");
  assert.equal(wrong.observations[0].correct, false);
  assert.equal(frame(wrong.state, now).cards.filter((card) => card.word).length, 2);
  assert.throws(() => moveRanked(wrong.state, { type: "flip", cardId: 0 }, ++now), RankedMoveError);
  now = wrong.state.hideAt;
  assert.ok(frame(wrong.state, now).cards.every((card) => card.word === null));
  const guided = moveRanked(wrong.state, { type: "hint" }, ++now);
  assert.equal(guided.hintContext.skillId, "tambalan");
  state = guided.state;
  for (let boardIndex = 0; boardIndex < 3; boardIndex += 1) {
    const board = state.boards[boardIndex];
    assert.equal(frame(state, now).cards.length, 6 + 2 * boardIndex);
    for (const [index, pair] of board.pairs.entries()) {
      const pairCards = board.cards.map((card, id) => ({ card, id })).filter(({ card }) => card.pair.compound === pair.compound);
      state = moveRanked(state, { type: "flip", cardId: pairCards[0].id }, ++now).state;
      const result = moveRanked(state, { type: "flip", cardId: pairCards[1].id }, ++now);
      assert.equal(result.complete, boardIndex === 2 && index === board.pairs.length - 1);
      state = result.state;
      assert.equal(result.observations[0].correct, true);
    }
    assert.equal(state.feedback.kind, "board-complete");
    if (boardIndex < 2) state = moveRanked(state, { type: "next" }, ++now).state;
  }
  assert.equal(state.results.length, 12);
  assert.equal(state.score, 1160);
  assert.equal(state.xp, 100);
  assert.equal(moveRanked(createRankedState(4, "ranked"), { type: "abandon" }).abandon, true);
});

Deno.test("Memory advances after three mismatches and refills its hearts", () => {
  let now = epoch;
  let state = createRankedState(4, "ranked", now);
  const board = state.boards[0];
  const mismatch = board.cards.findIndex((card) => card.pair.compound !== board.cards[0].pair.compound);
  for (let attempt = 0; attempt < 3; attempt++) {
    state = moveRanked(state, { type: "flip", cardId: 0 }, now).state;
    state = moveRanked(state, { type: "flip", cardId: mismatch }, ++now).state;
    assert.equal(frame(state, now).hearts, 2 - attempt);
    now = state.hideAt;
  }
  assert.equal(state.phase, "review");
  assert.ok(state.feedback.answer);
  const next = moveRanked(state, { type: "next" }, now).state;
  assert.equal(next.round, 1);
  assert.equal(next.hearts, 3);
});
