begin;

create table pandiwasto_private.arcade_developers (
  player_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false
);
create table pandiwasto_private.arcade_developer_resets (
  player_id uuid not null references pandiwasto_private.arcade_developers(player_id) on delete cascade,
  request_id uuid not null,
  scope text not null check (scope in ('xp', 'gameplay')),
  primary key (player_id, request_id)
);
alter table pandiwasto_private.arcade_developers enable row level security;
alter table pandiwasto_private.arcade_developer_resets enable row level security;
revoke all on pandiwasto_private.arcade_developers, pandiwasto_private.arcade_developer_resets from public, anon, authenticated;
alter table pandiwasto_private.arcade_runs add column developer_run boolean not null default false;

create function pandiwasto_private.developer_available(account_id uuid)
returns boolean language sql stable set search_path = ''
as $$
  select exists (select 1 from pandiwasto_private.arcade_developers where player_id = account_id)
    and not exists (
      select 1 from pandiwasto_private.study_participants p
      join pandiwasto_private.study_cohorts c on c.id = p.cohort_id
      where p.player_id = account_id and p.consented_at is not null and p.withdrawn_at is null and now() < c.closes_at
    );
$$;

create function pandiwasto_private.developer_enabled(account_id uuid)
returns boolean language sql stable set search_path = ''
as $$
  select pandiwasto_private.developer_available(account_id)
    and exists (select 1 from pandiwasto_private.arcade_developers where player_id = account_id and enabled);
$$;

create function pandiwasto_private.mark_developer_run()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.developer_run := pandiwasto_private.developer_enabled(new.player_id);
  return new;
end;
$$;
create trigger arcade_mark_developer_run before insert on pandiwasto_private.arcade_runs
for each row execute function pandiwasto_private.mark_developer_run();

create or replace function public.pandiwasto_arcade_progress(account_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'xp', coalesce((select xp from pandiwasto_private.arcade_progress where player_id = account_id), 0),
    'bestScores', coalesce((select jsonb_object_agg(game_id, best_score)
      from public.pandiwasto_game_scores where player_id = account_id), '{}'::jsonb),
    'developer', jsonb_build_object('available', pandiwasto_private.developer_available(account_id),
      'enabled', pandiwasto_private.developer_enabled(account_id))
  );
$$;

create function public.pandiwasto_developer_mode(account_id uuid, enable_testing boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if enable_testing is null then
    raise sqlstate 'PT400' using message = 'Choose a developer mode state.';
  end if;
  perform pandiwasto_private.lock_arcade_account(account_id);
  if not pandiwasto_private.developer_available(account_id) then
    raise sqlstate 'PT403' using message = 'Developer mode is unavailable for this account.';
  end if;
  update pandiwasto_private.arcade_developers set enabled = enable_testing
  where player_id = account_id and enabled is distinct from enable_testing;
  if found then
    update pandiwasto_private.arcade_runs set status = 'abandoned', finished_at = clock_timestamp()
    where player_id = account_id and status = 'active';
  end if;
  return public.pandiwasto_arcade_progress(account_id);
end;
$$;

create function public.pandiwasto_developer_reset(account_id uuid, reset_scope text, reset_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare prior_scope text;
begin
  if reset_id is null or reset_scope is null or reset_scope not in ('xp', 'gameplay') then
    raise sqlstate 'PT400' using message = 'Choose a valid reset.';
  end if;
  perform pandiwasto_private.lock_arcade_account(account_id);
  if not pandiwasto_private.developer_enabled(account_id) then
    raise sqlstate 'PT403' using message = 'Enable developer mode before resetting progress.';
  end if;
  select scope into prior_scope from pandiwasto_private.arcade_developer_resets
  where player_id = account_id and request_id = reset_id;
  if found then
    if prior_scope <> reset_scope then
      raise sqlstate 'PT409' using message = 'This reset ID was already used.';
    end if;
    return public.pandiwasto_arcade_progress(account_id);
  end if;

  update pandiwasto_private.arcade_runs set status = 'abandoned', finished_at = clock_timestamp()
  where player_id = account_id and status = 'active';
  update pandiwasto_private.arcade_progress set xp = 0 where player_id = account_id;
  if reset_scope = 'gameplay' then
    delete from public.pandiwasto_game_scores where player_id = account_id;
    delete from pandiwasto_private.arcade_mastery where player_id = account_id;
    delete from pandiwasto_private.arcade_runs as r where r.player_id = account_id
      and not exists (select 1 from pandiwasto_private.study_runs s where s.run_id = r.id);
  end if;
  insert into pandiwasto_private.arcade_developer_resets (player_id, request_id, scope)
  values (account_id, reset_id, reset_scope);
  return public.pandiwasto_arcade_progress(account_id);
end;
$$;

revoke all on function pandiwasto_private.developer_available(uuid),
  pandiwasto_private.developer_enabled(uuid), pandiwasto_private.mark_developer_run(),
  public.pandiwasto_developer_mode(uuid, boolean), public.pandiwasto_developer_reset(uuid, text, uuid)
from public, anon, authenticated;
grant execute on function public.pandiwasto_developer_mode(uuid, boolean),
  public.pandiwasto_developer_reset(uuid, text, uuid) to service_role;

-- Classify runs when they begin so switching modes cannot publish test results.
create or replace function pandiwasto_private.attach_study_run(account_id uuid, run_id uuid)
returns void language sql security definer set search_path = ''
as $$
  insert into pandiwasto_private.study_runs (run_id, participant_id)
  select $2, p.id from pandiwasto_private.study_participants p join pandiwasto_private.study_cohorts c on c.id = p.cohort_id
  join pandiwasto_private.study_assessments a on a.participant_id = p.id and a.phase = 'pre'
  where p.player_id = account_id and p.consented_at is not null and p.withdrawn_at is null and now() >= c.opens_at and now() < c.posttest_at
    and exists (select 1 from pandiwasto_private.arcade_runs where id = $2 and not developer_run)
  on conflict do nothing;
$$;

create or replace function public.pandiwasto_pop_start(account_id uuid, request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  chosen_run uuid;
  first_run boolean;
begin
  if request_id is null then
    raise sqlstate 'PT400' using message = 'A start request ID is required.';
  end if;

  perform pandiwasto_private.lock_arcade_account(account_id);

  select request.run_id into chosen_run
  from pandiwasto_private.arcade_start_requests request
  where request.player_id = account_id and request.request_id = request_id;
  if found then
    return pandiwasto_private.pop_snapshot(chosen_run);
  end if;

  update pandiwasto_private.arcade_runs set status = 'abandoned', finished_at = clock_timestamp()
  where player_id = account_id and game_id = 1 and status = 'active'
    and developer_run is distinct from pandiwasto_private.developer_enabled(account_id);

  select run.id into chosen_run from pandiwasto_private.arcade_runs run
  where run.player_id = account_id and run.game_id = 1 and run.status = 'active';
  if not found then
    select not exists (select 1 from pandiwasto_private.arcade_runs where player_id = account_id and game_id = 1
      and developer_run = pandiwasto_private.developer_enabled(account_id)) into first_run;

    insert into pandiwasto_private.arcade_runs (player_id, game_id, total_rounds, hearts)
    values (account_id, 1, 5, 3) returning id into chosen_run;

    insert into pandiwasto_private.arcade_run_items (run_id, game_id, round_index, item_key, item_version)
    select chosen_run, dealt.game_id, (row_number() over (order by dealt.tutorial desc, dealt.draw)) - 1, dealt.item_key, dealt.version
    from (
      select current_item.*, (first_run and current_item.item_key = 'sumakay') as tutorial, random() as draw
      from (
        select distinct on (item_key) game_id, item_key, version from pandiwasto_private.arcade_items
        where game_id = 1 and enabled order by item_key, version desc
      ) current_item
      order by tutorial desc, draw
      limit 5
    ) dealt;
    if (select count(*) from pandiwasto_private.arcade_run_items item where item.run_id = chosen_run) <> 5 then
      raise sqlstate 'PT503' using message = 'Pop Goes the Word is temporarily unavailable.';
    end if;
  end if;

  insert into pandiwasto_private.arcade_start_requests (player_id, request_id, run_id)
  values (account_id, request_id, chosen_run);
  return pandiwasto_private.pop_snapshot(chosen_run);
end;
$$;

create or replace function public.pandiwasto_ranked_start(account_id uuid, game integer, request_id uuid, state jsonb, practice boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  previous_request pandiwasto_private.arcade_ranked_start_requests%rowtype;
  chosen_run uuid;
  account_xp integer;
begin
  if game is null or game not between 2 and 7 or request_id is null or practice is null
      or (practice and game <> 2)
      or state is null or jsonb_typeof(state) <> 'object' or pg_column_size(state) > 131072 then
    raise sqlstate 'PT400' using message = 'A valid game, mode, start ID, and initial state are required.';
  end if;
  perform pandiwasto_private.lock_arcade_account(account_id);

  select request.* into previous_request
  from pandiwasto_private.arcade_ranked_start_requests request
  where request.player_id = account_id and request.request_id = request_id;
  if found then
    if (previous_request.game_id, previous_request.practice) is distinct from (game, practice) then
      raise sqlstate 'PT409' using message = 'That start request ID was already used.';
    end if;
    return pandiwasto_private.ranked_snapshot(previous_request.run_id);
  end if;

  select xp into strict account_xp from pandiwasto_private.arcade_progress where player_id = account_id;
  if account_xp < 200 * (game - 1) and not pandiwasto_private.study_is_practicing(account_id)
      and not pandiwasto_private.developer_enabled(account_id) then
    raise sqlstate 'PT403' using message = 'This game is still locked.';
  end if;

  update pandiwasto_private.arcade_runs set status = 'abandoned', finished_at = clock_timestamp()
  where player_id = account_id and game_id = game and status = 'active'
    and developer_run is distinct from pandiwasto_private.developer_enabled(account_id);

  select run.id into chosen_run from pandiwasto_private.arcade_runs run
  where run.player_id = account_id and run.game_id = game and run.status = 'active';
  if not found then
    insert into pandiwasto_private.arcade_runs (player_id, game_id, total_rounds)
    values (account_id, game, case game when 2 then null when 4 then 3 else 5 end) returning id into chosen_run;
    insert into pandiwasto_private.arcade_ranked_states (run_id, state, practice)
    values (chosen_run, state, practice);
    perform pandiwasto_private.attach_study_run(account_id, chosen_run);
  end if;

  insert into pandiwasto_private.arcade_ranked_start_requests (player_id, request_id, run_id, game_id, practice)
  values (account_id, request_id, chosen_run, game, practice);
  return pandiwasto_private.ranked_snapshot(chosen_run);
end;
$$;

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
  reached_end := case when correct_answer then game_run.current_round = game_run.total_rounds - 1 else game_run.hearts = 1 end;

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
    hearts = run.hearts - case when correct_answer then 0 else 1 end,
    current_round = run.current_round + case when correct_answer and not reached_end then 1 else 0 end,
    round_started_at = case when correct_answer and not reached_end then acted_at else run.round_started_at end,
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
    'root', case when correct_answer or reached_end then round_item.solution end,
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
  elsif score is null or score < 0 or score > (case when game_run.game_id = 4 then 1200 else 500 end) or awarded_xp <> 100 then
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
