# PandiWasto rollout and acceptance

## Implemented

- All seven games require an account. The Supabase `arcade` Edge Function validates sessions and saves progress, attempt observations, and leaderboard results. Whack-a-Word practice awards account XP without publishing a ranked score.
- BKT runs once in the database (`pandiwasto_private.bkt_apply`) with the formulas tested in `supabase/functions/arcade/bkt.ts`. Mastery records `mastered_at` at the skill's threshold (0.95). Priors come from the pretest subscore per skill, clamped to [0.1, 0.9], or 0.3. Parameter changes raise `param_version`, which every scored answer stores.
- Only first unaided answers update mastery. Later attempts, hinted answers, and timeouts are retained with their flags so mastery can be recomputed under other rules.
- Hints use a three-level ladder in six games (not Whack-a-Word). The optional Gemini adapter rephrases each level on the server for all six games, with a leak check, a 2.2-second timeout, an in-memory cache, an hourly cap, and authored fallbacks. Every hint is logged in `arcade_hints`.
- Study conditions: A gives a hint after a wrong answer when mastery is below 0.70 or has stalled below the mastery threshold over the last three updates. B gives a hint after two misses in a row on the same skill. C gives no hints. Each ladder level counts toward the cap of four hints per run.
- Admin manages accounts (create, role, suspend, restore), classes, score moderation, cohorts, assessments, invitations, and paginated pseudonymized exports of assessments, attempts, and hints.
- Teachers create and manage their own classes (students only, every change logged) and read per-skill mastery, a CSV download, and each student's latest answers. Admins manage every class and assign teachers.
- Teachers and admins see the same Rankings as learners; admins can hide or restore a score there.
- Admin Settings edits BKT parameters per skill (each save is a new version kept for exports), shows the hint policy, and tests the AI hint provider. Study stays admin-only because it holds consent records and blinded group assignments.

## Staging and verification

1. Install Node.js 24 and Deno. Run `npm run install-all` from the repository root.
2. Apply the migrations in order to staging and deploy the `arcade` function there. Set the frontend Supabase URL and browser publishable key. Configure Supabase email sign-in and confirmation redirects. Store provider credentials in Edge Function secrets.
3. Run `deno test --config supabase/functions/arcade/deno.json supabase/functions/arcade`, `npm run lint --prefix frontend`, and `npm run build --prefix frontend`. Check `/functions/v1/arcade/health`, then sign in with two confirmed staging accounts. Play and retry a run, confirm cross-device XP and rankings, and verify that ordinary learners receive no admin or class access. Test authorized score hide and restore in Rankings.
4. Assign the first administrator by inserting the confirmed account's user ID into `pandiwasto_private.arcade_admins` through an authorized database operator. Later admins and teachers are set in Admin → Accounts. Verify account creation, suspension (the account can no longer play), class setup, the teacher's class view, cohort setup, acceptance and withdrawal, separate assessment scoring, study unlocking, and an export that contains no account IDs or email addresses.
5. Before enabling generated hints, supply `GEMINI_API_KEY` in the server environment. Run the provider and authored fallback acceptance checks with staging data. The Gemini adapter uses the [GenerateContent API](https://ai.google.dev/api/generate-content).

## Before a real study

Confirm the cohort protocol and approvals, learner consent workflow, Filipino assessment items, target schools and sample, and evaluation plan. Have a Filipino-language expert review the lesson text in `supabase/functions/arcade/items/lessons.ts`, because hint levels 2 and 3 reuse it. Calibrate BKT parameters on pilot data with `scripts/fit-bkt.ts` before drawing research conclusions. The hint cache and hourly cap are per Edge Function instance. Shared rate limiting, provider-level usage reporting, and adaptive item selection remain separate tasks. Keep deployments unconfigured for research until the approved cohort and reviewed forms are in place.
