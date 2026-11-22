begin;

-- Every BKT parameter version is kept, so predictions logged under an older version can be
-- recomputed for AUC and RMSE after the parameters are refitted.
create table pandiwasto_private.arcade_skill_versions (
  skill_key text not null references pandiwasto_private.arcade_skills (skill_key),
  param_version integer not null check (param_version > 0),
  initial_mastery numeric not null,
  learn_rate numeric not null,
  guess_rate numeric not null,
  slip_rate numeric not null,
  mastery_threshold numeric not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (skill_key, param_version)
);
alter table pandiwasto_private.arcade_skill_versions enable row level security;
revoke all on pandiwasto_private.arcade_skill_versions from public, anon, authenticated, service_role;

insert into pandiwasto_private.arcade_skill_versions
  (skill_key, param_version, initial_mastery, learn_rate, guess_rate, slip_rate, mastery_threshold)
select skill_key, param_version, initial_mastery, learn_rate, guess_rate, slip_rate, mastery_threshold
from pandiwasto_private.arcade_skills;

create function pandiwasto_private.record_skill_version()
returns trigger language plpgsql set search_path = ''
as $$
begin
  insert into pandiwasto_private.arcade_skill_versions
    (skill_key, param_version, initial_mastery, learn_rate, guess_rate, slip_rate, mastery_threshold)
  values (new.skill_key, new.param_version, new.initial_mastery, new.learn_rate, new.guess_rate, new.slip_rate, new.mastery_threshold)
  on conflict do nothing;
  return new;
end;
$$;
-- Runs after the version bump trigger, so it sees the new version number.
create trigger arcade_skill_version_history after insert or update on pandiwasto_private.arcade_skills
for each row execute function pandiwasto_private.record_skill_version();

-- Admin overview also reports whether generated hints reach learners.
create or replace function public.pandiwasto_arcade_admin_status(account_id uuid)
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
    ),
    'hints', (select count(*) from pandiwasto_private.arcade_hints),
    'aiHints', (select count(*) from pandiwasto_private.arcade_hints where source = 'ai')
  );
end;
$$;

-- Staff lists show each person's chosen avatar, like the learner dashboard does.
create or replace function public.pandiwasto_admin_accounts(account_id uuid, search text, page_number integer)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare results jsonb; term text := lower(btrim(coalesce(search, '')));
begin
  perform pandiwasto_private.require_study_admin(account_id);
  if char_length(term) > 120 or page_number is null or page_number not between 0 and 1000 then
    raise sqlstate 'PT400' using message = 'Invalid account search.';
  end if;
  select coalesce(jsonb_agg(found.payload order by found.created_at desc, found.id), '[]'::jsonb) into results from (
    select u.id, u.created_at, jsonb_build_object(
      'id', u.id, 'email', coalesce(u.email, ''),
      'displayName', coalesce(u.raw_user_meta_data->>'display_name', ''),
      'firstName', coalesce(u.raw_user_meta_data->>'first_name', ''),
      'lastName', coalesce(u.raw_user_meta_data->>'last_name', ''),
      'avatar', u.raw_user_meta_data->>'avatar',
      'role', case when exists (select 1 from pandiwasto_private.arcade_admins a where a.player_id = u.id) then 'admin'
        when exists (select 1 from pandiwasto_private.arcade_teachers t where t.player_id = u.id) then 'teacher' else 'student' end,
      'suspended', coalesce(u.banned_until > now(), false),
      'createdAt', u.created_at, 'lastSignInAt', u.last_sign_in_at) as payload
    from auth.users u
    where not coalesce(u.is_anonymous, false)
      and (term = '' or strpos(lower(concat_ws(' ', u.email, u.raw_user_meta_data->>'display_name',
        u.raw_user_meta_data->>'first_name', u.raw_user_meta_data->>'last_name')), term) > 0)
    order by u.created_at desc, u.id limit 26 offset page_number * 25
  ) found;
  return jsonb_build_object('accounts', jsonb_path_query_array(results, '$[0 to 24]'), 'hasMore', jsonb_array_length(results) > 25);
end
$$;

create or replace function pandiwasto_private.student_summary(student_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', student_id,
    'name', pandiwasto_private.account_name(student_id),
    'alias', 'Player ' || upper(substr(md5('pandiwasto-rankings:' || student_id::text), 1, 10)),
    'avatar', (select u.raw_user_meta_data->>'avatar' from auth.users u where u.id = student_id),
    'xp', coalesce((select p.xp from pandiwasto_private.arcade_progress p where p.player_id = student_id), 0),
    'lastActive', (select max(r.started_at) from pandiwasto_private.arcade_runs r where r.player_id = student_id and not r.developer_run),
    'skills', public.pandiwasto_arcade_mastery(student_id)->'skills');
$$;

-- Assessment rows carry per-skill subscores (RQ1 compares them with BKT mastery), and a
-- parameter dataset lists every BKT version used by the attempts.
create or replace function public.pandiwasto_admin_study_export(account_id uuid, study_id uuid, dataset text, page_number integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare results jsonb;
begin
  perform pandiwasto_private.require_study_admin(account_id);
  if dataset is null or dataset not in ('assessment', 'attempt', 'hint', 'parameter') or page_number is null or page_number not between 0 and 10000 then
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
  elsif dataset = 'hint' then
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
alter table pandiwasto_private.study_exports_log drop constraint study_exports_log_dataset_check;
alter table pandiwasto_private.study_exports_log add constraint study_exports_log_dataset_check
  check (dataset in ('assessment', 'attempt', 'hint', 'parameter'));

revoke all on function pandiwasto_private.record_skill_version() from public, anon, authenticated, service_role;

commit;
