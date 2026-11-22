# PandiWasto

PandiWasto teaches Filipino morphology through seven arcade games. The app uses React, TypeScript, Vite, Express, and Supabase.

## Run locally

1. Install Node.js LTS.
2. Run `npm run install-all` from the repository root.
3. Run `npm run dev` and open [PandiWasto](http://localhost:5173).
4. Open **Log in → Preview the dashboard** to play with a local player profile.

The frontend can run on its own with `npm run dev:frontend`. For the Express connection test, copy `backend/.env.example` to `backend/.env` and fill in the project’s Supabase values.

## Arcade games

Players start at Level 1. Every 100 XP raises the player one level.

| Game | Unlock | Lesson and controls | Scoring and XP |
| --- | ---: | --- | --- |
| Pop Goes the Word | 1 | **Salitang-Ugat**. Pop extra letters, then check the root word. Tap a popped spot to restore its balloon. | Five rounds with three hearts per run. Each wrong check costs a heart. Solved rounds earn up to 100 points and 20 XP each. Running out of hearts saves the points and XP already earned. |
| Whack-a-Word | 3 | **Kayarian ng Salita**. Pick Payak, Maylapi, Tambalan, or Inuulit before the mole ducks. The 1–4 keys also select a type. | Three lives. Each correct answer earns 100 points and 10 XP. A miss or timeout costs one life. Untimed practice earns XP. Only timed runs save a best score. |
| Toss-a-Lapi | 5 | **Mga Panlapi**. Tap or drag an affix tile into each sentence. | Five rounds, up to 500 points, and 100 XP on completion. |
| Memory Match | 7 | **Tambalan**. Flip cards in pairs to combine root words. Each board ends with a review of the compounds and their meanings. | Three boards with 6, 8, and 10 cards. Up to 1,200 points and 100 XP on completion. |
| Ticket Stub Dispenser | 9 | **Pag-uulit**. Pull the Ganap or Parsiyal lever to print a pair of full tickets or a full ticket with a short stub. | Five rounds, up to 500 points, and 100 XP on completion. |
| Claw Machine | 11 | **Pokus ng Pandiwa**. Aim with the arrow buttons or pick a doll, then press Grab. Each run covers Tagaganap, Layon, Ganapan, and Tagatanggap. | Five rounds, up to 500 points, and 100 XP on completion. |
| Fortune Predict | 13 | **Asimilasyon**. Predict whether pang- becomes pam-, becomes pan-, or stays pang- when joined to a root word. Choose the word and print the card. | Five rounds, up to 500 points, and 100 XP on completion. |

The arcade has animated score updates, visual success and retry cues, and a sound toggle in every game. Sound starts on. Motion effects respect the browser’s reduced-motion preference. Use the Lessons tab for examples and links to each game.

## Account play and database setup

1. Apply all six [migrations](supabase/migrations) in filename order to a staging Supabase project, then verify the staging rollout before applying them to production.
2. Copy `frontend/.env.local.example` to `frontend/.env.local`. Set `VITE_API_URL`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY` using the project’s browser publishable key.
3. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `CLIENT_URL` in `backend/.env`. Use the service role only from the server. Enable email sign-in and add the landing page URL to the Supabase Auth redirect allowlist.
4. Use Node.js 24 and start the app with `npm run dev` from the repository root. After confirming their email, players can sign in and earn account progress in all seven games.

In Preview, all seven games save XP and scores in the browser. When account play is configured, the server validates moves before saving account XP, levels, and best scores. Signed-in Rankings shows generated aliases, avatar icons, levels, and validated scores. Whack-a-Word practice earns XP and stays out of Rankings. The header avatar opens the menu for Profile, Settings, and Sign out.

## Administration and study

- **Admin** can look up a score by player alias or account ID and hide or restore it with a recorded reason. Admins can also configure a cohort, add separate pre- and post-assessments, and invite approved participants.
- **Study** shows invitations, participation and withdrawal controls, assessments, and the scheduled practice window. The database assigns conditions privately and excludes withdrawn participants from future research exports.
- **Mastery** in Lessons is based on recorded first unaided answers across the ten configured skills. Authored hints work locally. Account Pop Goes the Word supports the optional server-only Gemini provider and falls back to an authored hint on failure.

The [implementation plan](IMPLEMENTATION.md) lists the database rollout, backend and admin interfaces, per-game validation work, security tests, and research dependencies. See also the [technical draft](Technical-draft) and [research brief](skill.md).
