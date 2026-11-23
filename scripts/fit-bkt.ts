// Fit one skill's BKT parameters from Admin "Game attempts" export pages.
// deno run --allow-read scripts/fit-bkt.ts --skill asimilasyon --guess 0.33 [--folds 5] page-1.json page-2.json
// --folds adds student-level cross-validation (held-out AUC and RMSE) for the research report.
import { crossValidate, fitGrid } from "../supabase/functions/arcade/bkt.ts";

interface Attempt {
  participantId: string;
  skill: string;
  correct: boolean;
  masteryBefore: number | null;
  recordedAt: string;
}

const args = [...Deno.args];
const option = (name: string) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args.splice(index, 2)[1];
};
const skill = option("--skill");
const guess = Number(option("--guess"));
const folds = Number(option("--folds") ?? 0);
if (!skill || !(guess > 0 && guess < 1) || !Number.isInteger(folds) || folds === 1 || folds < 0 || !args.length) {
  console.error("Usage: --skill <skill-id> --guess <chance level> [--folds <k ≥ 2>] <export page.json>...");
  Deno.exit(1);
}

// Only answers that updated BKT carry masteryBefore (first attempts; timeouts only when Settings count them).
const byStudent = new Map<string, Attempt[]>();
for (const file of args) {
  const page = JSON.parse((await Deno.readTextFile(file)).replace(/^﻿/, "")) as { dataset: string; records: Attempt[] };
  if (page.dataset !== "attempt") throw new Error(file + " is not a Game attempts export.");
  for (const record of page.records) {
    if (record.skill !== skill || record.masteryBefore === null) continue;
    byStudent.set(record.participantId, [...(byStudent.get(record.participantId) ?? []), record]);
  }
}
const sequences = [...byStudent.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, records]) =>
  records.sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt)).map((record) => record.correct));
const fit = fitGrid(sequences, guess);
const mean = sequences.flat().filter(Boolean).length / fit.answers;
console.log(JSON.stringify({
  skill, students: sequences.length, ...fit,
  baselineRmse: Math.sqrt(sequences.flat().reduce((total, correct) => total + (Number(correct) - mean) ** 2, 0) / fit.answers),
  ...(folds ? { crossValidation: crossValidate(sequences, guess, folds) } : {}),
}, null, 2));
