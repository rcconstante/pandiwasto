begin;

-- BKT parameters are versioned so every logged estimate can be traced and replayed.
alter table pandiwasto_private.arcade_skills
  add column param_version integer not null default 1 check (param_version > 0),
  add column mastery_threshold numeric not null default 0.95 check (mastery_threshold > 0.5 and mastery_threshold <= 1);
alter table pandiwasto_private.arcade_mastery add column mastered_at timestamptz;
alter table pandiwasto_private.arcade_attempts add column param_version integer check (param_version > 0);
alter table pandiwasto_private.arcade_ranked_observations add column param_version integer check (param_version > 0);
alter table pandiwasto_private.arcade_run_items add column hint_level smallint not null default 0 check (hint_level between 0 and 3);
update pandiwasto_private.arcade_run_items set hint_level = 1 where hint_requested_at is not null;

create function pandiwasto_private.bump_skill_version()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if (new.initial_mastery, new.learn_rate, new.guess_rate, new.slip_rate, new.mastery_threshold)
      is distinct from (old.initial_mastery, old.learn_rate, old.guess_rate, old.slip_rate, old.mastery_threshold) then
    new.param_version := old.param_version + 1;
  end if;
  return new;
end;
$$;
create trigger arcade_skill_version before update on pandiwasto_private.arcade_skills
for each row execute function pandiwasto_private.bump_skill_version();

-- Spec default prior when no pretest subscore exists. Guess rates stay at each
-- game's chance level; the 0.3 ceiling applies only when fitting pilot data.
update pandiwasto_private.arcade_skills set initial_mastery = 0.3;

-- P(L0) from the learner's latest pretest subscore for the skill, clamped to [0.1, 0.9].
create function pandiwasto_private.bkt_prior(account_id uuid, skill text, fallback numeric)
returns numeric language sql stable set search_path = ''
as $$
  -- greatest() and least() skip nulls, so clamp only a real subscore.
  select coalesce((
    select least(0.9, greatest(0.1, scored.subscore)) from (
      select avg((q.answer::text = response.value->>'choice')::integer) as subscore
      from (
        select a.choices from pandiwasto_private.study_assessments a
        join pandiwasto_private.study_participants p on p.id = a.participant_id
        where p.player_id = $1 and p.withdrawn_at is null and a.phase = 'pre'
        order by a.completed_at desc limit 1
      ) latest
      cross join jsonb_array_elements(latest.choices) as response(value)
      join pandiwasto_private.study_questions q on q.id = (response.value->>'itemId')::uuid and q.skill_key = $2
    ) scored where scored.subscore is not null
  ), $3);
$$;

-- The only BKT update in the database. Formulas match supabase/functions/arcade/bkt.ts.
create function pandiwasto_private.bkt_apply(
  account_id uuid, skill text, answered_correctly boolean, acted_at timestamptz,
  out before_mastery numeric, out after_mastery numeric, out version integer
)
language plpgsql set search_path = ''
as $$
declare
  params pandiwasto_private.arcade_skills%rowtype;
  posterior numeric;
begin
  select s.* into strict params from pandiwasto_private.arcade_skills s where s.skill_key = skill;
  select m.probability into before_mastery from pandiwasto_private.arcade_mastery m
  where m.player_id = account_id and m.skill_key = skill;
  before_mastery := coalesce(before_mastery, pandiwasto_private.bkt_prior(account_id, skill, params.initial_mastery));
  posterior := case when answered_correctly
    then before_mastery * (1 - params.slip_rate) / (before_mastery * (1 - params.slip_rate) + (1 - before_mastery) * params.guess_rate)
    else before_mastery * params.slip_rate / (before_mastery * params.slip_rate + (1 - before_mastery) * (1 - params.guess_rate))
  end;
  after_mastery := round(posterior + (1 - posterior) * params.learn_rate, 10);
  version := params.param_version;

  insert into pandiwasto_private.arcade_mastery as current_mastery
    (player_id, skill_key, probability, observations, updated_at, mastered_at)
  values (account_id, skill, after_mastery, 1, acted_at, case when after_mastery >= params.mastery_threshold then acted_at end)
  on conflict (player_id, skill_key) do update
  set probability = excluded.probability, observations = current_mastery.observations + 1, updated_at = excluded.updated_at,
    mastered_at = case when excluded.probability >= params.mastery_threshold
      then coalesce(current_mastery.mastered_at, excluded.updated_at) end;
end;
$$;

-- Every scored answer from both game engines, for hint triggers, teacher views and exports.
create view pandiwasto_private.scored_answers as
  select run.player_id, run.id as run_id, run.game_id, run.developer_run, item.skill_key, dealt.item_key, dealt.item_version,
    a.round_index as item_index, row_number() over (partition by a.run_id order by a.recorded_at, a.request_id) as move_number,
    0 as observation_index, a.correct, a.first_attempt, a.hint_used, false as timed_out, a.response_ms,
    a.mastery_before, a.mastery_after, a.param_version, a.recorded_at
  from pandiwasto_private.arcade_attempts a
  join pandiwasto_private.arcade_runs run on run.id = a.run_id
  join pandiwasto_private.arcade_run_items dealt on (dealt.run_id, dealt.round_index) = (a.run_id, a.round_index)
  join pandiwasto_private.arcade_items item on (item.game_id, item.item_key, item.version) = (dealt.game_id, dealt.item_key, dealt.item_version)
  union all
  select run.player_id, run.id, run.game_id, run.developer_run, o.skill_key, o.item_key, o.item_version,
    o.item_index, o.move_version, o.observation_index, o.correct, o.first_attempt, o.hint_used, o.timed_out, o.response_ms,
    o.mastery_before, o.mastery_after, o.param_version, o.recorded_at
  from pandiwasto_private.arcade_ranked_observations o
  join pandiwasto_private.arcade_runs run on run.id = o.run_id;
revoke all on pandiwasto_private.scored_answers from public, anon, authenticated, service_role;

create table pandiwasto_private.arcade_hints (
  id bigint generated always as identity primary key,
  run_id uuid not null references pandiwasto_private.arcade_runs (id) on delete cascade,
  item_index integer not null check (item_index >= 0),
  skill_key text not null references pandiwasto_private.arcade_skills (skill_key),
  hint_level smallint not null check (hint_level between 1 and 3),
  hint_condition text check (hint_condition in ('A', 'B', 'C')),
  mastery numeric check (mastery between 0 and 1),
  source text not null check (source in ('authored', 'ai')),
  model text check (char_length(model) <= 80),
  latency_ms integer not null check (latency_ms >= 0),
  cache_hit boolean not null,
  hint_text text not null check (char_length(hint_text) between 1 and 1000),
  recorded_at timestamptz not null default clock_timestamp()
);
create index arcade_hints_run on pandiwasto_private.arcade_hints (run_id);
alter table pandiwasto_private.arcade_hints enable row level security;
revoke all on pandiwasto_private.arcade_hints from public, anon, authenticated, service_role;

create function public.pandiwasto_hint_log(
  account_id uuid, active_run uuid, skill text, item_index integer, hint_level integer, hint_text text,
  hint_source text, model_name text, latency_ms integer, cache_hit boolean
)
returns void language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_variable
declare game integer; assignment text; prior numeric;
begin
  select run.game_id into game from pandiwasto_private.arcade_runs run where run.id = active_run and run.player_id = account_id;
  if not found then raise sqlstate 'PT404' using message = 'Game run not found.'; end if;
  if skill is null or not ((game = 1 and skill = 'salitang-ugat') or pandiwasto_private.ranked_skill_allowed(game, skill))
      or item_index is null or item_index < 0 or hint_level is null or hint_level not between 1 and 3
      or hint_text is null or char_length(hint_text) not between 1 and 1000 or hint_source is null or hint_source not in ('authored', 'ai')
      or latency_ms is null or latency_ms < 0 or cache_hit is null or char_length(model_name) > 80 then
    raise sqlstate 'PT400' using message = 'Invalid hint record.';
  end if;
  select p.condition into assignment from pandiwasto_private.study_runs s
  join pandiwasto_private.study_participants p on p.id = s.participant_id where s.run_id = active_run;
  select coalesce(m.probability, pandiwasto_private.bkt_prior(account_id, s.skill_key, s.initial_mastery)) into prior
  from pandiwasto_private.arcade_skills s
  left join pandiwasto_private.arcade_mastery m on m.skill_key = s.skill_key and m.player_id = account_id
  where s.skill_key = skill;
  insert into pandiwasto_private.arcade_hints
    (run_id, item_index, skill_key, hint_level, hint_condition, mastery, source, model, latency_ms, cache_hit, hint_text)
  values (active_run, item_index, skill, hint_level, assignment, prior, hint_source, model_name, latency_ms, cache_hit, hint_text);
end;
$$;

-- Condition A: a wrong answer while mastery is below 0.70, or while mastery has stalled
-- below the mastery threshold over the last three updates. Condition B: two misses in a
-- row on the same skill. Each ladder level counts toward the cap of four hints per run.
create or replace function pandiwasto_private.allow_study_hint(account_id uuid, run_id uuid, skill_key text, item_index int)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare
  assignment text; game integer; withdrawn boolean; used integer; misses integer; latest_correct boolean;
  probability numeric; threshold numeric; stalled boolean;
begin
  select p.condition, r.game_id, p.withdrawn_at is not null into assignment, game, withdrawn from pandiwasto_private.study_runs s
  join pandiwasto_private.study_participants p on p.id = s.participant_id
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
  select count(*) = 3 and (array_agg(o.mastery_after order by o.recorded_at desc))[1] <= (array_agg(o.mastery_before order by o.recorded_at desc))[3]
  into stalled
  from (select u.mastery_before, u.mastery_after, u.recorded_at from pandiwasto_private.scored_answers u
    where u.player_id = account_id and u.skill_key = $3 and u.mastery_after is not null
    order by u.recorded_at desc limit 3) as o;
  return coalesce(latest_correct = false and (probability < 0.7 or (stalled and probability < threshold)), false);
end
$$;

create or replace function pandiwasto_private.pop_snapshot(active_run uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'runId', run.id,
    'status', run.status,
    'round', run.current_round,
    'totalRounds', run.total_rounds,
    'hearts', run.hearts,
    'score', run.score,
    'xp', run.xp,
    'word', case when run.status = 'active' then item.prompt end,
    'hintUsed', round_item.hint_requested_at is not null,
    'hintLevel', round_item.hint_level,
    'hadMiss', exists (
      select 1 from pandiwasto_private.arcade_attempts attempt
      where attempt.run_id = run.id and attempt.round_index = run.current_round and not attempt.correct
    ),
    'studyActive', study.run_id is not null and pandiwasto_private.study_is_practicing(run.player_id),
    'hintAllowed', case
      when run.status = 'active' and round_item.hint_level < 3
      then pandiwasto_private.allow_study_hint(run.player_id, run.id, item.skill_key, run.current_round)
      else false
    end
  ))
  from pandiwasto_private.arcade_runs run
  join pandiwasto_private.arcade_run_items round_item
    on round_item.run_id = run.id and round_item.round_index = run.current_round
  join pandiwasto_private.arcade_items item
    on (item.game_id, item.item_key, item.version) = (round_item.game_id, round_item.item_key, round_item.item_version)
  left join pandiwasto_private.study_runs study on study.run_id = run.id
  where run.id = active_run and run.game_id = 1;
$$;

-- Each call asks for the next ladder level. A repeated level returns it without counting again.
drop function public.pandiwasto_pop_hint(uuid, uuid, integer);
create function public.pandiwasto_pop_hint(account_id uuid, active_run uuid, expected_round integer, requested_level integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  game_run pandiwasto_private.arcade_runs%rowtype;
  current_level integer;
  hint_result jsonb;
begin
  if active_run is null or expected_round is null or expected_round not between 0 and 4
      or requested_level is null or requested_level not between 1 and 3 then
    raise sqlstate 'PT400' using message = 'A run, round, and hint level are required.';
  end if;
  perform pandiwasto_private.lock_arcade_account(account_id);
  select run.* into game_run from pandiwasto_private.arcade_runs run
  where run.id = active_run and run.player_id = account_id and run.game_id = 1;
  if not found then
    raise sqlstate 'PT404' using message = 'Game run not found.';
  end if;
  if game_run.status <> 'active' or game_run.current_round <> expected_round then
    raise sqlstate 'PT409' using message = 'This round is no longer active.';
  end if;

  select dealt.hint_level into strict current_level from pandiwasto_private.arcade_run_items dealt
  where dealt.run_id = active_run and dealt.round_index = expected_round;
  if requested_level > current_level + 1 then
    raise sqlstate 'PT409' using message = 'Request the next hint level.';
  end if;
  if requested_level = current_level + 1 then
    update pandiwasto_private.arcade_run_items dealt
    set hint_level = requested_level, hint_requested_at = coalesce(dealt.hint_requested_at, clock_timestamp())
    where dealt.run_id = active_run and dealt.round_index = expected_round;
  end if;

  select jsonb_build_object('level', requested_level, 'fresh', requested_level = current_level + 1,
    'text', item.hint_text, 'word', item.prompt, 'root', item.solution, 'skill', item.skill_key)
  into strict hint_result
  from pandiwasto_private.arcade_run_items dealt
  join pandiwasto_private.arcade_items item
    on (item.game_id, item.item_key, item.version) = (dealt.game_id, dealt.item_key, dealt.item_version)
  where dealt.run_id = active_run and dealt.round_index = expected_round;
  return hint_result;
end;
$$;

-- Hearts are renewed on each new word; a missed final word still completes the run.
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

  -- Baseline research default: first unaided answers update mastery. Retain
  -- every answer and hint flag so the model can be recomputed under new rules.
  if first_attempt and not used_hint and not game_run.developer_run then
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

-- Only the trusted arcade function computes partial XP for completed runs.
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
    if observation."firstAttempt" and not observation."hintUsed" and not is_timeout and not game_run.developer_run then
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

create or replace function public.pandiwasto_arcade_mastery(account_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('skills', coalesce(jsonb_agg(jsonb_build_object(
    'skillId', skill_key, 'mastery', probability, 'attempts', observations, 'mastered', mastered_at is not null
  ) order by skill_key), '[]'::jsonb))
  from pandiwasto_private.arcade_mastery where player_id = account_id;
$$;

-- Exports add the BKT parameter version and a hint dataset for the hint research questions.
create or replace function public.pandiwasto_admin_study_export(account_id uuid, study_id uuid, dataset text, page_number integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare results jsonb;
begin
  perform pandiwasto_private.require_study_admin(account_id);
  if dataset is null or dataset not in ('assessment', 'attempt', 'hint') or page_number is null or page_number not between 0 and 10000 then
    raise sqlstate 'PT400' using message = 'Choose a dataset and a valid page.';
  end if;
  if not exists (select 1 from pandiwasto_private.study_cohorts c where c.id = study_id) then
    raise sqlstate 'PT404' using message = 'Study cohort not found.';
  end if;
  if dataset = 'assessment' then
    select coalesce(jsonb_agg(records.payload order by records.participant, records.phase), '[]'::jsonb) into results from (
      select p.id as participant, a.phase,
        jsonb_build_object('participantId', p.id, 'condition', p.condition, 'phase', a.phase, 'points', a.points, 'total', a.total) as payload
      from pandiwasto_private.study_participants p join pandiwasto_private.study_assessments a on a.participant_id = p.id
      where p.cohort_id = study_id and p.consented_at is not null and p.withdrawn_at is null
      order by p.id, a.phase limit 201 offset page_number * 200
    ) records;
  elsif dataset = 'attempt' then
    select coalesce(jsonb_agg(records.payload order by records.participant, records.game_run, records.move_number, records.observation_index), '[]'::jsonb) into results from (
      select p.id as participant, obs.run_id as game_run, obs.move_number, obs.observation_index,
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
      order by p.id, obs.run_id, obs.move_number, obs.observation_index limit 201 offset page_number * 200
    ) records;
  else
    select coalesce(jsonb_agg(records.payload order by records.participant, records.hint_id), '[]'::jsonb) into results from (
      select p.id as participant, h.id as hint_id,
        jsonb_build_object('participantId', p.id, 'condition', p.condition, 'gameId', run.game_id, 'runId', run.id,
          'item', h.item_index, 'skill', h.skill_key, 'level', h.hint_level, 'mastery', h.mastery, 'source', h.source,
          'model', h.model, 'latencyMs', h.latency_ms, 'cacheHit', h.cache_hit, 'text', h.hint_text, 'recordedAt', h.recorded_at) as payload
      from pandiwasto_private.study_participants p join pandiwasto_private.study_cohorts c on c.id = p.cohort_id
      join pandiwasto_private.study_runs s on s.participant_id = p.id
      join pandiwasto_private.arcade_runs run on run.id = s.run_id
      join pandiwasto_private.arcade_hints h on h.run_id = run.id
      where p.cohort_id = study_id and p.consented_at is not null and p.withdrawn_at is null
        and h.recorded_at >= p.consented_at and h.recorded_at < c.posttest_at
      order by p.id, h.id limit 201 offset page_number * 200
    ) records;
  end if;
  insert into pandiwasto_private.study_exports_log (actor_id, cohort_id, dataset, page_number)
  values (account_id, study_id, $3, $4);
  return jsonb_build_object('records', jsonb_path_query_array(results, '$[0 to 199]'), 'hasMore', jsonb_array_length(results) > 200);
end
$$;
alter table pandiwasto_private.study_exports_log drop constraint study_exports_log_dataset_check;
alter table pandiwasto_private.study_exports_log add check (dataset in ('assessment', 'attempt', 'hint'));

revoke all on function pandiwasto_private.bump_skill_version(), pandiwasto_private.bkt_prior(uuid, text, numeric),
  pandiwasto_private.bkt_apply(uuid, text, boolean, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.pandiwasto_hint_log(uuid, uuid, text, integer, integer, text, text, text, integer, boolean),
  public.pandiwasto_pop_hint(uuid, uuid, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.pandiwasto_hint_log(uuid, uuid, text, integer, integer, text, text, text, integer, boolean),
  public.pandiwasto_pop_hint(uuid, uuid, integer, integer)
  to service_role;

commit;
