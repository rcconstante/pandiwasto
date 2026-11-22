# BKT and hints: gap report and plan

Date: 2026-11-23. The audit below was written before the changes. The next section records what was implemented the same day.

## Implementation status (2026-11-23)

| Item | Status |
| --- | --- |
| B1 BKT module and tests | Done. `bkt.ts` matches an independent HMM reference. SQL now has one `bkt_apply` function. |
| B2 Mastery threshold | Done. 0.95 per skill (`mastery_threshold`), with `mastered_at` and a "Mastered" mark in Lessons. |
| B3 Guess ceiling | Kept on purpose: P(G) is fixed at each game's chance level (bkt.pdf p.19). The 0.3 ceiling applies when fitting. |
| B4 Pretest prior | Done. The pretest subscore per skill is clamped to [0.1, 0.9], with a default of 0.3. |
| B5 Parameter version | Done. `param_version` rises on every parameter change and is stored on every answer and export row. |
| B6 Replay and fitting | Done. `replay` and `fitGrid` are in `bkt.ts`, and `scripts/fit-bkt.ts` fits a skill. No Python is needed. |
| B8 Timeouts | Kept: timeouts are excluded from BKT but logged with `timed_out`, so both rules can be analysed. |
| B9 Hinted answers | Kept: excluded from BKT but logged with `hint_used`, so a sensitivity analysis is possible. |
| B10 Skill list | Kept at 10 skills (the skill.md baseline). Moving to 13 needs the client and the game items. |
| B11 Researcher table | Done. The Classes tab has a student × skill table and a CSV download. |
| H1/H3/H4/H5/H8 Hints | Done. A three-level ladder runs in six games, with the LLM in all six, a leak check, a cache, an hourly cap, and a hint log. |
| H2 Whack-a-Word hints | Kept off: it is a timed game, and all study conditions treat it the same way. |
| H6/H7 Triggers | Done. A adds the stall rule; B counts misses on the same skill. |
| I1/D1/D2 Item bank and adaptive selection | Not started. skill.md does not require them, and they need Filipino content review. |
| Accounts, roles, classes, teachers | Done. Admins create accounts and set roles; teachers see only their own classes. |

Sources compared:

- `bkt.pdf`: the client's planning notes (pages 12–32 hold the PandiWasto BKT, hint and dynamic question spec)
- `PandiWasto-Draft.pdf`: the client's original draft (modules, games, 8 skills)
- `skill.md`: the project brief (10 skills, RQ1–RQ3, three hint conditions)
- `Technical-draft`: the local copy of the draft
- `IMPLEMENTATION.md`: what the repo says is done
- The code under `supabase/` and `frontend/src/`

## Short answer

| Area | Status |
| --- | --- |
| BKT algorithm | **Implemented** and mathematically correct. It runs server-side in PL/pgSQL, with one model per player per skill. |
| BKT engineering requirements | **Partial.** It has no standalone module, no unit tests, no mastery threshold, no pretest prior, no parameter versioning and no fitting script. |
| Hints | **Partial.** Authored hints exist for 6 of 7 games, and Whack-a-Word has none. The LLM (Gemini) runs only in Pop Goes the Word. There is no hint ladder, hint log or cache. |
| Hint study conditions (A/B/C) | **Implemented** at a basic level. The A trigger differs from the spec, and the "stalled mastery" rule is missing. |
| Item bank and dynamic questions | **Not implemented.** Items are hardcoded and dealt at random. Selection is not adaptive. |

## 1. What is already implemented (keep it)

- **BKT update formulas** match the spec exactly (`bkt.pdf` p.18–19 and `skill.md` §7.3):
  - correct: `L(1-S) / (L(1-S) + (1-L)G)`
  - wrong: `L·S / (L·S + (1-L)(1-G))`
  - learning step: `post + (1-post)·T`
  - Locations: `supabase/migrations/20261123000000_pandiwasto_round_hearts.sql:88-107` (Pop) and `:346-364` (games 2–7).
- **The engine runs on the server.** Clients cannot write mastery. Developer-mode runs are excluded.
- **Per-skill parameters** live in `pandiwasto_private.arcade_skills`: `initial_mastery`, `learn_rate`, `guess_rate` and `slip_rate`.
- **There are 10 skills**: salitang-ugat, kayarian-ng-salita, unlapi, gitlapi, hulapi, kabilaan, tambalan, pag-uulit, pokus-ng-pandiwa and asimilasyon. This matches the `skill.md` §6.3 baseline.
- **Toss-a-Lapi** tags each item with its affix type, so one game feeds four skills. This matches the brief.
- **Scoring rule:** only first, unaided and non-timeout answers update BKT. Every attempt is still logged with `correct`, `first_attempt`, `hint_used`, `timed_out`, `response_ms`, `mastery_before` and `mastery_after`.
- **One response** follows the spec: one mole, one submitted word, one pair attempt, one lever pull, one grab, one prediction or one drop.
- **The Lessons tab** shows "Estimated mastery N%" per skill (`frontend/src/pages/Dashboard.tsx:343`).
- **Study setup:**
  - Conditions A (BKT), B (fixed, 2 misses) and C (no hints) are assigned at random, balanced, hidden from students and enforced on the server (`20261122030000_pandiwasto_study.sql:363-397`).
  - Hints are capped at 4 per run.
  - The study also has cohorts, consent, withdrawal, pre- and post-assessments, a practice window and a pseudonymized export.
- **Gemini adapter** (`supabase/functions/arcade/gemini.js`, `hints.js`):
  - The key stays on the server.
  - Calls time out after 2.2 s.
  - Output is checked for answer leakage (the root word) and falls back to the authored hint.

## 2. Gaps against the client's spec

### 2a. BKT

| # | Gap | Spec source | Severity |
| --- | --- | --- | --- |
| B1 | The BKT math is **copy-pasted in 5 migrations** and lives only inside SQL functions. It has no standalone module, no unit tests and no reference-implementation check. | skill.md §7.4 "standalone testable module with unit tests"; Definition of done "matches a reference implementation"; bkt.pdf Phase 3 | High |
| B2 | There is **no mastery threshold** (0.95, configurable), no `mastered` flag and no `mastered_at`. | bkt.pdf p.19, p.25; skill.md §7.4 | High |
| B3 | **The guess and slip ceilings are broken**: pag-uulit has G = 0.50 and asimilasyon has G = 0.33, but the spec says G < 0.3. The spec itself suggests adding a third option to Ticket Stub. | bkt.pdf p.19, p.25 | Medium |
| B4 | **P(L0) does not come from the pretest subscore.** It is fixed at 0.25, while the spec wants a clamped [0.1, 0.9] pretest prior with a default of 0.3. | bkt.pdf p.19, p.25 | Medium |
| B5 | **There is no `bkt_param_version`** in the attempt and observation logs, so parameter changes cannot be audited. | bkt.pdf p.17, p.26 | Medium |
| B6 | **Mastery cannot be rebuilt from the logs.** There is no replay script and no fitting script (pyBKT or grid search), and no fitted-parameter report. | skill.md §7.4 "recomputed from the attempt log", "fitted parameters per skill" | Medium (needed after the pilot) |
| B7 | **Predicted correctness is not stored or exported.** It can be derived from `mastery_before` and the parameters, but only if the parameter version is known (see B5). | RQ1 AUC/RMSE | Low |
| B8 | **Timeout handling is hard-coded** as "exclude". The spec wants a `timeout_as_wrong` flag, or logging both ways. | bkt.pdf p.16, p.28 | Low |
| B9 | **Hinted answers are excluded** from the BKT update. The brief leaves this choice to the developer. It must be written down and justified. | skill.md §7.4 open decision | Decision |
| B10 | **Skill granularity is unresolved.** The code has 10 skills. `bkt.pdf` proposes 13 KCs (kayarian ×4, inuulit ganap/parsiyal, asimilasyon ganap/di-ganap). The draft has 8. | bkt.pdf p.15 vs skill.md §6.3 | **Client decision** |
| B11 | **There is no researcher per-KC table** (student × KC with p_L and attempts). Only a JSON export exists. | bkt.pdf Phase 4; skill.md "teacher view" (nice to have) | Low |

### 2b. Hints

| # | Gap | Spec source | Severity |
| --- | --- | --- | --- |
| H1 | **The LLM runs only in Pop Goes the Word.** The other 6 games use authored text only. | skill.md §8; IMPLEMENTATION.md admits it | High |
| H2 | **Whack-a-Word has no hints in any condition** (`ranked-games.js:147`, `gameId !== 2`). The game's whole skill is outside RQ2. | skill.md §5 | High (or a documented exclusion) |
| H3 | **There is no hint ladder.** Each item has one hint, but the spec wants level 1 nudge, level 2 rule plus an example with a different word, and level 3 structure without the answer. | bkt.pdf p.21; skill.md §8 | High |
| H4 | **There is no hint log table.** Nothing records trigger type, condition, prompt version, model, returned text, latency, tokens, cache hit, AI or fallback, `correct_on_next_attempt`, or the student's rating. Only `hint_used` and `hint_requested_at` exist. | bkt.pdf p.18; skill.md §6.5, §8 | High (RQ2/RQ3 cannot be analysed without it) |
| H5 | **The LLM prompt is too thin.** It sends only the word and the rule. The spec also wants the correct answer (to avoid), the teacher's explanation, the student's wrong answer, the mastery band and the hint level, with JSON output. | bkt.pdf p.21 | Medium |
| H6 | **The condition A trigger differs from the spec.** The code fires on "latest answer wrong AND P(L) < 0.70". `bkt.pdf` says "≥2 wrong AND P(L) < 0.5", and `skill.md` adds "or stalled over the last k attempts", which is missing. | bkt.pdf p.21; skill.md §5 | **Client decision** plus the stall rule |
| H7 | **Condition B counts misses wrongly.** It counts the last 2 observations in the run, not the same item or KC. In Memory Match and Toss-a-Lapi these can cross items or KCs. | bkt.pdf p.21 "same item or KC" | Medium |
| H8 | **Hints are not cached** by (item, wrong answer, level). There is also no cost cap and no shared rate limit. | bkt.pdf p.21–22; skill.md §8 | Medium |
| H9 | **There are no teacher-rubric or student-rating fields** for hints. | skill.md RQ3 | Medium |

### 2c. Item bank and dynamic questions

| # | Gap | Spec source | Severity |
| --- | --- | --- | --- |
| I1 | **Items for games 2–7 are hardcoded** in `supabase/functions/arcade/items/*.ts`. Only Pop uses the `arcade_items` table. Items have no `difficulty`, `chance_level`, `explanation`, `tags`, `status` or `validated_by` fields. | bkt.pdf p.17, Phase 1 | High (needed before H5 and D1) |
| D1 | **Item selection is not adaptive.** Runs are dealt at random. There is no `selectNextItem`, no `selection_reason` and no rule that picks the lowest non-mastered KC. | bkt.pdf §3.3, Phase 6 | Medium. `skill.md` does not require it, but `bkt.pdf` does. **Ask the client.** |
| D2 | **The bank is too small.** The spec wants 12–15 items per KC across 3 difficulty levels. Current banks hold about 5–7 words per type. | bkt.pdf p.23 | Content work (Filipino expert) |

### 2d. Documentation mismatches

- **Backend:** the draft and `skill.md` say Express or Next.js on Render. The real backend is Supabase Edge Functions plus PL/pgSQL. The brief allows changes "with reasons", so the client should approve this change in writing.
- **Skill count:** `Technical-draft` lists 8 skills, the code tracks 10, and `bkt.pdf` proposes 13. Pick one list and freeze it **before** any data collection (bkt.pdf p.16).
- **README status:** the README says the app "supports a study comparing three ways to deliver hints". That is true for timing, but the LLM content exists only in Pop.

## 3. Decisions the client must make first (Phase 0)

1. Choose the skill list: **10** (current) or **13** (`bkt.pdf`).
2. Choose the condition A trigger: keep "latest wrong and P(L) < 0.70", or use "≥2 wrong and P(L) < 0.5". Also set the stall window k.
3. Decide how answers given after a hint are handled: exclude them from BKT (current), or update BKT normally and run a sensitivity analysis.
4. Decide how timeouts are handled: exclude them (current), or count them as wrong.
5. Decide whether Whack-a-Word gets hints, or is documented as outside RQ2.
6. Decide whether dynamic question selection is in scope. The brief does not list it, but `bkt.pdf` does.
7. Set the mastery threshold: 0.95 or 0.90.
8. Choose the LLM provider. Gemini is used now, and the brief wants it to be swappable.
9. Confirm that the Supabase Edge Functions stack replaces Express or Next.js.

## 4. Phased plan (small changes, one commit each)

| Phase | Work | Files | Done when |
| --- | --- | --- | --- |
| **0. Decisions** | Freeze the answers to §3 in `docs/` | `docs/DECISIONS.md` | The client signs off |
| **1. BKT module** | Write a pure `bkt.ts` (`bktUpdate`, `pCorrect`, `isMastered`) with Deno tests: correct answers raise p_L, p_L stays in [0,1] over 1000 random sequences, values are never NaN, and simulated learners vs non-learners behave as expected. Compare the results against pyBKT or a reference implementation on a fixed dataset. | `supabase/functions/arcade/bkt.ts`, `bkt.test.ts` | Tests pass and match the reference |
| **2. One SQL BKT function** | Replace the 5 copy-pasted blocks with one `pandiwasto_private.bkt_apply(...)` function. Add `mastery_threshold`, `mastered` and `mastered_at`. Add `param_version` to the skills table and to every observation row. Add a SQL test that matches the TS module. | new migration | The same outputs as before, plus versioning |
| **3. Priors and constraints** | Seed P(L0) from the pretest per-skill subscore, clamped to [0.1, 0.9], with 0.3 as the default. Enforce G < 0.3 and S < 0.3, which means adding a third option to Ticket Stub and fixing asimilasyon. | migration, `ticketGame.ts`, frontend ticket UI | The check constraints hold |
| **4. Item bank** | Move the items for games 2–7 into `arcade_items`, with `kc`, `difficulty`, `chance_level`, `explanation`, `tags`, `status` and `validated_by`. Games read from the bank without any change to gameplay. Ambiguous items go to `MIGRATION_NOTES.md`. | migration, `items/*.ts`, `ranked-games.js` | All games run from the database; the item count per KC is reported |
| **5. Hint log, ladder and LLM for all games** | Add a `hint_log` table and a 3-level ladder. Build the LLM prompt only from bank data (answer to avoid, explanation, wrong answer, mastery band, level). Add a cache by (item, wrong answer, level), a cost cap and authored fallbacks per KC per level. Enable hints in Whack-a-Word if decided. | `hints.js`, `gemini.js`, `ranked-games.js`, migration, game UIs | Every hint row is logged, and fallback, leak-check and latency tests pass |
| **6. Trigger fixes** | Condition A: apply the agreed threshold and add the stall-over-k rule. Condition B: count misses per item or KC, not per run. | `allow_study_hint` migration | Tests cover both arms |
| **7. Dynamic selection (if in scope)** | Write `selectNextItem` as a pure function: lowest non-mastered KC first, difficulty chosen from p_L, no repeats, every 5th item a review, and `selection_reason` logged. | `selection.ts`, `ranked-games.js` | Unit tests pass, including the case where a KC's items run out |
| **8. Research tooling** | Add a per-KC researcher table, a replay script that rebuilds mastery from the logs, a pyBKT or grid-search fitting script, and an export with `p_correct` for AUC/RMSE. | admin page, `scripts/` | The pilot data fits and a parameter table is produced |

Order rationale: tests come first (1) so the refactor (2) is safe. The item bank (4) must exist before LLM grounding (5). Selection (7) depends on 2 and 4.

## 5. Things not checked

- The pre/post-assessment items were not checked for per-KC tagging (RQ1 needs per-KC subscores).
- Profile Danger Zone (change email and password) and other non-BKT modules were only skimmed.
- Nothing was run. Tests, lint and the build were not executed in this audit.
