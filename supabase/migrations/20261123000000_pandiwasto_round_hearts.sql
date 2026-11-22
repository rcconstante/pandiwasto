begin;

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
  skill pandiwasto_private.arcade_skills%rowtype;
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
  posterior numeric;
  learned numeric;
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
    select * into strict skill from pandiwasto_private.arcade_skills where skill_key = round_item.skill_key;
    select probability into prior from pandiwasto_private.arcade_mastery
    where player_id = account_id and skill_key = round_item.skill_key;
    prior := coalesce(prior, skill.initial_mastery);
    if correct_answer then
      posterior := (prior * (1 - skill.slip_rate)) / (prior * (1 - skill.slip_rate) + (1 - prior) * skill.guess_rate);
    else
      posterior := (prior * skill.slip_rate) / (prior * skill.slip_rate + (1 - prior) * (1 - skill.guess_rate));
    end if;
    learned := round(posterior + (1 - posterior) * skill.learn_rate, 10);

    insert into pandiwasto_private.arcade_mastery as current_mastery
      (player_id, skill_key, probability, observations, updated_at)
    values (account_id, round_item.skill_key, learned, 1, acted_at)
    on conflict (player_id, skill_key) do update
    set probability = excluded.probability, observations = current_mastery.observations + 1, updated_at = excluded.updated_at;
  end if;

  -- Insert before building the new snapshot so its hadMiss state is current.
  insert into pandiwasto_private.arcade_attempts
    (run_id, request_id, round_index, response, correct, first_attempt, hint_used, response_ms, recorded_at, mastery_before, mastery_after, result)
  values (active_run, answer_id, expected_round, response, correct_answer, first_attempt, used_hint,
    greatest(0, extract(epoch from (acted_at - game_run.round_started_at)) * 1000)::bigint,
    acted_at, prior, learned, '{}'::jsonb);

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

create or replace function public.pandiwasto_pop_tap(
  account_id uuid, active_run uuid, tap_id uuid, expected_round integer, removed integer[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  game_run pandiwasto_private.arcade_runs%rowtype;
  existing_event pandiwasto_private.arcade_pop_events%rowtype;
  puzzle record;
  retained text;
  solution_index integer;
  relative_position integer;
  scanned integer := 0;
  preserves_root boolean := true;
  tap_result jsonb;
begin
  if active_run is null or tap_id is null or expected_round is null or expected_round not between 0 and 4
      or removed is null or cardinality(removed) not between 1 and 12 then
    raise sqlstate 'PT400' using message = 'Invalid balloon selection.';
  end if;

  perform pandiwasto_private.lock_arcade_account(account_id);
  select run.* into game_run from pandiwasto_private.arcade_runs as run
  where run.id = active_run and run.player_id = account_id and run.game_id = 1;
  if not found then
    raise sqlstate 'PT404' using message = 'Game run not found.';
  end if;

  select event.* into existing_event from pandiwasto_private.arcade_pop_events as event
  where event.run_id = active_run and event.request_id = tap_id;
  if found then
    if (existing_event.round_index, existing_event.removed) is distinct from (expected_round, removed) then
      raise sqlstate 'PT409' using message = 'That balloon request ID was already used.';
    end if;
    return existing_event.result;
  end if;
  if game_run.status <> 'active' or game_run.current_round <> expected_round then
    raise sqlstate 'PT409' using message = 'This round is no longer active.';
  end if;

  select item.prompt, item.solution into strict puzzle
  from pandiwasto_private.arcade_run_items as dealt
  join pandiwasto_private.arcade_items as item
    on (item.game_id, item.item_key, item.version) = (dealt.game_id, dealt.item_key, dealt.item_version)
  where dealt.run_id = active_run and dealt.round_index = expected_round;

  if exists (select 1 from unnest(removed) as positions(pos) where pos is null or pos < 0 or pos >= char_length(puzzle.prompt))
      or cardinality(removed) <> (select count(distinct pos) from unnest(removed) as positions(pos)) then
    raise sqlstate 'PT400' using message = 'Invalid balloon selection.';
  end if;
  select coalesce(string_agg(substr(puzzle.prompt, pos + 1, 1), '' order by pos), '') into retained
  from generate_series(0, char_length(puzzle.prompt) - 1) as positions(pos)
  where pos <> all (removed);

  -- Accept any arrangement of repeated letters that can still form the root.
  for solution_index in 1..char_length(puzzle.solution) loop
    relative_position := strpos(substr(retained, scanned + 1), substr(puzzle.solution, solution_index, 1));
    if relative_position = 0 then
      preserves_root := false;
      exit;
    end if;
    scanned := scanned + relative_position;
  end loop;

  if retained = puzzle.solution then
    tap_result := public.pandiwasto_pop_answer(account_id, active_run, tap_id, expected_round, retained)
      || jsonb_build_object('outcome', 'solved');
  elsif not preserves_root then
    tap_result := public.pandiwasto_pop_answer(account_id, active_run, tap_id, expected_round, retained)
      || jsonb_build_object('outcome', 'miss');
  else
    tap_result := pandiwasto_private.pop_snapshot(active_run) || jsonb_build_object('outcome', 'continue');
  end if;

  if tap_result->>'skipped' = 'true' then
    tap_result := tap_result || jsonb_build_object('outcome', 'skip');
  end if;

  if not preserves_root or retained = puzzle.solution then
    insert into pandiwasto_private.arcade_pop_events (run_id, request_id, round_index, removed, result)
    values (active_run, tap_id, expected_round, removed, tap_result);
  end if;
  return tap_result;
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
  skill pandiwasto_private.arcade_skills%rowtype;
  observed_index integer := 0;
  next_version integer;
  acted_at timestamptz;
  prior numeric;
  posterior numeric;
  learned numeric;
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
    if observation."firstAttempt" and not observation."hintUsed" and not is_timeout and not game_run.developer_run then
      select * into strict skill from pandiwasto_private.arcade_skills where skill_key = observation."skillId";
      select probability into prior from pandiwasto_private.arcade_mastery
      where player_id = account_id and skill_key = observation."skillId";
      prior := coalesce(prior, skill.initial_mastery);
      if observation.correct then
        posterior := (prior * (1 - skill.slip_rate)) / (prior * (1 - skill.slip_rate) + (1 - prior) * skill.guess_rate);
      else
        posterior := (prior * skill.slip_rate) / (prior * skill.slip_rate + (1 - prior) * (1 - skill.guess_rate));
      end if;
      learned := round(posterior + (1 - posterior) * skill.learn_rate, 10);
      insert into pandiwasto_private.arcade_mastery as current_mastery
        (player_id, skill_key, probability, observations, updated_at)
      values (account_id, observation."skillId", learned, 1, acted_at)
      on conflict (player_id, skill_key) do update
      set probability = excluded.probability, observations = current_mastery.observations + 1, updated_at = excluded.updated_at;
    end if;
    insert into pandiwasto_private.arcade_ranked_observations
      (run_id, move_version, observation_index, item_index, skill_key, item_key, item_version,
       correct, first_attempt, hint_used, timed_out, response_ms, mastery_before, mastery_after, recorded_at)
    values (active_run, next_version, observed_index, coalesce(observation."itemIndex", 0),
      observation."skillId", observation."itemId", coalesce(observation."itemVersion", 1),
      observation.correct, observation."firstAttempt", observation."hintUsed", is_timeout,
      observation."responseMs", prior, learned, acted_at);
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

commit;
