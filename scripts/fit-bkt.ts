// Fit one skill's BKT parameters from Admin "Game attempts" export pages.
// deno run --allow-read scripts/fit-bkt.ts --skill asimilasyon --guess 0.33 page-1.json page-2.json
import { fitGrid } from "../supabase/functions/arcade/bkt.ts";

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
if (!skill || !(guess > 0 && guess < 1) || !args.length) {
  console.error("Usage: --skill <skill-id> --guess <chance level> <export page.json>...");
  Deno.exit(1);
}

// Only answers that updated BKT (first, unaided, not timed out) carry masteryBefore.
const byStudent = new Map<string, Attempt[]>();
for (const file of args) {
  const page = JSON.parse((await Deno.readTextFile(file)).replace(/^﻿/, "")) as { dataset: string; records: Attempt[] };
  if (page.dataset !== "attempt") throw new Error(file + " is not a Game attempts export.");
  for (const record of page.records) {
    if (record.skill !== skill || record.masteryBefore === null) continue;
    byStudent.set(record.participantId, [...(byStudent.get(record.participantId) ?? []), record]);
  }
}
const sequences = [...byStudent.values()].map((records) =>
  records.sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt)).map((record) => record.correct));
const fit = fitGrid(sequences, guess);
const mean = sequences.flat().filter(Boolean).length / fit.answers;
console.log(JSON.stringify({
  skill, students: sequences.length, ...fit,
  baselineRmse: Math.sqrt(sequences.flat().reduce((total, correct) => total + (Number(correct) - mean) ** 2, 0) / fit.answers),
}, null, 2));
