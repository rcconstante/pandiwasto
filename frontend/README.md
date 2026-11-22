# PandiWasto frontend

This workspace contains the landing page, email sign-in, learner dashboard, and seven Filipino morphology games. Use the [project README](../README.md) for setup and gameplay rules.

## Local development

Run `npm install` and `npm run dev` from `frontend`. Open **Log in → Preview the dashboard** to play with a local profile. Use `npm run build` and `npm run lint` to check changes.

For email accounts, configure `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_API_URL` in `.env.local`. Signup assigns a display name and one of ten avatars. The header opens a read-only Profile with the player’s avatar, name, level, and XP. Use Settings to edit the avatar, display name, first name, last name, and optional gender.

## Integration status

- **Account play.** The dashboard loads server-owned XP and best scores. All seven account games validate moves on the server. Preview uses device storage.
- **Live rankings.** Signed-in rankings read the validated best scores from Supabase. Whack-a-Word practice earns XP outside Rankings.
- **Mastery and hints.** Lessons displays mastery for skills with qualifying account answers. The optional Gemini adapter for Pop Goes the Word and its authored fallback run on the server.
- **Admin and Study.** Authorized accounts can review scores, moderate rankings, manage cohorts and assessments, and download pseudonymized exports. Invited learners can review participation, play, and complete their assessments in Study.

See the [rollout and acceptance plan](../IMPLEMENTATION.md) for staging setup, security acceptance checks, and study requirements.
