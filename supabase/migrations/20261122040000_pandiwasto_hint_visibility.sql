begin;

-- Give learners the same availability result as the authoritative hint action
-- without disclosing their study assignment.
create or replace function pandiwasto_private.ranked_snapshot(active_run uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'runId', run.id, 'gameId', run.game_id, 'status', run.status,
    'version', ranked.version, 'state', ranked.state, 'practice', ranked.practice,
    'startedAt', run.started_at,
    'studyActive', study.run_id is not null and pandiwasto_private.study_is_practicing(run.player_id),
    'hintAllowed', case
      when run.status = 'active'
        and jsonb_typeof(ranked.state->'hintContext') = 'object'
        and pandiwasto_private.ranked_skill_allowed(run.game_id, ranked.state->'hintContext'->>'skillId')
        and coalesce(ranked.state->'hintContext'->>'itemIndex', '') ~ '^[0-9]{1,8}$'
      then pandiwasto_private.allow_study_hint(
        run.player_id, run.id, ranked.state->'hintContext'->>'skillId',
        (ranked.state->'hintContext'->>'itemIndex')::integer
      )
      else false
    end
  )
  from pandiwasto_private.arcade_runs run
  join pandiwasto_private.arcade_ranked_states ranked on ranked.run_id = run.id
  left join pandiwasto_private.study_runs study on study.run_id = run.id
  where run.id = active_run;
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
    'hadMiss', exists (
      select 1 from pandiwasto_private.arcade_attempts attempt
      where attempt.run_id = run.id and attempt.round_index = run.current_round and not attempt.correct
    ),
    'studyActive', study.run_id is not null and pandiwasto_private.study_is_practicing(run.player_id),
    'hintAllowed', case
      when run.status = 'active' and round_item.hint_requested_at is null
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

commit;
