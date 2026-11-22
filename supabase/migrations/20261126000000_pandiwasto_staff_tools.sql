begin;

-- Speed: the earlier view numbered Pop attempts with a window over the whole attempts table,
-- so filters by player or skill could not use indexes. The round index orders a Pop run.
create or replace view pandiwasto_private.scored_answers as
  select run.player_id, run.id as run_id, run.game_id, run.developer_run, item.skill_key, dealt.item_key, dealt.item_version,
    a.round_index as item_index, a.round_index::bigint as move_number,
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

-- Pop attempts on one round share a move number now, so exports order attempts by time.
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

create index if not exists pandiwasto_game_scores_rank on public.pandiwasto_game_scores (game_id, best_score desc);
create index if not exists arcade_ranked_observations_skill on pandiwasto_private.arcade_ranked_observations (skill_key, recorded_at desc);
create index if not exists arcade_runs_active on pandiwasto_private.arcade_runs (player_id) where status = 'active';

-- Teachers manage their own classes; admins manage every class. Changes are audited.
alter table pandiwasto_private.arcade_account_log drop constraint arcade_account_log_action_check;
alter table pandiwasto_private.arcade_account_log add constraint arcade_account_log_action_check
  check (action in ('create', 'role', 'suspend', 'unsuspend', 'class_add', 'class_remove', 'skill_update'));
alter table pandiwasto_private.arcade_account_log add constraint arcade_account_log_detail_length check (char_length(detail) <= 200);
alter table pandiwasto_private.arcade_account_log drop constraint if exists arcade_account_log_detail_check;

create function pandiwasto_private.staff_role(account_id uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select case
    when exists (select 1 from pandiwasto_private.arcade_admins a where a.player_id = account_id) then 'admin'
    when exists (select 1 from pandiwasto_private.arcade_teachers t where t.player_id = account_id) then 'teacher'
  end;
$$;

create or replace function public.pandiwasto_admin_classes(account_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare staff text := pandiwasto_private.staff_role(account_id);
begin
  if staff is null then raise sqlstate 'PT403' using message = 'Staff access required.'; end if;
  return jsonb_build_object(
    'classes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'teacherId', c.teacher_id,
        'teacherName', case when c.teacher_id is not null then pandiwasto_private.account_name(c.teacher_id) end,
        'students', (select count(*) from pandiwasto_private.arcade_class_members m where m.class_id = c.id)
      ) order by c.name, c.id)
      from (select * from pandiwasto_private.arcade_classes c where staff = 'admin' or c.teacher_id = account_id order by name, id limit 200) c), '[]'::jsonb),
    'teachers', coalesce((select jsonb_agg(jsonb_build_object('id', t.player_id, 'name', pandiwasto_private.account_name(t.player_id))
      order by pandiwasto_private.account_name(t.player_id))
      from (select * from pandiwasto_private.arcade_teachers t where staff = 'admin' or t.player_id = account_id limit 500) t), '[]'::jsonb));
end
$$;

create or replace function public.pandiwasto_admin_class_save(account_id uuid, class_id uuid, class_name text, teacher uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare staff text := pandiwasto_private.staff_role(account_id); saved uuid; owner uuid := teacher;
begin
  if staff is null then raise sqlstate 'PT403' using message = 'Staff access required.'; end if;
  if class_name is null or char_length(btrim(class_name)) not between 1 and 80 then
    raise sqlstate 'PT400' using message = 'A class name is required.';
  end if;
  -- A teacher's classes always stay assigned to that teacher.
  if staff = 'teacher' then owner := account_id; end if;
  if owner is not null and not exists (select 1 from pandiwasto_private.arcade_teachers t where t.player_id = owner) then
    raise sqlstate 'PT400' using message = 'Choose an account with the teacher role.';
  end if;
  if class_id is null then
    insert into pandiwasto_private.arcade_classes (name, teacher_id, created_by)
    values (btrim(class_name), owner, account_id) returning id into saved;
  else
    update pandiwasto_private.arcade_classes c set name = btrim(class_name), teacher_id = owner
    where c.id = class_id and (staff = 'admin' or c.teacher_id = account_id) returning c.id into saved;
    if saved is null then raise sqlstate 'PT404' using message = 'Class not found.'; end if;
  end if;
  return jsonb_build_object('classId', saved);
end
$$;

create or replace function public.pandiwasto_admin_class_delete(account_id uuid, class_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare staff text := pandiwasto_private.staff_role(account_id);
begin
  if staff is null then raise sqlstate 'PT403' using message = 'Staff access required.'; end if;
  delete from pandiwasto_private.arcade_classes c where c.id = class_id and (staff = 'admin' or c.teacher_id = account_id);
  if not found then raise sqlstate 'PT404' using message = 'Class not found.'; end if;
  return jsonb_build_object('deleted', true);
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
    insert into pandiwasto_private.arcade_class_members (class_id, player_id) values ($2, target) on conflict do nothing;
  else
    delete from pandiwasto_private.arcade_class_members m where m.class_id = $2 and m.player_id = target;
  end if;
  insert into pandiwasto_private.arcade_account_log (actor_id, subject_id, action, detail)
  values (account_id, target, case when add_member then 'class_add' else 'class_remove' end, left(class_name, 200));
  return jsonb_build_object('students', (select count(*) from pandiwasto_private.arcade_class_members m where m.class_id = $2));
end
$$;

-- Admin settings: BKT parameters per skill. Each change raises the skill's parameter version.
create function public.pandiwasto_admin_skills(account_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform pandiwasto_private.require_study_admin(account_id);
  return jsonb_build_object('skills', coalesce((select jsonb_agg(jsonb_build_object(
      'skillId', s.skill_key, 'initial', s.initial_mastery, 'learn', s.learn_rate, 'guess', s.guess_rate,
      'slip', s.slip_rate, 'masteryThreshold', s.mastery_threshold, 'paramVersion', s.param_version,
      'updatedAt', (select max(v.recorded_at) from pandiwasto_private.arcade_skill_versions v where v.skill_key = s.skill_key)
    ) order by s.skill_key) from pandiwasto_private.arcade_skills s), '[]'::jsonb));
end
$$;

create function public.pandiwasto_admin_skill_update(
  account_id uuid, skill text, initial numeric, learn numeric, guess numeric, slip numeric, threshold numeric
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare version integer;
begin
  perform pandiwasto_private.require_study_admin(account_id);
  if initial is null or initial not between 0.01 and 0.99 or learn is null or learn not between 0 and 0.99
      or guess is null or guess <= 0 or guess >= 1 or slip is null or slip <= 0 or slip >= 0.5
      or threshold is null or threshold <= 0.5 or threshold > 1 then
    raise sqlstate 'PT400' using message = 'Parameters must be probabilities in their allowed ranges.';
  end if;
  update pandiwasto_private.arcade_skills s
  set initial_mastery = initial, learn_rate = learn, guess_rate = guess, slip_rate = slip, mastery_threshold = threshold
  where s.skill_key = skill returning s.param_version into version;
  if version is null then raise sqlstate 'PT404' using message = 'Skill not found.'; end if;
  insert into pandiwasto_private.arcade_account_log (actor_id, subject_id, action, detail)
  values (account_id, null, 'skill_update', skill || ' v' || version);
  return jsonb_build_object('paramVersion', version);
end
$$;

revoke all on function pandiwasto_private.staff_role(uuid) from public, anon, authenticated, service_role;
revoke all on function public.pandiwasto_admin_skills(uuid),
  public.pandiwasto_admin_skill_update(uuid, text, numeric, numeric, numeric, numeric, numeric)
  from public, anon, authenticated, service_role;
grant execute on function public.pandiwasto_admin_skills(uuid),
  public.pandiwasto_admin_skill_update(uuid, text, numeric, numeric, numeric, numeric, numeric)
  to service_role;

commit;
