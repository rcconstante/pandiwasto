begin;

-- Study options set per cohort by admins, and app-wide research settings.
create table pandiwasto_private.arcade_settings (
  id boolean primary key default true check (id),
  timeout_as_wrong boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into pandiwasto_private.arcade_settings default values;
alter table pandiwasto_private.arcade_settings enable row level security;
revoke all on pandiwasto_private.arcade_settings from public, anon, authenticated, service_role;

alter table pandiwasto_private.study_cohorts
  add column hint_threshold numeric not null default 0.70 check (hint_threshold > 0 and hint_threshold < 1),
  add column stall_window integer not null default 3 check (stall_window between 2 and 10),
  add column assign_by_class boolean not null default false,
  add column delayed_at timestamptz;
alter table pandiwasto_private.study_cohorts add constraint study_cohorts_delayed_order
  check (delayed_at is null or (delayed_at > posttest_at and delayed_at < closes_at));
alter table pandiwasto_private.study_participants add column class_id uuid references pandiwasto_private.arcade_classes (id) on delete set null;
alter table pandiwasto_private.study_assessments drop constraint study_assessments_phase_check;
alter table pandiwasto_private.study_assessments add constraint study_assessments_phase_check check (phase in ('pre', 'post', 'delayed'));

alter table pandiwasto_private.arcade_hints
  add column hint_trigger text check (hint_trigger in ('auto', 'requested')),
  add column prompt_version text check (char_length(prompt_version) <= 40),
  add column input_tokens integer check (input_tokens >= 0),
  add column output_tokens integer check (output_tokens >= 0),
  add column helpful boolean,
  add column rated_at timestamptz;

create table pandiwasto_private.study_surveys (
  id bigint generated always as identity primary key,
  player_id uuid not null references auth.users (id) on delete cascade,
  participant_id uuid references pandiwasto_private.study_participants (id) on delete cascade,
  respondent text not null check (respondent in ('student', 'teacher')),
  responses jsonb not null check (jsonb_typeof(responses) = 'object'),
  comment text check (char_length(comment) <= 1000),
  submitted_at timestamptz not null default clock_timestamp()
);
create unique index study_surveys_participant on pandiwasto_private.study_surveys (participant_id) where participant_id is not null;
create unique index study_surveys_teacher on pandiwasto_private.study_surveys (player_id) where respondent = 'teacher';
alter table pandiwasto_private.study_surveys enable row level security;
revoke all on pandiwasto_private.study_surveys from public, anon, authenticated, service_role;

-- The one place that decides whether an answer updates BKT. First attempts count, hinted or
-- not (bkt notes: update normally, flag hint_used, check results without hinted answers);
-- timeouts count as wrong only when the admin setting says so.
create function pandiwasto_private.counts_for_bkt(first_attempt boolean, timed_out boolean)
returns boolean language sql stable set search_path = ''
as $$
  select coalesce(first_attempt, false)
    and (not coalesce(timed_out, false) or (select s.timeout_as_wrong from pandiwasto_private.arcade_settings s));
$$;

create function public.pandiwasto_admin_settings(account_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform pandiwasto_private.require_study_admin(account_id);
  return (select jsonb_build_object('timeoutAsWrong', s.timeout_as_wrong, 'updatedAt', s.updated_at) from pandiwasto_private.arcade_settings s);
end
$$;

create function public.pandiwasto_admin_settings_update(account_id uuid, timeout_as_wrong boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_variable
begin
  perform pandiwasto_private.require_study_admin(account_id);
  if timeout_as_wrong is null then raise sqlstate 'PT400' using message = 'Choose how timeouts count.'; end if;
  update pandiwasto_private.arcade_settings s set timeout_as_wrong = timeout_as_wrong, updated_at = now() where s.id;
  return public.pandiwasto_admin_settings(account_id);
end
$$;

create or replace function public.pandiwasto_admin_study_list(account_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform pandiwasto_private.require_study_admin(account_id);
  return jsonb_build_object('cohorts', coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'protocol', c.protocol,
      'opensAt', c.opens_at, 'posttestAt', c.posttest_at, 'closesAt', c.closes_at, 'delayedAt', c.delayed_at,
      'hintThreshold', c.hint_threshold, 'stallWindow', c.stall_window, 'assignByClass', c.assign_by_class,
      'preCount', (select count(*) from pandiwasto_private.study_questions q where q.cohort_id = c.id and q.phase = 'pre'),
      'postCount', (select count(*) from pandiwasto_private.study_questions q where q.cohort_id = c.id and q.phase = 'post'),
      'participants', (select count(*) from pandiwasto_private.study_participants p where p.cohort_id = c.id and p.withdrawn_at is null),
      'surveys', (select count(*) from pandiwasto_private.study_surveys v join pandiwasto_private.study_participants p on p.id = v.participant_id where p.cohort_id = c.id),
      'sealed', exists(select 1 from pandiwasto_private.study_participants p where p.cohort_id = c.id and p.consented_at is not null)
    ) order by c.opens_at desc)
    from (select * from pandiwasto_private.study_cohorts order by opens_at desc limit 100) as c
  ), '[]'::jsonb));
end
$$;

-- Hint rules and assignment are fixed once anyone consents, so groups stay comparable.
create function public.pandiwasto_admin_study_options(
  account_id uuid, study_id uuid, hint_threshold numeric, stall_window integer, assign_by_class boolean, delayed_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_variable
declare cohort pandiwasto_private.study_cohorts%rowtype;
begin
  perform pandiwasto_private.require_study_admin(account_id);
  select * into cohort from pandiwasto_private.study_cohorts c where c.id = study_id for update;
  if not found then raise sqlstate 'PT404' using message = 'Study cohort not found.'; end if;
  if hint_threshold is null or hint_threshold <= 0 or hint_threshold >= 1 or stall_window is null or stall_window not between 2 and 10
      or assign_by_class is null or (delayed_at is not null and not (delayed_at > cohort.posttest_at and delayed_at < cohort.closes_at)) then
    raise sqlstate 'PT400' using message = 'Check the hint threshold (0–1), stall window (2–10), and delayed posttest date.';
  end if;
  if exists (select 1 from pandiwasto_private.study_participants p where p.cohort_id = study_id and p.consented_at is not null)
      and (hint_threshold, stall_window, assign_by_class) is distinct from (cohort.hint_threshold, cohort.stall_window, cohort.assign_by_class) then
    raise sqlstate 'PT409' using message = 'Hint rules and assignment are locked after the first consent.';
  end if;
  update pandiwasto_private.study_cohorts c
  set hint_threshold = hint_threshold, stall_window = stall_window, assign_by_class = assign_by_class, delayed_at = delayed_at
  where c.id = study_id;
  return jsonb_build_object('saved', true);
end
$$;

-- Group A uses the cohort's own threshold and stall window; B counts misses on the same skill.
create or replace function pandiwasto_private.allow_study_hint(account_id uuid, run_id uuid, skill_key text, item_index int)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare
  assignment text; game integer; withdrawn boolean; used integer; misses integer; latest_correct boolean;
  probability numeric; threshold numeric; stalled boolean; hint_limit numeric; window_size integer;
begin
  select p.condition, r.game_id, p.withdrawn_at is not null, c.hint_threshold, c.stall_window
  into assignment, game, withdrawn, hint_limit, window_size
  from pandiwasto_private.study_runs s
  join pandiwasto_private.study_participants p on p.id = s.participant_id
  join pandiwasto_private.study_cohorts c on c.id = p.cohort_id
  join pandiwasto_private.arcade_runs r on r.id = s.run_id
  where s.run_id = $2 and p.player_id = account_id;
  if not found then return true; end if;
  if assignment = 'C' or withdrawn or not pandiwasto_private.study_is_practicing(account_id) then return false; end if;

  used := case when game = 1
    then (select coalesce(sum(i.hint_level), 0) from pandiwasto_private.arcade_run_items i where i.run_id = $2)
    else (select count(*) from pandiwasto_private.arcade_ranked_moves m where m.run_id = $2 and m.action_type = 'hint')
  end;
  if used >= 4 then return false; end if;

  select count(*) filter (where not recent.correct), (array_agg(recent.correct order by recent.recorded_at desc, recent.move_number desc, recent.observation_index desc))[1]
  into misses, latest_correct
  from (select o.correct, o.recorded_at, o.move_number, o.observation_index from pandiwasto_private.scored_answers o
    where o.run_id = $2 and o.skill_key = $3 and not o.timed_out
    order by o.recorded_at desc, o.move_number desc, o.observation_index desc limit 2) as recent;
  if assignment = 'B' then return misses = 2; end if;

  select coalesce(m.probability, pandiwasto_private.bkt_prior(account_id, s.skill_key, s.initial_mastery)), s.mastery_threshold
  into probability, threshold
  from pandiwasto_private.arcade_skills s
  left join pandiwasto_private.arcade_mastery m on m.skill_key = s.skill_key and m.player_id = account_id
  where s.skill_key = $3;
  select count(*) = window_size and (array_agg(o.mastery_after order by o.recorded_at desc))[1] <= (array_agg(o.mastery_before order by o.recorded_at desc))[window_size]
  into stalled
  from (select u.mastery_before, u.mastery_after, u.recorded_at from pandiwasto_private.scored_answers u
    where u.player_id = account_id and u.skill_key = $3 and u.mastery_after is not null
    order by u.recorded_at desc limit window_size) as o;
  return coalesce(latest_correct = false and (probability < hint_limit or (stalled and probability < threshold)), false);
end
$$;

-- Assignment stays balanced; with assign_by_class every student in a class shares a group.
create or replace function public.pandiwasto_study_consent(account_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare member record; assigned text; class_group uuid; by_class boolean;
begin
  perform pandiwasto_private.lock_arcade_account(account_id);
  select p.id, p.cohort_id, p.consented_at, c.assign_by_class into member
  from pandiwasto_private.study_participants p join pandiwasto_private.study_cohorts c on c.id = p.cohort_id
  where p.player_id = account_id and p.withdrawn_at is null and now() < c.posttest_at order by c.opens_at limit 1;
  if not found then raise sqlstate 'PT403' using message = 'Study enrollment is unavailable.'; end if;
  if member.consented_at is not null then return public.pandiwasto_study_status(account_id); end if;
  perform 1 from pandiwasto_private.study_cohorts c where c.id = member.cohort_id for update;
  if not exists (select 1 from pandiwasto_private.study_questions q where q.cohort_id = member.cohort_id and q.phase = 'pre')
    or exists (select 1 from pandiwasto_private.study_questions q where q.cohort_id = member.cohort_id
      group by q.skill_key having count(*) filter(where q.phase = 'pre') <> count(*) filter(where q.phase = 'post')) then
    raise sqlstate 'PT409' using message = 'The study needs parallel pre- and post-assessments before enrollment.';
  end if;
  by_class := member.assign_by_class;
  if by_class then
    select m.class_id into class_group from pandiwasto_private.arcade_class_members m
    where m.player_id = account_id order by m.added_at limit 1;
    select p.condition into assigned from pandiwasto_private.study_participants p
    where p.cohort_id = member.cohort_id and p.class_id = class_group and p.condition is not null and class_group is not null limit 1;
  end if;
  if assigned is null then
    -- Balance by classes when assigning by class, otherwise by students.
    select groups.value into strict assigned from (values ('A'), ('B'), ('C')) as groups(value)
    order by (select case when by_class and class_group is not null then count(distinct p.class_id) else count(*) end
      from pandiwasto_private.study_participants p
      where p.cohort_id = member.cohort_id and p.condition = groups.value), random() limit 1;
  end if;
  update pandiwasto_private.study_participants p
  set consented_at = clock_timestamp(), condition = assigned, class_id = case when by_class then class_group end
  where p.id = member.id;
  return public.pandiwasto_study_status(account_id);
end
$$;

-- Adds an optional delayed posttest (the post form again) after delayed_at, and a survey flag.
create or replace function public.pandiwasto_study_status(account_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare member record; current_state text; current_phase text; response jsonb; items jsonb; has_post boolean;
begin
  select p.id, p.cohort_id, p.consented_at, c.title, c.information, c.protocol, c.opens_at, c.posttest_at, c.closes_at, c.delayed_at
  into member
  from pandiwasto_private.study_participants p join pandiwasto_private.study_cohorts c on c.id = p.cohort_id
  where p.player_id = account_id and p.withdrawn_at is null
  order by (now() >= c.opens_at and now() < c.closes_at) desc, (now() < c.opens_at) desc, c.opens_at desc limit 1;
  if not found then return jsonb_build_object('state', 'unavailable'); end if;

  has_post := exists(select 1 from pandiwasto_private.study_assessments a where a.participant_id = member.id and a.phase = 'post');
  current_state := case
    when has_post and member.delayed_at is not null and now() >= member.delayed_at and now() < member.closes_at
      and not exists(select 1 from pandiwasto_private.study_assessments a where a.participant_id = member.id and a.phase = 'delayed') then 'delayedtest'
    when has_post then 'completed'
    when now() >= member.closes_at then 'closed'
    when member.consented_at is null then 'invited'
    when now() < member.opens_at then 'scheduled'
    when now() < member.posttest_at and not exists(select 1 from pandiwasto_private.study_assessments a where a.participant_id = member.id and a.phase = 'pre') then 'pretest'
    when not exists(select 1 from pandiwasto_private.study_assessments a where a.participant_id = member.id and a.phase = 'pre') then 'closed'
    when now() < member.posttest_at then 'practice'
    else 'posttest'
  end;
  current_phase := case current_state when 'pretest' then 'pre' when 'posttest' then 'post' when 'delayedtest' then 'post' end;
  if current_phase is not null then
    select jsonb_agg(jsonb_build_object('id', q.id, 'prompt', q.prompt, 'choices', q.options) order by q.id) into items
    from pandiwasto_private.study_questions q where q.cohort_id = member.cohort_id and q.phase = current_phase;
  end if;
  response := jsonb_build_object('state', current_state, 'title', member.title, 'information', member.information,
    'protocol', member.protocol, 'opensAt', member.opens_at, 'posttestAt', member.posttest_at, 'closesAt', member.closes_at,
    'canWithdraw', member.consented_at is not null,
    'surveyDue', has_post and not exists(select 1 from pandiwasto_private.study_surveys v where v.participant_id = member.id));
  if member.delayed_at is not null then response := response || jsonb_build_object('delayedAt', member.delayed_at); end if;
  if current_phase is not null then response := response || jsonb_build_object('questions', coalesce(items, '[]'::jsonb)); end if;
  return response;
end
$$;

create or replace function public.pandiwasto_study_submit(account_id uuid, form text, responses jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare state jsonb; member record; expected integer; received integer; earned integer; question_phase text;
begin
  if form is null or form not in ('pre', 'post', 'delayed') or responses is null or jsonb_typeof(responses) <> 'array' then
    raise sqlstate 'PT400' using message = 'Assessment choices are required.';
  end if;
  if jsonb_array_length(responses) not between 1 and 40 then raise sqlstate 'PT400' using message = 'Invalid assessment choices.'; end if;
  perform pandiwasto_private.lock_arcade_account(account_id);
  state := public.pandiwasto_study_status(account_id);
  select p.id, p.cohort_id into member
  from pandiwasto_private.study_participants p join pandiwasto_private.study_cohorts c on c.id = p.cohort_id
  where p.player_id = account_id and p.withdrawn_at is null and p.consented_at is not null
  and now() >= c.opens_at and now() < c.closes_at;
  if not found then raise sqlstate 'PT403' using message = 'Assessment is unavailable.'; end if;
  if exists (select 1 from pandiwasto_private.study_assessments a where a.participant_id = member.id and a.phase = form and a.choices = responses) then
    return state;
  end if;
  if state->>'state' <> (form || 'test') then raise sqlstate 'PT409' using message = 'This assessment is no longer open.'; end if;
  if exists (select 1 from jsonb_array_elements(responses) r where jsonb_typeof(r) <> 'object' or
    coalesce(r->>'itemId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or coalesce(r->>'choice','') !~ '^[012]$') then
    raise sqlstate 'PT400' using message = 'Invalid assessment choices.';
  end if;
  -- The delayed posttest reuses the post form.
  question_phase := case when form = 'delayed' then 'post' else form end;
  select count(*) into expected from pandiwasto_private.study_questions q where q.cohort_id = member.cohort_id and q.phase = question_phase;
  select count(distinct q.id), count(*) filter (where q.answer::text = r->>'choice')
    into received, earned
  from jsonb_array_elements(responses) r
  join pandiwasto_private.study_questions q on q.id = (r->>'itemId')::uuid and q.cohort_id = member.cohort_id and q.phase = question_phase;
  if expected <> jsonb_array_length(responses) or received <> expected then
    raise sqlstate 'PT400' using message = 'Provide one answer for every question.';
  end if;
  insert into pandiwasto_private.study_assessments (participant_id, phase, choices, points, total)
  values (member.id, form, responses, earned, expected);
  return public.pandiwasto_study_status(account_id);
end
$$;

-- End-of-study survey: one per study participant after the posttest, one per teacher.
create function public.pandiwasto_survey_submit(account_id uuid, responses jsonb, comment text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_variable
declare member uuid; teacher boolean;
begin
  if responses is null or jsonb_typeof(responses) <> 'object' or pg_column_size(responses) > 4096
      or exists (select 1 from jsonb_each(responses) e where e.key !~ '^[a-z][a-z0-9_]{0,39}$' or e.value::text !~ '^[1-5]$')
      or (comment is not null and char_length(comment) > 1000) then
    raise sqlstate 'PT400' using message = 'Answer each statement from 1 to 5.';
  end if;
  teacher := pandiwasto_private.staff_role(account_id) is not null;
  if not teacher then
    select p.id into member from pandiwasto_private.study_participants p
    join pandiwasto_private.study_assessments a on a.participant_id = p.id and a.phase = 'post'
    where p.player_id = account_id and p.withdrawn_at is null order by a.completed_at desc limit 1;
    if member is null then raise sqlstate 'PT403' using message = 'The survey opens after the posttest.'; end if;
  end if;
  insert into pandiwasto_private.study_surveys (player_id, participant_id, respondent, responses, comment)
  values (account_id, member, case when teacher then 'teacher' else 'student' end, responses, nullif(btrim(comment), ''))
  on conflict do nothing;
  return jsonb_build_object('submitted', true);
end
$$;

create function public.pandiwasto_survey_status(account_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('submitted', exists (select 1 from pandiwasto_private.study_surveys v where v.player_id = account_id and v.respondent = 'teacher'));
$$;

-- Hint log v2: trigger, prompt version, and token counts; returns the hint id for ratings.
drop function public.pandiwasto_hint_log(uuid, uuid, text, integer, integer, text, text, text, integer, boolean);
create function public.pandiwasto_hint_log(
  account_id uuid, active_run uuid, skill text, item_index integer, hint_level integer, hint_text text,
  hint_source text, model_name text, latency_ms integer, cache_hit boolean,
  hint_trigger text default null, prompt_version text default null, input_tokens integer default null, output_tokens integer default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_variable
declare game integer; assignment text; prior numeric; new_id bigint;
begin
  select run.game_id into game from pandiwasto_private.arcade_runs run where run.id = active_run and run.player_id = account_id;
  if not found then raise sqlstate 'PT404' using message = 'Game run not found.'; end if;
  if skill is null or not ((game = 1 and skill = 'salitang-ugat') or pandiwasto_private.ranked_skill_allowed(game, skill))
      or item_index is null or item_index < 0 or hint_level is null or hint_level not between 1 and 3
      or hint_text is null or char_length(hint_text) not between 1 and 1000 or hint_source is null or hint_source not in ('authored', 'ai')
      or latency_ms is null or latency_ms < 0 or cache_hit is null or char_length(model_name) > 80
      or (hint_trigger is not null and hint_trigger not in ('auto', 'requested')) or char_length(prompt_version) > 40
      or input_tokens < 0 or output_tokens < 0 then
    raise sqlstate 'PT400' using message = 'Invalid hint record.';
  end if;
  select p.condition into assignment from pandiwasto_private.study_runs s
  join pandiwasto_private.study_participants p on p.id = s.participant_id where s.run_id = active_run;
  select coalesce(m.probability, pandiwasto_private.bkt_prior(account_id, s.skill_key, s.initial_mastery)) into prior
  from pandiwasto_private.arcade_skills s
  left join pandiwasto_private.arcade_mastery m on m.skill_key = s.skill_key and m.player_id = account_id
  where s.skill_key = skill;
  insert into pandiwasto_private.arcade_hints
    (run_id, item_index, skill_key, hint_level, hint_condition, mastery, source, model, latency_ms, cache_hit, hint_text,
     hint_trigger, prompt_version, input_tokens, output_tokens)
  values (active_run, item_index, skill, hint_level, assignment, prior, hint_source, model_name, latency_ms, cache_hit, hint_text,
    hint_trigger, prompt_version, input_tokens, output_tokens)
  returning id into new_id;
  return jsonb_build_object('hintId', new_id);
end;
$$;

-- Mastery for one skill, used to tell the hint model the learner's band.
create function public.pandiwasto_hint_mastery(account_id uuid, skill text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('mastery', coalesce(
    (select m.probability from pandiwasto_private.arcade_mastery m where m.player_id = account_id and m.skill_key = skill),
    (select pandiwasto_private.bkt_prior(account_id, s.skill_key, s.initial_mastery) from pandiwasto_private.arcade_skills s where s.skill_key = skill)));
$$;

-- "Was this hint helpful?" on the learner's own latest hint in a run.
create function public.pandiwasto_hint_rate(account_id uuid, active_run uuid, hint_id bigint, helpful boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_variable
begin
  if helpful is null then raise sqlstate 'PT400' using message = 'Choose helpful or not helpful.'; end if;
  update pandiwasto_private.arcade_hints h set helpful = helpful, rated_at = clock_timestamp()
  from pandiwasto_private.arcade_runs r
  where h.id = hint_id and h.run_id = active_run and r.id = h.run_id and r.player_id = account_id;
  if not found then raise sqlstate 'PT404' using message = 'Hint not found.'; end if;
  return jsonb_build_object('helpful', helpful);
end
$$;

-- Scoring now goes through counts_for_bkt (hinted first attempts count).
create or replace function public.pandiwasto_pop_answer(account_id uuid, active_run uuid, answer_id uuid, expected_round integer, response text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  game_run pandiwasto_private.arcade_runs%rowtype;
  previous_attempt pandiwasto_private.arcade_attempts%rowtype;
  round_item record;
  character_index integer;
  scan_position integer := 0;
  next_character integer;
  correct_answer boolean;
  first_attempt boolean;
  used_hint boolean;
  awarded_points integer;
  reached_end boolean;
  round_skipped boolean;
  remaining_hearts integer;
  acted_at timestamptz := clock_timestamp();
  prior numeric;
  learned numeric;
  param_ver integer;
  answer_result jsonb;
begin
  if active_run is null or answer_id is null or expected_round is null or expected_round not between 0 and 4
      or response is null or response !~ '^[A-Z]{0,12}$' then
    raise sqlstate 'PT400' using message = 'An answer must contain only retained capital letters.';
  end if;

  perform pandiwasto_private.lock_arcade_account(account_id);
  select run.* into game_run from pandiwasto_private.arcade_runs run
  where run.id = active_run and run.player_id = account_id and run.game_id = 1;
  if not found then
    raise sqlstate 'PT404' using message = 'Game run not found.';
  end if;

  select attempt.* into previous_attempt from pandiwasto_private.arcade_attempts attempt
  where attempt.run_id = active_run and attempt.request_id = answer_id;
  if found then
    if (previous_attempt.round_index, previous_attempt.response) is distinct from (expected_round, response) then
      raise sqlstate 'PT409' using message = 'That answer request ID was already used.';
    end if;
    return previous_attempt.result;
  end if;

  if game_run.status <> 'active' or game_run.current_round <> expected_round then
    raise sqlstate 'PT409' using message = 'This round is no longer active.';
  end if;

  select item.*, dealt.hint_requested_at into strict round_item
  from pandiwasto_private.arcade_run_items dealt
  join pandiwasto_private.arcade_items item
    on (item.game_id, item.item_key, item.version) = (dealt.game_id, dealt.item_key, dealt.item_version)
  where dealt.run_id = active_run and dealt.round_index = expected_round;

  if char_length(response) >= char_length(round_item.prompt) then
    raise sqlstate 'PT400' using message = 'Pop at least one letter before checking your word.';
  end if;
  for character_index in 1..char_length(response) loop
    next_character := strpos(substr(round_item.prompt, scan_position + 1), substr(response, character_index, 1));
    if next_character = 0 then
      raise sqlstate 'PT400' using message = 'The remaining letters must stay in their original order.';
    end if;
    scan_position := scan_position + next_character;
  end loop;

  select not exists (
    select 1 from pandiwasto_private.arcade_attempts attempt
    where attempt.run_id = active_run and attempt.round_index = expected_round
  ) into first_attempt;
  used_hint := round_item.hint_requested_at is not null;
  correct_answer := response = round_item.solution;
  awarded_points := case
    when correct_answer then 100 - case when used_hint then 25 else 0 end - case when first_attempt then 0 else 25 end
    else 0
  end;
  remaining_hearts := game_run.hearts - case when correct_answer then 0 else 1 end;
  round_skipped := not correct_answer and remaining_hearts = 0;
  reached_end := (correct_answer or round_skipped) and game_run.current_round = game_run.total_rounds - 1;

  -- counts_for_bkt holds the scoring rule; every answer and its hint flag is still logged.
  if pandiwasto_private.counts_for_bkt(first_attempt, false) and not game_run.developer_run then
    select bkt.before_mastery, bkt.after_mastery, bkt.version into prior, learned, param_ver
    from pandiwasto_private.bkt_apply(account_id, round_item.skill_key, correct_answer, acted_at) as bkt;
  end if;

  -- Insert before building the new snapshot so its hadMiss state is current.
  insert into pandiwasto_private.arcade_attempts
    (run_id, request_id, round_index, response, correct, first_attempt, hint_used, response_ms, recorded_at,
     mastery_before, mastery_after, param_version, result)
  values (active_run, answer_id, expected_round, response, correct_answer, first_attempt, used_hint,
    greatest(0, extract(epoch from (acted_at - game_run.round_started_at)) * 1000)::bigint,
    acted_at, prior, learned, param_ver, '{}'::jsonb);

  update pandiwasto_private.arcade_runs run
  set score = run.score + awarded_points,
    xp = run.xp + case when correct_answer then 20 else 0 end,
    hearts = case when (correct_answer or round_skipped) and not reached_end then 3 else remaining_hearts end,
    current_round = run.current_round + case when (correct_answer or round_skipped) and not reached_end then 1 else 0 end,
    round_started_at = case when (correct_answer or round_skipped) and not reached_end then acted_at else run.round_started_at end,
    status = case when reached_end then 'completed' else 'active' end,
    finished_at = case when reached_end then acted_at end
  where run.id = active_run
  returning run.* into game_run;

  if reached_end and not game_run.developer_run then
    update pandiwasto_private.arcade_progress set xp = xp + game_run.xp where player_id = account_id;
    if game_run.score > 0 then
      perform public.pandiwasto_record_game_score(1, account_id, game_run.score);
    end if;
  end if;

  answer_result := pandiwasto_private.pop_snapshot(active_run) || jsonb_strip_nulls(jsonb_build_object(
    'correct', correct_answer,
    'root', case when correct_answer or round_skipped then round_item.solution end,
    'skipped', round_skipped,
    'roundHearts', remaining_hearts,
    'points', awarded_points,
    'roundWord', round_item.prompt
  ));
  update pandiwasto_private.arcade_attempts attempt set result = answer_result
  where attempt.run_id = active_run and attempt.request_id = answer_id;
  return answer_result;
end;
$$;

create or replace function public.pandiwasto_ranked_action(
  account_id uuid, active_run uuid, request_id uuid, expected_version integer,
  action jsonb, state jsonb, response jsonb, complete boolean, score integer,
  awarded_xp integer, observations jsonb, abandon boolean default false, hint_context jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  game_run pandiwasto_private.arcade_runs%rowtype;
  ranked pandiwasto_private.arcade_ranked_states%rowtype;
  previous_move pandiwasto_private.arcade_ranked_moves%rowtype;
  observation record;
  observed_index integer := 0;
  next_version integer;
  acted_at timestamptz;
  prior numeric;
  learned numeric;
  param_ver integer;
  is_timeout boolean;
  hint_item_index integer;
begin
  if active_run is null or request_id is null or expected_version is null or expected_version < 0
      or action is null or jsonb_typeof(action) <> 'object' or pg_column_size(action) > 4096
      or state is null or jsonb_typeof(state) <> 'object' or pg_column_size(state) > 131072
      or response is null or jsonb_typeof(response) <> 'object' or pg_column_size(response) > 65536
      or complete is null or abandon is null or (complete and abandon)
      or awarded_xp is null or awarded_xp < 0
      or observations is null or jsonb_typeof(observations) <> 'array'
      or pg_column_size(observations) > 16384 then
    raise sqlstate 'PT400' using message = 'Invalid ranked move data.';
  end if;
  if jsonb_array_length(observations) > 20 or (abandon and jsonb_array_length(observations) > 0) then
    raise sqlstate 'PT400' using message = 'Invalid ranked observation data.';
  end if;
  perform pandiwasto_private.lock_arcade_account(account_id);

  select run.* into game_run from pandiwasto_private.arcade_runs run
  where run.id = active_run and run.player_id = account_id and run.game_id between 2 and 7;
  if not found then
    raise sqlstate 'PT404' using message = 'Game run not found.';
  end if;

  select move.* into previous_move from pandiwasto_private.arcade_ranked_moves move
  where move.run_id = active_run and move.request_id = request_id;
  if found then
    if previous_move.action is distinct from action then
      raise sqlstate 'PT409' using message = 'That move request ID was already used.';
    end if;
    return pandiwasto_private.ranked_snapshot(active_run) || jsonb_build_object('response', previous_move.response);
  end if;

  select saved.* into strict ranked from pandiwasto_private.arcade_ranked_states saved where saved.run_id = active_run;
  if game_run.status <> 'active' or ranked.version <> expected_version then
    raise sqlstate 'PT409' using message = 'The game has changed. Refresh the round before retrying.';
  end if;

  if not complete then
    if awarded_xp <> 0 then
      raise sqlstate 'PT400' using message = 'Only completed runs earn account rewards.';
    end if;
  elsif game_run.game_id = 2 then
    if score is null or score < 0 or score > 20000 or score % 100 <> 0 or awarded_xp > 2000 or score <> awarded_xp * 10 then
      raise sqlstate 'PT400' using message = 'Invalid Whack-a-Word rewards.';
    end if;
  elsif score is null or score < 0 or score > (case when game_run.game_id = 4 then 1200 else 500 end) or awarded_xp > 100
      or (game_run.game_id <> 4 and awarded_xp % 20 <> 0) then
    raise sqlstate 'PT400' using message = 'Invalid completed-game rewards.';
  end if;

  if action->'action'->>'type' = 'hint' and hint_context is not null then
    if jsonb_typeof(hint_context) <> 'object' or not pandiwasto_private.ranked_skill_allowed(game_run.game_id, hint_context->>'skillId')
        or coalesce(hint_context->>'itemIndex', '') !~ '^[0-9]{1,8}$' then
      raise sqlstate 'PT400' using message = 'Invalid hint context.';
    end if;
    hint_item_index := (hint_context->>'itemIndex')::integer;
    if not pandiwasto_private.allow_study_hint(account_id, active_run, hint_context->>'skillId', hint_item_index) then
      raise sqlstate 'PT403' using message = 'A hint is not available for this move.';
    end if;
  elsif action->'action'->>'type' = 'hint' then
    raise sqlstate 'PT400' using message = 'Hint context is required.';
  end if;

  next_version := expected_version + 1;
  acted_at := clock_timestamp();

  insert into pandiwasto_private.arcade_ranked_moves (run_id, request_id, move_version, action, response, recorded_at)
  values (active_run, request_id, next_version, action, response, acted_at);

  for observation in
    select * from jsonb_to_recordset(observations) as event(
      "skillId" text, "itemId" text, "itemVersion" integer, "itemIndex" integer, correct boolean,
      "firstAttempt" boolean, "hintUsed" boolean, "timedOut" boolean, "responseMs" bigint
    )
  loop
    is_timeout := coalesce(observation."timedOut", false);
    if not pandiwasto_private.ranked_skill_allowed(game_run.game_id, observation."skillId")
        or observation."itemId" is null or char_length(observation."itemId") not between 1 and 120
        or coalesce(observation."itemVersion", 1) < 1 or coalesce(observation."itemIndex", 0) < 0
        or observation.correct is null or observation."firstAttempt" is null or observation."hintUsed" is null
        or observation."responseMs" is null or observation."responseMs" < 0 or (is_timeout and observation.correct) then
      raise sqlstate 'PT400' using message = 'Invalid scored observation.';
    end if;
    prior := null;
    learned := null;
    param_ver := null;
    if pandiwasto_private.counts_for_bkt(observation."firstAttempt", is_timeout) and not game_run.developer_run then
      select bkt.before_mastery, bkt.after_mastery, bkt.version into prior, learned, param_ver
      from pandiwasto_private.bkt_apply(account_id, observation."skillId", observation.correct, acted_at) as bkt;
    end if;
    insert into pandiwasto_private.arcade_ranked_observations
      (run_id, move_version, observation_index, item_index, skill_key, item_key, item_version,
       correct, first_attempt, hint_used, timed_out, response_ms, mastery_before, mastery_after, param_version, recorded_at)
    values (active_run, next_version, observed_index, coalesce(observation."itemIndex", 0),
      observation."skillId", observation."itemId", coalesce(observation."itemVersion", 1),
      observation.correct, observation."firstAttempt", observation."hintUsed", is_timeout,
      observation."responseMs", prior, learned, param_ver, acted_at);
    observed_index := observed_index + 1;
  end loop;

  update pandiwasto_private.arcade_ranked_states work set version = next_version, state = state
  where work.run_id = active_run;

  if complete then
    update pandiwasto_private.arcade_runs set status = 'completed', finished_at = acted_at, score = score, xp = awarded_xp
    where id = active_run;
    if not game_run.developer_run then
      update pandiwasto_private.arcade_progress set xp = xp + awarded_xp where player_id = account_id;
      if score > 0 and not ranked.practice then
        perform public.pandiwasto_record_game_score(game_run.game_id, account_id, score);
      end if;
    end if;
  elsif abandon then
    update pandiwasto_private.arcade_runs set status = 'abandoned', finished_at = acted_at where id = active_run;
  end if;

  return pandiwasto_private.ranked_snapshot(active_run) || jsonb_build_object('response', response);
end;
$$;

create or replace function public.pandiwasto_admin_study_export(account_id uuid, study_id uuid, dataset text, page_number integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare results jsonb;
begin
  perform pandiwasto_private.require_study_admin(account_id);
  if dataset is null or dataset not in ('assessment', 'attempt', 'hint', 'parameter', 'survey') or page_number is null or page_number not between 0 and 10000 then
    raise sqlstate 'PT400' using message = 'Choose a dataset and a valid page.';
  end if;
  if not exists (select 1 from pandiwasto_private.study_cohorts c where c.id = study_id) then
    raise sqlstate 'PT404' using message = 'Study cohort not found.';
  end if;
  if dataset = 'assessment' then
    select coalesce(jsonb_agg(records.payload order by records.participant, records.phase), '[]'::jsonb) into results from (
      select p.id as participant, a.phase,
        jsonb_build_object('participantId', p.id, 'condition', p.condition, 'phase', a.phase, 'points', a.points, 'total', a.total,
          'skills', coalesce((
            select jsonb_object_agg(scored.skill_key, jsonb_build_object('points', scored.points, 'total', scored.total))
            from (
              select q.skill_key, count(*) filter (where q.answer::text = response.value->>'choice') as points, count(*) as total
              from jsonb_array_elements(a.choices) as response(value)
              join pandiwasto_private.study_questions q on q.id = (response.value->>'itemId')::uuid
              group by q.skill_key
            ) scored), '{}'::jsonb)) as payload
      from pandiwasto_private.study_participants p join pandiwasto_private.study_assessments a on a.participant_id = p.id
      where p.cohort_id = study_id and p.consented_at is not null and p.withdrawn_at is null
      order by p.id, a.phase limit 201 offset page_number * 200
    ) records;
  elsif dataset = 'attempt' then
    select coalesce(jsonb_agg(records.payload order by records.participant, records.game_run, records.recorded_at, records.move_number, records.observation_index), '[]'::jsonb) into results from (
      select p.id as participant, obs.run_id as game_run, obs.recorded_at, obs.move_number, obs.observation_index,
        jsonb_build_object('participantId', p.id, 'condition', p.condition, 'gameId', obs.game_id, 'runId', obs.run_id,
          'move', obs.move_number, 'observation', obs.observation_index, 'item', obs.item_key,
          'skill', obs.skill_key, 'itemVersion', obs.item_version, 'correct', obs.correct, 'firstAttempt', obs.first_attempt,
          'hintUsed', obs.hint_used, 'timedOut', obs.timed_out, 'responseMs', obs.response_ms,
          'masteryBefore', obs.mastery_before, 'masteryAfter', obs.mastery_after, 'paramVersion', obs.param_version, 'recordedAt', obs.recorded_at) as payload
      from pandiwasto_private.study_participants p join pandiwasto_private.study_cohorts c on c.id = p.cohort_id
      join pandiwasto_private.study_runs s on s.participant_id = p.id
      join pandiwasto_private.scored_answers obs on obs.run_id = s.run_id
      where p.cohort_id = study_id and p.consented_at is not null and p.withdrawn_at is null
        and obs.recorded_at >= p.consented_at and obs.recorded_at < c.posttest_at
      order by p.id, obs.run_id, obs.recorded_at, obs.move_number, obs.observation_index limit 201 offset page_number * 200
    ) records;
  elsif dataset = 'hint' then
    select coalesce(jsonb_agg(records.payload order by records.participant, records.hint_id), '[]'::jsonb) into results from (
      select p.id as participant, h.id as hint_id,
        jsonb_build_object('participantId', p.id, 'condition', p.condition, 'gameId', run.game_id, 'runId', run.id,
          'item', h.item_index, 'skill', h.skill_key, 'level', h.hint_level, 'mastery', h.mastery, 'source', h.source,
          'model', h.model, 'latencyMs', h.latency_ms, 'cacheHit', h.cache_hit, 'text', h.hint_text, 'recordedAt', h.recorded_at,
          'trigger', h.hint_trigger, 'promptVersion', h.prompt_version, 'inputTokens', h.input_tokens, 'outputTokens', h.output_tokens,
          'helpful', h.helpful) as payload
      from pandiwasto_private.study_participants p join pandiwasto_private.study_cohorts c on c.id = p.cohort_id
      join pandiwasto_private.study_runs s on s.participant_id = p.id
      join pandiwasto_private.arcade_runs run on run.id = s.run_id
      join pandiwasto_private.arcade_hints h on h.run_id = run.id
      where p.cohort_id = study_id and p.consented_at is not null and p.withdrawn_at is null
        and h.recorded_at >= p.consented_at and h.recorded_at < c.posttest_at
      order by p.id, h.id limit 201 offset page_number * 200
    ) records;
  elsif dataset = 'survey' then
    select coalesce(jsonb_agg(records.payload order by records.participant), '[]'::jsonb) into results from (
      select p.id as participant,
        jsonb_build_object('participantId', p.id, 'condition', p.condition, 'responses', v.responses, 'comment', v.comment, 'submittedAt', v.submitted_at) as payload
      from pandiwasto_private.study_participants p join pandiwasto_private.study_surveys v on v.participant_id = p.id
      where p.cohort_id = study_id and p.consented_at is not null and p.withdrawn_at is null
      order by p.id limit 201 offset page_number * 200
    ) records;
  else
    select coalesce(jsonb_agg(records.payload order by records.skill_key, records.param_version), '[]'::jsonb) into results from (
      select v.skill_key, v.param_version,
        jsonb_build_object('skill', v.skill_key, 'paramVersion', v.param_version, 'initial', v.initial_mastery, 'learn', v.learn_rate,
          'guess', v.guess_rate, 'slip', v.slip_rate, 'masteryThreshold', v.mastery_threshold, 'recordedAt', v.recorded_at) as payload
      from pandiwasto_private.arcade_skill_versions v
      order by v.skill_key, v.param_version limit 201 offset page_number * 200
    ) records;
  end if;
  insert into pandiwasto_private.study_exports_log (actor_id, cohort_id, dataset, page_number)
  values (account_id, study_id, $3, $4);
  return jsonb_build_object('records', jsonb_path_query_array(results, '$[0 to 199]'), 'hasMore', jsonb_array_length(results) > 200);
end
$$;

create or replace function public.pandiwasto_admin_class_member(account_id uuid, class_id uuid, target_lookup text, add_member boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare staff text := pandiwasto_private.staff_role(account_id); target uuid; class_name text;
begin
  if staff is null then raise sqlstate 'PT403' using message = 'Staff access required.'; end if;
  if add_member is null then raise sqlstate 'PT400' using message = 'Choose add or remove.'; end if;
  select c.name into class_name from pandiwasto_private.arcade_classes c
  where c.id = $2 and (staff = 'admin' or c.teacher_id = account_id) for update;
  if not found then raise sqlstate 'PT404' using message = 'Class not found.'; end if;
  target := pandiwasto_private.find_confirmed_player(target_lookup);
  if add_member then
    -- Classes hold learners; staff accounts are managed in Accounts.
    if pandiwasto_private.staff_role(target) is not null then
      raise sqlstate 'PT409' using message = 'Only student accounts can join a class.';
    end if;
    -- A teacher cannot take a student from another class; an admin can move them.
    if staff = 'teacher' and exists (select 1 from pandiwasto_private.arcade_class_members m where m.player_id = target and m.class_id <> $2) then
      raise sqlstate 'PT409' using message = 'This student is already in another class. Ask an admin to move them.';
    end if;
    insert into pandiwasto_private.arcade_class_members (class_id, player_id) values ($2, target) on conflict do nothing;
  else
    delete from pandiwasto_private.arcade_class_members m where m.class_id = $2 and m.player_id = target;
  end if;
  insert into pandiwasto_private.arcade_account_log (actor_id, subject_id, action, detail)
  values (account_id, target, case when add_member then 'class_add' else 'class_remove' end, left(class_name, 200));
  return jsonb_build_object('students', (select count(*) from pandiwasto_private.arcade_class_members m where m.class_id = $2));
end
$$;

alter table pandiwasto_private.study_exports_log drop constraint study_exports_log_dataset_check;
alter table pandiwasto_private.study_exports_log add constraint study_exports_log_dataset_check
  check (dataset in ('assessment', 'attempt', 'hint', 'parameter', 'survey'));

revoke all on function pandiwasto_private.counts_for_bkt(boolean, boolean) from public, anon, authenticated, service_role;
revoke all on function
  public.pandiwasto_admin_settings(uuid), public.pandiwasto_admin_settings_update(uuid, boolean),
  public.pandiwasto_admin_study_options(uuid, uuid, numeric, integer, boolean, timestamptz),
  public.pandiwasto_survey_submit(uuid, jsonb, text), public.pandiwasto_survey_status(uuid),
  public.pandiwasto_hint_log(uuid, uuid, text, integer, integer, text, text, text, integer, boolean, text, text, integer, integer),
  public.pandiwasto_hint_mastery(uuid, text), public.pandiwasto_hint_rate(uuid, uuid, bigint, boolean)
  from public, anon, authenticated, service_role;
grant execute on function
  public.pandiwasto_admin_settings(uuid), public.pandiwasto_admin_settings_update(uuid, boolean),
  public.pandiwasto_admin_study_options(uuid, uuid, numeric, integer, boolean, timestamptz),
  public.pandiwasto_survey_submit(uuid, jsonb, text), public.pandiwasto_survey_status(uuid),
  public.pandiwasto_hint_log(uuid, uuid, text, integer, integer, text, text, text, integer, boolean, text, text, integer, integer),
  public.pandiwasto_hint_mastery(uuid, text), public.pandiwasto_hint_rate(uuid, uuid, bigint, boolean)
  to service_role;

commit;