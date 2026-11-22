

Skill-Level Knowledge Tracing with
Targeted LLM Hints in Gamified Learning:
Design and Validation
Project brief and candidate requirements for PandiWasto, a gamified Filipino word-
formation learning app
Prepared by [Your Name] · [Institution / Program] · Version 1.0 · November 21, 2026 · For
candidate review
- The Project in Brief
PandiWasto is a web app that teaches Filipino word formation (morpolohiya) through
seven minigames, one for each lesson. Every answer a student gives is scored right or
wrong and fed into a Bayesian Knowledge Tracing (BKT) model, which estimates, skill by
skill, how likely the student has really learned it. When a student struggles, a large
language model (LLM) writes a short, targeted hint in Filipino.
The research asks two things. First, is minigame performance a valid basis for judging
what a student knows? Second, does giving hints based on that judgment help students
more than the usual rule of giving a hint after a wrong answer?
ItemDetail
SystemGamified web app with 7 minigames, XP and levels,
lessons, and user profiles
ResearchBKT-based skill diagnosis plus LLM hints, tested in
a controlled study
Learners[Target grade level and school: to be confirmed],
Filipino language classes
Core questionDoes mastery-aware hinting outperform fixed
wrong-answer triggers?
TimelineAbout 20 weeks (proposed, negotiable)
Final outputsDeployed system, anonymized dataset and code,
manuscript ready for submission
Skill-Level Knowledge Tracing with Targeted LLM Hints in Gamified Learning: Design and Validation
Page 1 of 13

## 2. Research Title
Recommended title: Skill-Level Knowledge Tracing with Targeted LLM Hints in
Gamified Learning: Design and Validation
The other three titles on my shortlist are not discarded. Each one becomes a research
question or the framing of the paper.
Final wording will be settled with the research adviser.
- Problem and Purpose
A right answer is not the same as knowing the skill. A student can guess correctly or
slip on something they know. Knowledge is latent: it cannot be seen directly, only
inferred from performance over time.
Most practice games judge one answer at a time. They do not track what a student
knows per skill, so they cannot tell who actually needs help.
Fixed-rule hints ignore history. A hint after every wrong answer may interrupt
students who were about to get it, or stay too generic for students who are truly
stuck.
LLM hints are powerful but risky. They can be tailored, but they can also be wrong or
give away the answer. They need guardrails and a good reason to speak up.
Title optionRole in the project
Skill-Level Knowledge Tracing with Targeted
LLM Hints in Gamified Learning: Design and
## Validation
Main title. Covers both the system and the
study.
Validity of Minigame-Based Skill Diagnosis
## Using Bayesian Knowledge Tracing
## Becomes Research Question 1
Does Mastery-Aware Hinting Outperform
Fixed Wrong-Answer Triggers? A BKT-LLM
## Comparison
## Becomes Research Question 2
Closing the Diagnosis-to-Intervention Gap:
BKT-Driven Adaptive Practice for Filipino
Morphology in Philippine Classrooms
Framing for the introduction (the subject is
Filipino morphology)
Skill-Level Knowledge Tracing with Targeted LLM Hints in Gamified Learning: Design and Validation
Page 2 of 13

Purpose: connect diagnosis (BKT) to intervention (LLM hints) inside one gamified
system, and test whether that connection improves learning in Philippine classrooms.
- Research Questions and Hypotheses
Results are reported honestly whichever way they go. A null result is still a result.
## 5. Study Design
Participants. [N to be set by power analysis] students in [target grade level] from [school
or division]. A small pilot comes first.
Conditions. Students are randomly assigned to one of three conditions. If shared rooms
risk contamination between conditions, assign by class instead of by student; the
candidate recommends which.
#QuestionHypothesis
RQ1 ValidityDo BKT mastery estimates built
from minigame play agree with an
independent, skill-aligned test of
the same skills?
H1: Estimated mastery correlates
positively with post-test skill
scores, and BKT predicts next-
answer correctness better than a
simple percent-correct baseline.
## RQ2
## Intervention
Does hinting triggered by BKT
mastery estimates lead to greater
learning gains than hinting
triggered by fixed wrong-answer
rules, or than no hints?
H2: The BKT-triggered group
shows higher normalized gain than
the fixed-trigger group, which in
turn shows higher gain than the
no-hint control.
## RQ3
## Experience
How do students and teachers rate
hint usefulness, hint accuracy, and
the game experience?
Descriptive. Most hints are judged
accurate and answer-free by
Filipino-language experts
(threshold set with the adviser).
ConditionWhen a hint appears
A. BKT-triggeredAfter a wrong answer, only if the mastery estimate
for that skill is below the hint threshold, or has
stalled over the last k attempts
Skill-Level Knowledge Tracing with Targeted LLM Hints in Gamified Learning: Design and Validation
Page 3 of 13

What stays the same. Games, item bank, LLM, hint generator, hint style, and maximum
hints per session are identical across A and B. Only the timing of the hint differs. That is
what makes the comparison fair.
Procedure. Consent and assent → pre-test → play sessions over [3–4] weeks → post-test
(parallel form) → optional delayed post-test → short survey. Pre- and post-tests use items
that are separate from the game items and are reviewed by a Filipino-language teacher or
expert.
## Analysis.
RQ1: student-level cross-validated prediction of next answers (AUC and RMSE)
against a percent-correct baseline; correlation and calibration of mastery estimates
against post-test skill scores.
RQ2: normalized learning gain compared across conditions using ANCOVA or a
mixed-effects model with the pre-test as covariate; effect sizes with confidence
intervals. Secondary measures: attempts to mastery, time on task, hint use, drop-off.
RQ3: survey ratings, expert review of a sample of hints using a rubric, and short
teacher interviews.
Hypotheses and the analysis plan are written down before the main study begins
## (pre-registration).
A design caution. XP-based unlocking means some students may never reach later
games, leaving holes in the data. During the study, use a fixed play schedule or a research
mode that unlocks the games under study. XP and levels stay on as motivation.
ConditionWhen a hint appears
B. Fixed triggerAfter N consecutive wrong answers regardless of
mastery (baseline N = 2)
C. No hints (control)Never. Students see only right or wrong feedback
Skill-Level Knowledge Tracing with Targeted LLM Hints in Gamified Learning: Design and Validation
Page 4 of 13

## 6. System Details
## 6.1 Modules
Navigation is a left tab with Games, Lessons, Profile (including settings), and Logout. Nice
to have: a leaderboard for each game.
## 6.2 The Seven Games
ModuleWhat it does
- Login and Sign UpLog in with email and password. Sign up with email,
display name, first name, last name, password, and
confirm password.
- Flash PageLanding page that explains the app, with a Get
Started button that goes to login.
- Games DashboardDefault page after login. A carousel with one card
per game or topic. Each game gives XP, XP builds
user level, and games unlock at set levels. Game 1
(Salitang-Ugat) is unlocked by default; Game 2
unlocks at about level 3 (thresholds to be
finalized).
- LessonsLesson content for each skill, plus the student’s
BKT mastery per skill.
- ProfileTwo sections, GitHub-style. Basic Information:
profile picture, display name, first name, last name,
with an Edit Profile action. Danger Zone: email and
password, each with its own Change Email and
Change Password button.
#LessonGameMechanic
1Salitang-UgatPop the BalloonEach letter of a word is a balloon (S U M A S
A K A Y). Pop letters until only the root
remains (SAKAY).
Skill-Level Knowledge Tracing with Targeted LLM Hints in Gamified Learning: Design and Validation
Page 5 of 13

Games appear under working names in my notes (for example Pop Goes the Word,
Whack-a-Word, Toss-a-Lapi, Memory Match). Final in-app names are decided with the
designer.
6.3 Skills the System Tracks
Each tracked skill has its own BKT parameters. My draft defines eight skills:
#LessonGameMechanic
2Kayarian ng
## Salita
Whack-a-MoleA mole appears with a word. Whack the
correct kayarian (payak, maylapi, tambalan,
inuulit) before it hides. Endless mode,
scored by correct whacks, with the goal of
beating your previous best.
3Mga PanlapiSupply the TilesDrag and drop (dnd-kit). Given a set of
panlapi tiles (unlapi, gitlapi, hulapi,
kabilaan) plus one empty tile, supply the
tile the sentence needs.
4TambalanMatch the CardsUp to 20 cards. Match two words to form a
compound (bahay + kubo = bahay-kubo).
5InuulitTicket Stub
## Dispenser
A printer outputs two full tickets (ganap)
or one full ticket plus a torn stub showing
the first letters (parsiyal). Read the
sentence and pull the correct lever.
6Pokus ng
## Pandiwa
Claw MachinePick the doll that shows the correct pokus
ng pandiwa for the sentence.
7AsimilasyonFortune PredictA root enters the fortune machine with
pang-. Predict the transformed output
before the card prints.
#SkillEnglishExample
1Salitang-UgatRoot word identificationsulat
2UnlapiPrefixesmag-, nag-, pag-
3GitlapiInfixes-um-, -in-
Skill-Level Knowledge Tracing with Targeted LLM Hints in Gamified Learning: Design and Validation
Page 6 of 13

Needs reconciling in Phase 0. Kayarian ng Salita and Tambalan each have a game but no
skill in this list, and the Panlapi game covers four skills at once. Baseline proposal: track
ten skills (the eight above plus Kayarian ng Salita and Tambalan), and tag every game item
with exactly one skill so the Panlapi game still feeds four separate models. The subject
expert confirms the final list.
## 6.4 Tech Stack
The stack is set, but candidates may propose changes with reasons. Two requirements:
LLM API keys live on the server only, never in the Vite frontend, and any free-tier cold-
start delay must not disturb hint timing during the study.
#SkillEnglishExample
4HulapiSuffixes-in, -an
5Kabilaan / LaguhanCircumfixespag-...-an, ka-...-an
6Pag-uulitReduplicationsusulat, batang-bata
7Pokus ng PandiwaVerb focusactor, object, locative, beneficiary
8AsimilasyonMorphophonemic changepang- → pam-/pan-
LayerChoice
DatabaseSupabase (PostgreSQL)
Backend and APINext.js, hosted on Render
FrontendReact with Vite, hosted on Vercel
UIshadcn/ui, Tailwind CSS, Lucide React icons, SVGL
for logos
Interactiondnd-kit (drag and drop), Howler.js (audio)
FontsCarnivalee Freakshow, Poppins
Audio assetsPixabay sound effects
Validation and requestsZod (schemas), Axios (HTTP)
Skill-Level Knowledge Tracing with Targeted LLM Hints in Gamified Learning: Design and Validation
Page 7 of 13

6.5 Data the System Must Capture
My draft schema lists only Users and Games. The research needs more:
Users: email, first name, last name, display name, profile picture. Passwords are
handled by the auth provider and never stored in plain text.
Games, Skills, Items: every item tagged to exactly one skill.
Sessions and Attempts: user, game, skill, item, correct (0 or 1), first-attempt flag,
response time, timestamp, hint shown, mastery before and after.
Mastery: each student’s estimate per skill after every update, so the full history can
be replayed.
Hints: trigger reason, condition, prompt, text returned, model and version, latency,
student rating.
Assessments and Conditions: pre- and post-test scores, and each student’s assigned
condition (set server-side and hidden from students).
- The BKT Algorithm
7.1 What it does
BKT (Corbett and Anderson, 1994) treats each skill as a hidden two-state variable: the
student either knows it or does not. After every answer, the model updates its belief
about which state the student is in. It is interpretable, widely used, and separates what a
student did (performance) from what a student knows (knowledge) through guess and
slip.
PandiWasto uses BKT in its classic form: one model per skill per student, with answers
scored right or wrong. Because each minigame trains a tightly defined skill, one game
maps cleanly to one skill (or, for Panlapi, four separately tagged skills). Practice here is
also learning, so the model allows the student to learn between attempts.
7.2 Parameters (per skill)
ParameterMeaning
P(L0)Probability the student already knows the skill
before starting
P(T)Probability of learning the skill after each attempt
Skill-Level Knowledge Tracing with Targeted LLM Hints in Gamified Learning: Design and Validation
Page 8 of 13

7.3 Update rules
After a correct answer:
P(L | correct) = P(L)(1 - S) / [ P(L)(1 - S) + (1 - P(L))G ]
After a wrong answer:
P(L | wrong)   = P(L)S / [ P(L)S + (1 - P(L))(1 - G) ]
Then allow for learning:
P(L next) = P(L | answer) + (1 - P(L | answer)) T
Prediction of the next answer:
P(correct) = P(L)(1 - S) + (1 - P(L))G
7.4 Implementation requirements
Scoring: one scored item is one answer. Use first-attempt correctness. Each game
defines its own item: a word (Pop the Balloon), a mole (Whack-a-Mole), a sentence
(Supply the Tiles, Ticket Stub, Claw Machine), a card pair (Match the Cards), a root
(Fortune Predict).
Open scoring decisions: how to treat timed-out moles (wrong, or excluded, since
speed is not the same as knowledge) and how to treat answers given after a hint. The
candidate proposes and justifies both.
Guess priors by format: a four-option game has a guess rate near 0.25, while an open-
ended game such as Pop the Balloon is far lower. Set priors per game.
Constrained fitting: bound guess and slip to plausible ranges (commonly 0.3 or
lower) to avoid degenerate models.
Fitting: start from expert priors, then refit on pilot data using grid search or EM. Tools
I have noted: hmmsclbl, BNT-SM, and BKT-Brute Force. Alternatives such as pyBKT are
welcome.
Mastery threshold: commonly 0.95; confirm with pilot data and report the sensitivity.
ParameterMeaning
P(G)Guess: probability of answering correctly without
knowing the skill
P(S)Slip: probability of answering wrongly despite
knowing the skill
Skill-Level Knowledge Tracing with Targeted LLM Hints in Gamified Learning: Design and Validation
Page 9 of 13

Engineering: the engine runs server-side after every attempt, is a standalone testable
module with unit tests, and can be recomputed from the attempt log at any time.
Reporting: fitted parameters per skill with fit statistics appear in the paper.
- LLM Hint Component
Language and level: Filipino, using the lesson’s own terminology, suited to the
learners’ grade.
Progressive: nudge first, then a rule reminder, then a worked example with a different
word. Never the direct answer.
Grounded: hints are generated from a curated rule bank and lesson content for the
skill, plus the item and the student’s wrong response. No free-form tutoring.
Checked: automated checks for answer leakage, length, and language, plus expert
review of a sample against a rubric.
Reliable: target response time of about 3 seconds, pre-written fallback hints if the
LLM fails, rate limits, and a cost cap.
Private: no personal information sent to the LLM provider. Every prompt, response,
and model version is logged, and settings are fixed for the study.
Provider-agnostic: the candidate recommends a provider and keeps it swappable.
## 9. Research Paper Requirements
Structure: Abstract, Introduction, Related Work (knowledge tracing, BKT, LLM hints
and tutoring, gamified language learning, Filipino morphology instruction), System
## Design, Method, Results, Discussion, Limitations, Conclusion, References.
Must include: clear research questions and hypotheses, a pre-registered analysis
plan, a BKT parameter table, evaluation metrics, effect sizes with confidence intervals,
and honest reporting of null results.
Threats to validity: guess and slip, novelty effect, contamination between conditions,
small sample, and LLM output variability.
Reproducibility: code repository, anonymized dataset, fitting scripts, and the hint
prompts and review rubric as an appendix.
Ethics: informed consent and assent, parental consent for minors, approval from the
school or division and the institution’s ethics board, compliance with the Data Privacy
Act of 2012 (RA 10173), and pseudonymized data for analysis.
Skill-Level Knowledge Tracing with Targeted LLM Hints in Gamified Learning: Design and Validation
Page 10 of 13

Format and venue: [thesis, conference paper, or journal article: to be confirmed],
following the institution’s required format.
Authorship and ownership: discussed and agreed in writing before work starts.
- Deliverables and Timeline
Definition of done:
All seven games are playable on the devices used in the participating schools.
The BKT engine has unit tests and matches a reference implementation on test data.
Both hint policies run, can be switched per student, and log every decision.
The study is completed with full attempt logs, and the analysis can be reproduced
from code and data.
A manuscript draft covers every item in Section 9.
PhaseWeeksDeliverables
- Scoping1–2Final skill list, item bank spec, hint trigger spec,
study protocol draft, ethics application started
- Core app3–8Auth, flash page, dashboard, XP and levels, profile,
lessons, seven games, attempt logging
- BKT engine6–9Engine with unit tests, mastery shown in Lessons
- LLM hints8–11Hint service, both trigger policies, condition
assignment, guardrails
- Pilot11–12Small-group pilot, parameter fitting, fixes
- Main study13–16Data collection and monitoring (starts only after
approvals are in place)
- Analysis and paper17–20Analysis, manuscript, repository and dataset
handoff
Skill-Level Knowledge Tracing with Targeted LLM Hints in Gamified Learning: Design and Validation
Page 11 of 13

- Roles and Candidate Profile
One person may cover more than one role. Please state which roles you can cover.
Please bring to the interview: relevant work or a portfolio, a short outline of how you
would approach the BKT engine and the study, your time and cost estimate, your
availability, and your questions.
How I will evaluate: fit with the required skills, clarity of your approach to BKT and the
experiment, communication and reliability, and a realistic estimate.
- Scope and Open Decisions
In scope: the seven lessons and games, XP and levels, lessons with mastery display,
profiles, BKT engine, LLM hints, the three-condition study, and the paper.
Out of scope: native mobile apps, curriculum beyond the seven lessons, languages other
than Filipino, and deep-learning knowledge tracing models. Nice to have if time allows:
per-game leaderboards and a teacher view of mastery.
RoleResponsibilitiesKey skills
Full-stack developerApp, API, database, auth,
deployment
React and Vite, Next.js,
PostgreSQL or Supabase, Zod
Game and front-end
developer
Seven games, animation,
audio, drag and drop
React, dnd-kit, Howler.js,
Tailwind, shadcn/ui
Data and ML researcherBKT engine, hint triggers,
study analysis
Python, BKT or HMMs,
statistics (mixed models),
experiment design
Filipino language content
expert (consultant)
Item bank, hint review, pre-
and post-tests
Filipino linguistics and
teaching experience
DecidedOpen (to finalize in Phase 0)
Tech stackFinal skill list (8 or 10)
Seven games, one per lessonMastery and hint thresholds (P(L), k, N)
BKT as the knowledge modelScoring of timeouts and post-hint answers
Skill-Level Knowledge Tracing with Targeted LLM Hints in Gamified Learning: Design and Validation
Page 12 of 13

Questions before the interview: [Your email or contact]
DecidedOpen (to finalize in Phase 0)
LLM hints in FilipinoLLM provider
Three-condition designSample size, school, and grade level
Level thresholds for unlocking games
Paper format and venue
Skill-Level Knowledge Tracing with Targeted LLM Hints in Gamified Learning: Design and Validation
Page 13 of 13