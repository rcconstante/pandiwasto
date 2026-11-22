# PandiWasto rollout and acceptance

## Implemented

- All seven games require an account. The Supabase `arcade` Edge Function validates sessions and saves progress, attempt observations, and leaderboard results. Whack-a-Word practice awards account XP without publishing a ranked score.
- Admin provides alias and account-ID score lookup, hide and restore actions with recorded reasons, cohort setup, participant invitations, assessment authoring, and paginated pseudonymized JSON exports.
- Study provides private balanced assignments, participant affirmation and withdrawal, parallel pre- and post-assessments with server-owned answer keys, and a scheduled practice window. The three hint policies are low mastery after a miss, two consecutive misses, and no hints. The low-mastery threshold is 0.70 and the hint cap is four per run. Eligible study clues appear automatically in games with hints.
- Lessons shows BKT estimates for the ten configured skills once qualifying attempts exist. Only first unaided observations update mastery. Later attempts and timeouts are retained where applicable. These are starting rules for pilot calibration.
- The optional Gemini REST adapter runs only on the backend for Pop Goes the Word. Other games use authored hints. Authored hints also cover timeouts, malformed output, answer leakage, or provider failure.

## Staging and verification

1. Install Node.js 24 and Deno. Run `npm run install-all` from the repository root.
2. Apply the migrations in order to staging and deploy the `arcade` function there. Set the frontend Supabase URL and browser publishable key. Configure Supabase email sign-in and confirmation redirects. Store provider credentials in Edge Function secrets.
3. Run `deno test --config supabase/functions/arcade/deno.json supabase/functions/arcade`, `npm run lint --prefix frontend`, and `npm run build --prefix frontend`. Check `/functions/v1/arcade/health`, then sign in with two confirmed staging accounts. Play and retry a run, confirm cross-device XP and rankings, and verify that ordinary learners receive no admin access. Test authorized score hide and restore in Rankings.
4. Assign an administrator by inserting the confirmed account’s user ID into `pandiwasto_private.arcade_admins` through an authorized database operator. Verify score lookup, setup of a disposable approved cohort, acceptance and withdrawal, separate assessment scoring, study unlocking, and an export that contains no account IDs or email addresses.
5. Before enabling generated hints, supply `GEMINI_API_KEY` in the server environment. Run the provider and authored fallback acceptance checks with staging data. The Gemini adapter uses the [GenerateContent API](https://ai.google.dev/api/generate-content).

## Before a real study

Confirm the cohort protocol and approvals, learner consent workflow, Filipino assessment items, target schools and sample, and evaluation plan. Calibrate BKT priors and timing in a pilot and compare the engine with a reference before drawing research conclusions. Stalled-mastery detection, generated hints for the other games, provider-level usage reporting, and multi-instance rate limiting remain separate rollout tasks. Current exports cover pseudonymized assessments and attempts and support paginated downloads. Keep deployments unconfigured for research until the approved cohort and reviewed forms are in place.
