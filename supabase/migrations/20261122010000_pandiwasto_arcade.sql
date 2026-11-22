begin;

-- Clients read arcade data through the authenticated Express API. Only the
-- server role can call the public arcade RPCs below.
create table pandiwasto_private.arcade_skills (
  skill_key text primary key,
  initial_mastery numeric not null check (initial_mastery between 0 and 1),
  learn_rate numeric not null check (learn_rate between 0 and 1),
  guess_rate numeric not null check (guess_rate > 0 and guess_rate < 1),
  slip_rate numeric not null check (slip_rate > 0 and slip_rate < 1)
);

create table pandiwasto_private.arcade_items (
  game_id integer not null check (game_id between 1 and 7),
  item_key text not null,
  version integer not null check (version > 0),
  skill_key text not null references pandiwasto_private.arcade_skills (skill_key),
  prompt text not null,
  solution text not null,
  hint_text text not null,
  enabled boolean not null default true,
  primary key (game_id, item_key, version)
);

create table pandiwasto_private.arcade_progress (
  player_id uuid primary key references auth.users (id) on delete cascade,
  xp integer not null default 0 check (xp >= 0)
);

create table pandiwasto_private.arcade_runs (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references auth.users (id) on delete cascade,
  game_id integer not null check (game_id between 1 and 7),
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  current_round integer not null default 0 check (current_round >= 0),
  total_rounds integer not null check (total_rounds > 0 and current_round < total_rounds),
  hearts integer check (hearts >= 0),
  score integer not null default 0 check (score >= 0),
  xp integer not null default 0 check (xp >= 0),
  started_at timestamptz not null default now(),
  round_started_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((status = 'active') = (finished_at is null)),
  unique (id, game_id),
  unique (id, player_id)
);

create unique index arcade_one_active_game on pandiwasto_private.arcade_runs (player_id, game_id) where status = 'active';
create index arcade_runs_player_history on pandiwasto_private.arcade_runs (player_id, game_id, started_at desc);

create table pandiwasto_private.arcade_start_requests (
  player_id uuid not null,
  request_id uuid not null,
  run_id uuid not null,
  primary key (player_id, request_id),
  foreign key (run_id, player_id) references pandiwasto_private.arcade_runs (id, player_id) on delete cascade
);

create table pandiwasto_private.arcade_run_items (
  run_id uuid not null,
  game_id integer not null,
  round_index integer not null check (round_index >= 0),
  item_key text not null,
  item_version integer not null,
  hint_requested_at timestamptz,
  primary key (run_id, round_index),
  foreign key (run_id, game_id) references pandiwasto_private.arcade_runs (id, game_id) on delete cascade,
  foreign key (game_id, item_key, item_version) references pandiwasto_private.arcade_items (game_id, item_key, version)
);

create table pandiwasto_private.arcade_attempts (
  run_id uuid not null,
  request_id uuid not null,
  round_index integer not null,
  response text not null,
  correct boolean not null,
  first_attempt boolean not null,
  hint_used boolean not null,
  response_ms bigint not null check (response_ms >= 0),
  recorded_at timestamptz not null,
  mastery_before numeric check (mastery_before between 0 and 1),
  mastery_after numeric check (mastery_after between 0 and 1),
  result jsonb not null,
  primary key (run_id, request_id),
  foreign key (run_id, round_index) references pandiwasto_private.arcade_run_items (run_id, round_index) on delete cascade
);

create index arcade_attempts_round on pandiwasto_private.arcade_attempts (run_id, round_index);
comment on column pandiwasto_private.arcade_attempts.response_ms is
  'Elapsed server time since the round was activated, including any client presentation delay.';

create table pandiwasto_private.arcade_mastery (
  player_id uuid not null references auth.users (id) on delete cascade,
  skill_key text not null references pandiwasto_private.arcade_skills (skill_key),
  probability numeric not null check (probability between 0 and 1),
  observations integer not null check (observations > 0),
  updated_at timestamptz not null,
  primary key (player_id, skill_key)
);

create table pandiwasto_private.arcade_admins (
  player_id uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now()
);

create table pandiwasto_private.arcade_hidden_scores (
  game_id integer not null,
  player_id uuid not null,
  primary key (game_id, player_id),
  foreign key (game_id, player_id) references public.pandiwasto_game_scores (game_id, player_id) on delete cascade
);

create table pandiwasto_private.arcade_moderation_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  subject_id uuid references auth.users (id) on delete set null,
  game_id integer not null check (game_id between 1 and 7),
  hidden boolean not null,
  reason text not null check (char_length(reason) between 1 and 300),
  recorded_at timestamptz not null default now()
);

-- Service-only functions are SECURITY DEFINER with a fixed search path, so
-- no browser role needs table grants or row-level policies.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'arcade_skills', 'arcade_items', 'arcade_progress', 'arcade_runs',
    'arcade_start_requests', 'arcade_run_items', 'arcade_attempts',
    'arcade_mastery', 'arcade_admins', 'arcade_hidden_scores', 'arcade_moderation_log'
  ] loop
    execute format('alter table pandiwasto_private.%I enable row level security', table_name);
    execute format('revoke all on table pandiwasto_private.%I from public, anon, authenticated, service_role', table_name);
  end loop;
end;
$$;

insert into pandiwasto_private.arcade_skills
  (skill_key, initial_mastery, learn_rate, guess_rate, slip_rate)
values ('salitang-ugat', 0.25, 0.15, 0.10, 0.10);

-- The tutorial is shared with Preview. The other prompts belong to the
-- ranked bank and should be kept out of the shipped frontend bundle.
insert into pandiwasto_private.arcade_items
  (game_id, item_key, version, skill_key, prompt, solution, hint_text)
select 1, lower(seed.word), 1, 'salitang-ugat', seed.word, seed.root,
  case seed.affix
    when 'unlapi' then 'May unlapi sa unahan. Tingnan ang mga unang titik.'
    when 'gitlapi' then 'May gitlapi sa loob. Tingnan ang mga titik pagkatapos ng unang titik.'
    else 'May hulapi sa dulo. Tingnan ang mga huling titik.'
  end
from (values
  ('SUMAKAY', 'SAKAY', 'gitlapi'), ('SUMAYAW', 'SAYAW', 'gitlapi'),
  ('GUMALAW', 'GALAW', 'gitlapi'), ('SUMIGAW', 'SIGAW', 'gitlapi'),
  ('HUMIGA', 'HIGA', 'gitlapi'), ('KUMANTA', 'KANTA', 'gitlapi'),
  ('LUMANGOY', 'LANGOY', 'gitlapi'), ('NAGLAKAD', 'LAKAD', 'unlapi'),
  ('NAGDILIG', 'DILIG', 'unlapi'), ('NAGSUKLAY', 'SUKLAY', 'unlapi'),
  ('MAGSIPILYO', 'SIPILYO', 'unlapi'), ('NAGSALITA', 'SALITA', 'unlapi'),
  ('BURAHIN', 'BURA', 'hulapi'), ('HAWAKAN', 'HAWAK', 'hulapi'),
  ('BANTAYAN', 'BANTAY', 'hulapi'), ('HANAPIN', 'HANAP', 'hulapi'),
  ('PUNASAN', 'PUNAS', 'hulapi')
) as seed(word, root, affix);

create function pandiwasto_private.lock_arcade_account(account_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if account_id is null then
    raise sqlstate 'PT400' using message = 'An account is required.';
  end if;
  insert into pandiwasto_private.arcade_progress (player_id) values (account_id)
  on conflict (player_id) do nothing;
  perform 1 from pandiwasto_private.arcade_progress where player_id = account_id for update;
end;
$$;

create function pandiwasto_private.pop_snapshot(active_run uuid)
returns jsonb
language sql
stable
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
    'hadMiss', exists (
      select 1 from pandiwasto_private.arcade_attempts attempt
      where attempt.run_id = run.id and attempt.round_index = run.current_round and not attempt.correct
    )
  ))
  from pandiwasto_private.arcade_runs run
  join pandiwasto_private.arcade_run_items round_item
    on round_item.run_id = run.id and round_item.round_index = run.current_round
  join pandiwasto_private.arcade_items item
    on (item.game_id, item.item_key, item.version) = (round_item.game_id, round_item.item_key, round_item.item_version)
  where run.id = active_run and run.game_id = 1;
$$;

create function public.pandiwasto_arcade_progress(account_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'xp', coalesce((select xp from pandiwasto_private.arcade_progress where player_id = account_id), 0),
    'bestScores', coalesce((select jsonb_object_agg(game_id, best_score) from public.pandiwasto_game_scores where player_id = account_id), '{}'::jsonb)
  );
$$;

create function public.pandiwasto_pop_start(account_id uuid, request_id uuid)
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

  select run.id into chosen_run from pandiwasto_private.arcade_runs run
  where run.player_id = account_id and run.game_id = 1 and run.status = 'active';
  if not found then
    select not exists (select 1 from pandiwasto_private.arcade_runs where player_id = account_id and game_id = 1)
      into first_run;

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

create function public.pandiwasto_pop_answer(account_id uuid, active_run uuid, answer_id uuid, expected_round integer, response text)
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
  if first_attempt and not used_hint then
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

  if reached_end then
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

create function public.pandiwasto_pop_hint(account_id uuid, active_run uuid, expected_round integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  game_run pandiwasto_private.arcade_runs%rowtype;
  hint_result jsonb;
begin
  if active_run is null or expected_round is null or expected_round not between 0 and 4 then
    raise sqlstate 'PT400' using message = 'A run and round are required.';
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

  update pandiwasto_private.arcade_run_items round_item
  set hint_requested_at = coalesce(round_item.hint_requested_at, clock_timestamp())
  from pandiwasto_private.arcade_items item
  where (item.game_id, item.item_key, item.version) = (round_item.game_id, round_item.item_key, round_item.item_version)
    and round_item.run_id = active_run and round_item.round_index = expected_round
  returning jsonb_build_object('text', item.hint_text, 'word', item.prompt, 'root', item.solution)
  into strict hint_result;
  return hint_result;
end;
$$;

create function public.pandiwasto_pop_end(account_id uuid, active_run uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if active_run is null then
    raise sqlstate 'PT400' using message = 'A run is required.';
  end if;
  perform pandiwasto_private.lock_arcade_account(account_id);
  if not exists (select 1 from pandiwasto_private.arcade_runs where id = active_run and player_id = account_id and game_id = 1) then
    raise sqlstate 'PT404' using message = 'Game run not found.';
  end if;
  update pandiwasto_private.arcade_runs set status = 'abandoned', finished_at = clock_timestamp()
  where id = active_run and status = 'active';
  return pandiwasto_private.pop_snapshot(active_run);
end;
$$;

create function public.pandiwasto_arcade_mastery(account_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('skills', coalesce(jsonb_agg(jsonb_build_object(
    'skillId', skill_key, 'mastery', probability, 'attempts', observations
  ) order by skill_key), '[]'::jsonb))
  from pandiwasto_private.arcade_mastery where player_id = account_id;
$$;

create function public.pandiwasto_arcade_admin_status(account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from pandiwasto_private.arcade_admins where player_id = account_id) then
    raise sqlstate 'PT403' using message = 'Admin access required.';
  end if;
  return jsonb_build_object(
    'players', (select count(*) from auth.users where email_confirmed_at is not null),
    'completedRuns', (select count(*) from pandiwasto_private.arcade_runs where status = 'completed'),
    'publishedScores', (
      select count(*) from public.pandiwasto_game_scores score
      join auth.users player on player.id = score.player_id and player.email_confirmed_at is not null
      where not exists (select 1 from pandiwasto_private.arcade_hidden_scores hidden
        where (hidden.game_id, hidden.player_id) = (score.game_id, score.player_id))
    )
  );
end;
$$;

create function public.pandiwasto_arcade_moderate_score(account_id uuid, game integer, target_account_id uuid, hidden boolean, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
begin
  if not exists (select 1 from pandiwasto_private.arcade_admins where player_id = account_id) then
    raise sqlstate 'PT403' using message = 'Admin access required.';
  end if;
  if game is null or game not between 1 and 7 or target_account_id is null or hidden is null
      or reason is null or char_length(btrim(reason)) not between 1 and 300 then
    raise sqlstate 'PT400' using message = 'A game, player, and moderation reason are required.';
  end if;
  perform 1 from public.pandiwasto_game_scores where game_id = game and player_id = target_account_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'Score not found.';
  end if;
  if hidden then
    insert into pandiwasto_private.arcade_hidden_scores (game_id, player_id)
    values (game, target_account_id) on conflict do nothing;
  else
    delete from pandiwasto_private.arcade_hidden_scores where game_id = game and player_id = target_account_id;
  end if;
  insert into pandiwasto_private.arcade_moderation_log (actor_id, subject_id, game_id, hidden, reason)
  values (account_id, target_account_id, game, hidden, btrim(reason));
  return jsonb_build_object('hidden', hidden);
end;
$$;

create or replace function pandiwasto_private.read_rankings(requested_game integer, page_offset integer)
returns table (player_name text, place bigint, score integer, is_you boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    'Player ' || upper(substr(md5('pandiwasto-rankings:' || players.id::text), 1, 10)) as player_name,
    case when requested_game is not null then rank() over (order by scores.best_score desc) end as place,
    scores.best_score as score,
    players.id = (select auth.uid()) as is_you
  from auth.users as players
  left join public.pandiwasto_game_scores as scores
    on scores.player_id = players.id and scores.game_id = requested_game
    and not exists (select 1 from pandiwasto_private.arcade_hidden_scores hidden
      where (hidden.game_id, hidden.player_id) = (scores.game_id, scores.player_id))
  where (select auth.uid()) is not null
    and players.email_confirmed_at is not null
    and (requested_game is null or scores.game_id is not null)
  order by scores.best_score desc nulls last, player_name, players.id
  limit 21
  offset greatest(page_offset, 0);
$$;

revoke all on function pandiwasto_private.lock_arcade_account(uuid), pandiwasto_private.pop_snapshot(uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  public.pandiwasto_arcade_progress(uuid), public.pandiwasto_pop_start(uuid, uuid),
  public.pandiwasto_pop_answer(uuid, uuid, uuid, integer, text), public.pandiwasto_pop_hint(uuid, uuid, integer),
  public.pandiwasto_pop_end(uuid, uuid), public.pandiwasto_arcade_mastery(uuid),
  public.pandiwasto_arcade_admin_status(uuid), public.pandiwasto_arcade_moderate_score(uuid, integer, uuid, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.pandiwasto_arcade_progress(uuid), public.pandiwasto_pop_start(uuid, uuid),
  public.pandiwasto_pop_answer(uuid, uuid, uuid, integer, text), public.pandiwasto_pop_hint(uuid, uuid, integer),
  public.pandiwasto_pop_end(uuid, uuid), public.pandiwasto_arcade_mastery(uuid),
  public.pandiwasto_arcade_admin_status(uuid), public.pandiwasto_arcade_moderate_score(uuid, integer, uuid, boolean, text)
  to service_role;

commit;
