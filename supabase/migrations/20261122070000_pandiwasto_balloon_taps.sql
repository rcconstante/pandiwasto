begin;

create table pandiwasto_private.arcade_pop_events (
  run_id uuid not null references pandiwasto_private.arcade_runs(id) on delete cascade,
  request_id uuid not null,
  round_index integer not null,
  removed integer[] not null,
  result jsonb not null,
  primary key (run_id, request_id)
);
alter table pandiwasto_private.arcade_pop_events enable row level security;
revoke all on pandiwasto_private.arcade_pop_events from public, anon, authenticated;

create function public.pandiwasto_pop_tap(
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

  if not preserves_root or retained = puzzle.solution then
    insert into pandiwasto_private.arcade_pop_events (run_id, request_id, round_index, removed, result)
    values (active_run, tap_id, expected_round, removed, tap_result);
  end if;
  return tap_result;
end;
$$;

revoke all on function public.pandiwasto_pop_tap(uuid, uuid, uuid, integer, integer[]) from public, anon, authenticated;
grant execute on function public.pandiwasto_pop_tap(uuid, uuid, uuid, integer, integer[]) to service_role;

commit;
