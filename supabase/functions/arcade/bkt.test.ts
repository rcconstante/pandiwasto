import assert from "node:assert/strict";
import { auc, type BktParams, bktUpdate, crossValidate, fitGrid, isMastered, MASTERY_THRESHOLD, pCorrect, posterior, replay } from "./bkt.ts";

// Seeded values from the arcade_skills migrations.
const SALITANG_UGAT: BktParams = { initial: 0.25, learn: 0.15, guess: 0.10, slip: 0.10 };
const KAYARIAN: BktParams = { initial: 0.25, learn: 0.15, guess: 0.25, slip: 0.10 };

const close = (actual: number, expected: number, digits = 10) =>
  assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} != ${expected}`);

// Deterministic PRNG (mulberry32) so simulations never flake.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Independent reference: BKT written as a two-state HMM forward filter
// (the formulation used by pyBKT and BNT-SM), not as the closed-form rules.
function hmmReference(answers: readonly boolean[], p: BktParams): number[] {
  let state = [1 - p.initial, p.initial]; // [unknown, known]
  return answers.map((correct) => {
    const emission = correct ? [p.guess, 1 - p.slip] : [1 - p.guess, p.slip];
    const joint = [state[0] * emission[0], state[1] * emission[1]];
    const total = joint[0] + joint[1];
    const filtered = [joint[0] / total, joint[1] / total];
    state = [filtered[0] * (1 - p.learn), filtered[0] * p.learn + filtered[1]];
    return state[1];
  });
}

Deno.test("matches hand-computed values for the seeded parameters", () => {
  close(pCorrect(0.25, SALITANG_UGAT), 0.3);
  close(posterior(0.25, true, SALITANG_UGAT), 0.75);
  close(bktUpdate(0.25, true, SALITANG_UGAT), 0.7875);
  close(bktUpdate(0.25, false, SALITANG_UGAT), 0.025 / 0.7 + (1 - 0.025 / 0.7) * 0.15);
  close(bktUpdate(0.25, true, KAYARIAN), 0.225 / 0.4125 + (1 - 0.225 / 0.4125) * 0.15);
  close(bktUpdate(0.25, false, KAYARIAN), 0.025 / 0.5875 + (1 - 0.025 / 0.5875) * 0.15);
});

Deno.test("matches the HMM forward-filter reference on random sequences", () => {
  const next = random(7);
  for (let run = 0; run < 200; run++) {
    const p: BktParams = { initial: next(), learn: next() * 0.5, guess: 0.01 + next() * 0.29, slip: 0.01 + next() * 0.29 };
    const answers = Array.from({ length: 40 }, () => next() < 0.6);
    const expected = hmmReference(answers, p);
    replay(answers, p).forEach((step, index) => close(step.after, expected[index], 9));
  }
});

Deno.test("a correct answer raises mastery and a wrong answer lowers it", () => {
  for (const pL of [0.05, 0.25, 0.5, 0.8]) {
    assert.ok(posterior(pL, true, KAYARIAN) > pL);
    assert.ok(posterior(pL, false, KAYARIAN) < pL);
    assert.ok(bktUpdate(pL, true, KAYARIAN) > bktUpdate(pL, false, KAYARIAN));
  }
});

Deno.test("mastery stays a finite probability over 1000 random sequences", () => {
  const next = random(42);
  for (let run = 0; run < 1000; run++) {
    const p: BktParams = { initial: next(), learn: next(), guess: 0.001 + next() * 0.298, slip: 0.001 + next() * 0.298 };
    for (const step of replay(Array.from({ length: 50 }, () => next() < 0.5), p)) {
      for (const value of [step.before, step.predicted, step.after]) {
        assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, `out of range: ${value}`);
      }
    }
  }
});

Deno.test("long wrong streaks and certain priors never produce NaN", () => {
  for (const start of [0, 1]) {
    for (const step of replay(Array(500).fill(false), { ...KAYARIAN, learn: 0 }, start)) {
      assert.ok(!Number.isNaN(step.after));
    }
  }
  assert.equal(bktUpdate(1, false, KAYARIAN), 1);
  assert.equal(bktUpdate(0, true, { ...KAYARIAN, learn: 0 }), 0);
});

Deno.test("rejects values that are not probabilities", () => {
  assert.throws(() => bktUpdate(1.2, true, KAYARIAN), RangeError);
  assert.throws(() => bktUpdate(Number.NaN, true, KAYARIAN), RangeError);
  assert.throws(() => pCorrect(0.5, { ...KAYARIAN, guess: 0 }), RangeError);
  assert.throws(() => pCorrect(0.5, { ...KAYARIAN, slip: 1 }), RangeError);
  assert.throws(() => replay([true], KAYARIAN, -0.1), RangeError);
});

Deno.test("mastery threshold defaults to 0.95 and is configurable", () => {
  assert.equal(MASTERY_THRESHOLD, 0.95);
  assert.ok(isMastered(0.95));
  assert.ok(!isMastered(0.9499));
  assert.ok(isMastered(0.91, 0.9));
});

Deno.test("grid fitting recovers simulated parameters within the grid tolerance", () => {
  const truth: BktParams = { initial: 0.2, learn: 0.2, guess: 0.25, slip: 0.1 };
  const next = random(99);
  const sequences = Array.from({ length: 300 }, () => simulate(truth.learn, truth, 20, next));
  const fit = fitGrid(sequences, truth.guess, 0.05);
  assert.equal(fit.guess, 0.25);
  assert.equal(fit.answers, 6000);
  assert.ok(Math.abs(fit.initial - truth.initial) <= 0.1, `P(L0) ${fit.initial}`);
  assert.ok(Math.abs(fit.learn - truth.learn) <= 0.1, `P(T) ${fit.learn}`);
  assert.ok(Math.abs(fit.slip - truth.slip) <= 0.1 && fit.slip < 0.3, `P(S) ${fit.slip}`);
  assert.throws(() => fitGrid([], 0.25), RangeError);
});

Deno.test("AUC ranks predictions and cross-validation beats the mean baseline", () => {
  assert.equal(auc([{ correct: false, predicted: 0.2 }, { correct: true, predicted: 0.8 }]), 1);
  assert.equal(auc([{ correct: true, predicted: 0.5 }, { correct: false, predicted: 0.5 }]), 0.5);
  assert.throws(() => auc([{ correct: true, predicted: 0.5 }]), RangeError);
  const truth: BktParams = { initial: 0.2, learn: 0.2, guess: 0.25, slip: 0.1 };
  const next = random(7);
  const sequences = Array.from({ length: 100 }, () => simulate(truth.learn, truth, 15, next));
  const result = crossValidate(sequences, truth.guess, 5, 0.1);
  assert.equal(result.answers, 1500);
  assert.ok(result.auc > 0.7, `AUC ${result.auc}`);
  assert.ok(result.rmse < result.baselineRmse, `RMSE ${result.rmse} vs ${result.baselineRmse}`);
  assert.throws(() => crossValidate(sequences.slice(0, 3), 0.25, 5), RangeError);
});

// Simulated students: hidden true knowledge, answers drawn through guess and slip.
function simulate(trueLearn: number, p: BktParams, answers: number, next: () => number) {
  let knows = next() < p.initial;
  return Array.from({ length: answers }, () => {
    const correct = knows ? next() >= p.slip : next() < p.guess;
    if (!knows && next() < trueLearn) knows = true;
    return correct;
  });
}

Deno.test("simulated learners reach mastery and non-learners stay low", () => {
  const next = random(2026);
  const students = 100;
  const answers = 30;
  let learnersMastered = 0;
  let nonLearnerTotal = 0;
  for (let i = 0; i < students; i++) {
    const learner = replay(simulate(0.2, KAYARIAN, answers, next), KAYARIAN);
    if (learner.some((step) => isMastered(step.after))) learnersMastered++;
    const nonLearner = replay(simulate(0, { ...KAYARIAN, initial: 0 }, answers, next), KAYARIAN);
    nonLearnerTotal += nonLearner.at(-1)!.after;
  }
  assert.ok(learnersMastered >= 90, `only ${learnersMastered}/${students} learners reached mastery`);
  assert.ok(nonLearnerTotal / students < 0.5, `non-learner mean ${nonLearnerTotal / students}`);
});
