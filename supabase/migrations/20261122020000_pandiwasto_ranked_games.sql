begin;

-- The existing run ledger also owns games 2–7. Endless Whack runs have no
-- fixed number of rounds. Pop continues to use its five-round state.
alter table pandiwasto_private.arcade_runs alter column total_rounds drop not null;
alter table pandiwasto_private.arcade_runs add check (game_id <> 1 or total_rounds is not null);

create table pandiwasto_private.arcade_ranked_states (
  run_id uuid primary key references pandiwasto_private.arcade_runs (id) on delete cascade,
  version integer not null default 0 check (version >= 0),
  practice boolean not null,
  state jsonb not null check (jsonb_typeof(state) = 'object')
);

create table pandiwasto_private.arcade_ranked_start_requests (
  player_id uuid not null,
  request_id uuid not null,
  run_id uuid not null,
  game_id integer not null check (game_id between 2 and 7),
  practice boolean not null,
  primary key (player_id, request_id),
  foreign key (run_id, player_id) references pandiwasto_private.arcade_runs (id, player_id) on delete cascade,
  foreign key (run_id, game_id) references pandiwasto_private.arcade_runs (id, game_id) on delete cascade
);

create table pandiwasto_private.arcade_ranked_moves (
  run_id uuid not null references pandiwasto_private.arcade_ranked_states (run_id) on delete cascade,
  request_id uuid not null,
  move_version integer not null check (move_version > 0),
  action jsonb not null check (jsonb_typeof(action) = 'object'),
  action_type text generated always as (action->'action'->>'type') stored,
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  recorded_at timestamptz not null,
  primary key (run_id, request_id),
  unique (run_id, move_version)
);

create table pandiwasto_private.arcade_ranked_observations (
  run_id uuid not null,
  move_version integer not null,
  observation_index integer not null check (observation_index >= 0),
  item_index integer not null check (item_index >= 0),
  skill_key text not null references pandiwasto_private.arcade_skills (skill_key),
  item_key text not null check (char_length(item_key) between 1 and 120),
  item_version integer not null check (item_version > 0),
  correct boolean not null,
  first_attempt boolean not null,
  hint_used boolean not null,
  timed_out boolean not null,
  response_ms bigint not null check (response_ms >= 0),
  mastery_before numeric check (mastery_before between 0 and 1),
  mastery_after numeric check (mastery_after between 0 and 1),
  recorded_at timestamptz not null,
  primary key (run_id, move_version, observation_index),
  foreign key (run_id, move_version) references pandiwasto_private.arcade_ranked_moves (run_id, move_version) on delete cascade,
  check (not timed_out or not correct)
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'arcade_ranked_states', 'arcade_ranked_start_requests', 'arcade_ranked_moves', 'arcade_ranked_observations'
  ] loop
    execute format('alter table pandiwasto_private.%I enable row level security', table_name);
    execute format('revoke all on table pandiwasto_private.%I from public, anon, authenticated, service_role', table_name);
  end loop;
end;
$$;

-- Calibration values are provisional until a reviewed pilot.
insert into pandiwasto_private.arcade_skills
  (skill_key, initial_mastery, learn_rate, guess_rate, slip_rate)
values
  ('kayarian-ng-salita', 0.25, 0.15, 0.25, 0.10),
  ('unlapi', 0.25, 0.15, 0.25, 0.10),
  ('gitlapi', 0.25, 0.15, 0.25, 0.10),
  ('hulapi', 0.25, 0.15, 0.25, 0.10),
  ('kabilaan', 0.25, 0.15, 0.25, 0.10),
  ('tambalan', 0.25, 0.15, 0.15, 0.10),
  ('pag-uulit', 0.25, 0.15, 0.50, 0.10),
  ('pokus-ng-pandiwa', 0.25, 0.15, 0.25, 0.10),
  ('asimilasyon', 0.25, 0.15, 0.33, 0.10);

create function pandiwasto_private.ranked_skill_allowed(game integer, skill_key text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select coalesce(case game
    when 2 then skill_key = 'kayarian-ng-salita'
    when 3 then skill_key in ('unlapi', 'gitlapi', 'hulapi', 'kabilaan')
    when 4 then skill_key = 'tambalan'
    when 5 then skill_key = 'pag-uulit'
    when 6 then skill_key = 'pokus-ng-pandiwa'
    when 7 then skill_key = 'asimilasyon'
  end, false);
$$;

-- The study migration can replace these private policies. Default play is
-- governed by ordinary XP gates and authored hints.
create function pandiwasto_private.study_is_practicing(account_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$ select false; $$;

create function pandiwasto_private.attach_study_run(account_id uuid, run_id uuid)
returns void
language plpgsql
set search_path = ''
as $$ begin return; end; $$;

create function pandiwasto_private.allow_study_hint(account_id uuid, run_id uuid, skill_key text, item_index integer)
returns boolean
language sql stable
set search_path = ''
as $$ select true; $$;

create function pandiwasto_private.ranked_snapshot(active_run uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'runId', run.id, 'gameId', run.game_id, 'status', run.status,
    'version', ranked.version, 'state', ranked.state, 'practice', ranked.practice,
    'startedAt', run.started_at
  )
  from pandiwasto_private.arcade_runs run
  join pandiwasto_private.arcade_ranked_states ranked on ranked.run_id = run.id
  where run.id = active_run;
$$;

create function public.pandiwasto_ranked_start(account_id uuid, game integer, request_id uuid, state jsonb, practice boolean)
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
  if account_xp < 200 * (game - 1) and not pandiwasto_private.study_is_practicing(account_id) then
    raise sqlstate 'PT403' using message = 'This game is still locked.';
  end if;

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

create function public.pandiwasto_ranked_state(account_id uuid, active_run uuid, request_id uuid default null, action jsonb default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  previous_move pandiwasto_private.arcade_ranked_moves%rowtype;
  snapshot jsonb;
begin
  if account_id is null or active_run is null or (request_id is null) <> (action is null)
      or (action is not null and (jsonb_typeof(action) <> 'object' or pg_column_size(action) > 4096)) then
    raise sqlstate 'PT400' using message = 'A run and a valid replay request are required.';
  end if;
  if not exists (select 1 from pandiwasto_private.arcade_runs run
      where run.id = active_run and run.player_id = account_id and run.game_id between 2 and 7) then
    raise sqlstate 'PT404' using message = 'Game run not found.';
  end if;

  snapshot := pandiwasto_private.ranked_snapshot(active_run);
  if request_id is not null then
    select move.* into previous_move from pandiwasto_private.arcade_ranked_moves move
    where move.run_id = active_run and move.request_id = request_id;
    if found then
      if previous_move.action is distinct from action then
        raise sqlstate 'PT409' using message = 'That move request ID was already used.';
      end if;
      snapshot := snapshot || jsonb_build_object('response', previous_move.response);
    end if;
  end if;
  return snapshot;
end;
$$;

create function public.pandiwasto_ranked_action(
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
    if observation."firstAttempt" and not observation."hintUsed" and not is_timeout then
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
    update pandiwasto_private.arcade_progress set xp = xp + awarded_xp where player_id = account_id;
    if score > 0 and not ranked.practice then
      perform public.pandiwasto_record_game_score(game_run.game_id, account_id, score);
    end if;
  elsif abandon then
    update pandiwasto_private.arcade_runs set status = 'abandoned', finished_at = acted_at where id = active_run;
  end if;

  return pandiwasto_private.ranked_snapshot(active_run) || jsonb_build_object('response', response);
end;
$$;

revoke all on function pandiwasto_private.ranked_skill_allowed(integer, text),
  pandiwasto_private.ranked_snapshot(uuid), pandiwasto_private.study_is_practicing(uuid),
  pandiwasto_private.attach_study_run(uuid, uuid), pandiwasto_private.allow_study_hint(uuid, uuid, text, integer)
  from public, anon, authenticated, service_role;

revoke all on function
  public.pandiwasto_ranked_start(uuid, integer, uuid, jsonb, boolean),
  public.pandiwasto_ranked_state(uuid, uuid, uuid, jsonb),
  public.pandiwasto_ranked_action(uuid, uuid, uuid, integer, jsonb, jsonb, jsonb, boolean, integer, integer, jsonb, boolean, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function
  public.pandiwasto_ranked_start(uuid, integer, uuid, jsonb, boolean),
  public.pandiwasto_ranked_state(uuid, uuid, uuid, jsonb),
  public.pandiwasto_ranked_action(uuid, uuid, uuid, integer, jsonb, jsonb, jsonb, boolean, integer, integer, jsonb, boolean, jsonb)
  to service_role;

commit;
