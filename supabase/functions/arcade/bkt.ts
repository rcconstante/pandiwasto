// Classic Bayesian Knowledge Tracing (Corbett & Anderson, 1994).
// Pure functions only: the SQL engine in the migrations must give the same results.

export interface BktParams {
  /** P(L0): probability the skill is known before the first answer. */
  initial: number;
  /** P(T): probability of learning the skill after each answer. */
  learn: number;
  /** P(G): probability of a correct answer without knowing the skill. */
  guess: number;
  /** P(S): probability of a wrong answer despite knowing the skill. */
  slip: number;
}

export interface BktStep {
  correct: boolean;
  /** Mastery before this answer. */
  before: number;
  /** Predicted P(correct) before this answer. */
  predicted: number;
  /** Mastery after this answer, including the learning step. */
  after: number;
}

export const MASTERY_THRESHOLD = 0.95;

function probability(name: string, value: number, open = false) {
  const valid = Number.isFinite(value) && (open ? value > 0 && value < 1 : value >= 0 && value <= 1);
  if (!valid) throw new RangeError(`${name} must be a probability ${open ? "in (0, 1)" : "in [0, 1]"}, got ${value}.`);
}

function check(pL: number, p: BktParams) {
  probability("P(L)", pL);
  probability("P(T)", p.learn);
  probability("P(G)", p.guess, true);
  probability("P(S)", p.slip, true);
}

/** P(correct) = P(L)(1 - S) + (1 - P(L))G */
export function pCorrect(pL: number, p: BktParams): number {
  check(pL, p);
  return pL * (1 - p.slip) + (1 - pL) * p.guess;
}

/** Posterior P(L | answer), before the learning step. */
export function posterior(pL: number, correct: boolean, p: BktParams): number {
  check(pL, p);
  const { guess: g, slip: s } = p;
  return correct
    ? (pL * (1 - s)) / (pL * (1 - s) + (1 - pL) * g)
    : (pL * s) / (pL * s + (1 - pL) * (1 - g));
}

/** P(L next) = P(L | answer) + (1 - P(L | answer))T */
export function bktUpdate(pL: number, correct: boolean, p: BktParams): number {
  const post = posterior(pL, correct, p);
  return post + (1 - post) * p.learn;
}

export function isMastered(pL: number, threshold = MASTERY_THRESHOLD): boolean {
  return pL >= threshold;
}

export interface BktFit extends BktParams {
  logLoss: number;
  rmse: number;
  answers: number;
}

/**
 * Brute-force grid search (as in BKT-BF) over P(L0), P(T) and P(S) < 0.3, with P(G) fixed
 * at the item's chance level. Each sequence is one student's scored answers on one skill.
 */
export function fitGrid(sequences: readonly (readonly boolean[])[], guess: number, step = 0.02): BktFit {
  const answers = sequences.reduce((total, sequence) => total + sequence.length, 0);
  if (!answers) throw new RangeError("No scored answers to fit.");
  const grid = (from: number, to: number) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, index) => Number((from + index * step).toFixed(6)));
  let best: BktFit | undefined;
  for (const initial of grid(step, 1 - step)) {
    for (const learn of grid(0, 0.5)) {
      for (const slip of grid(step, 0.3 - step)) {
        const params = { initial, learn, guess, slip };
        let loss = 0;
        let squared = 0;
        for (const sequence of sequences) {
          for (const { correct, predicted } of replay(sequence, params)) {
            const p = Math.min(1 - 1e-9, Math.max(1e-9, predicted));
            loss -= Math.log(correct ? p : 1 - p);
            squared += (Number(correct) - predicted) ** 2;
          }
        }
        if (!best || loss / answers < best.logLoss) best = { ...params, logLoss: loss / answers, rmse: Math.sqrt(squared / answers), answers };
      }
    }
  }
  return best!;
}

/** Replays one student's answers on one skill, starting from P(L0). */
export function replay(answers: readonly boolean[], p: BktParams, start = p.initial): BktStep[] {
  probability("P(L0)", start);
  let pL = start;
  return answers.map((correct) => {
    const step = { correct, before: pL, predicted: pCorrect(pL, p), after: bktUpdate(pL, correct, p) };
    pL = step.after;
    return step;
  });
}

/** Area under the ROC curve (ties count half); 0.5 is chance. */
export function auc(points: readonly { correct: boolean; predicted: number }[]): number {
  const positives = points.filter((point) => point.correct).length;
  const negatives = points.length - positives;
  if (!positives || !negatives) throw new RangeError("AUC needs both correct and wrong answers.");
  const sorted = [...points].sort((a, b) => a.predicted - b.predicted);
  let rankSum = 0;
  for (let start = 0; start < sorted.length;) {
    let end = start;
    while (end < sorted.length && sorted[end].predicted === sorted[start].predicted) end += 1;
    const rank = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) if (sorted[index].correct) rankSum += rank;
    start = end;
  }
  return (rankSum - positives * (positives + 1) / 2) / (positives * negatives);
}

export interface CrossValidation {
  folds: number;
  answers: number;
  auc: number;
  rmse: number;
  /** RMSE of always predicting the training folds' mean correctness. */
  baselineRmse: number;
}

/** Student-level k-fold cross-validation: fit on k-1 folds, predict the held-out students. */
export function crossValidate(sequences: readonly (readonly boolean[])[], guess: number, folds = 5, step = 0.02): CrossValidation {
  if (folds < 2 || sequences.length < folds) throw new RangeError(`Need at least ${folds} students for ${folds}-fold validation.`);
  const held: { correct: boolean; predicted: number }[] = [];
  let baselineSquared = 0;
  for (let fold = 0; fold < folds; fold += 1) {
    const train = sequences.filter((_, index) => index % folds !== fold);
    const test = sequences.filter((_, index) => index % folds === fold);
    const params = fitGrid(train, guess, step);
    const trainAnswers = train.flat();
    const mean = trainAnswers.filter(Boolean).length / trainAnswers.length;
    for (const sequence of test) {
      for (const { correct, predicted } of replay(sequence, params)) {
        held.push({ correct, predicted });
        baselineSquared += (Number(correct) - mean) ** 2;
      }
    }
  }
  const squared = held.reduce((total, point) => total + (Number(point.correct) - point.predicted) ** 2, 0);
  return { folds, answers: held.length, auc: auc(held), rmse: Math.sqrt(squared / held.length), baselineRmse: Math.sqrt(baselineSquared / held.length) };
}
