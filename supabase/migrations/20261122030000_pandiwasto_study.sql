begin;

create table pandiwasto_private.study_cohorts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  protocol text not null check (char_length(btrim(protocol)) between 1 and 60),
  approval_reference text not null check (char_length(btrim(approval_reference)) between 1 and 120),
  information text not null check (char_length(btrim(information)) between 1 and 1200),
  opens_at timestamptz not null,
  posttest_at timestamptz not null,
  closes_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  check (opens_at < posttest_at and posttest_at < closes_at)
);

create table pandiwasto_private.study_participants (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references pandiwasto_private.study_cohorts(id),
  player_id uuid not null references auth.users(id) on delete cascade,
  consent_kind text not null check (consent_kind in ('adult', 'guardian')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz not null default now(),
  consented_at timestamptz,
  condition text check (condition in ('A', 'B', 'C')),
  withdrawn_at timestamptz,
  unique (cohort_id, player_id),
  check ((condition is null) = (consented_at is null))
);
create index study_participants_account on pandiwasto_private.study_participants(player_id);

create table pandiwasto_private.study_questions (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references pandiwasto_private.study_cohorts(id),
  phase text not null check (phase in ('pre', 'post')),
  skill_key text not null references pandiwasto_private.arcade_skills(skill_key),
  prompt text not null check (char_length(btrim(prompt)) between 1 and 300),
  options text[] not null check (cardinality(options) = 3),
  answer integer not null check (answer between 0 and 2),
  unique (cohort_id, prompt)
);

create table pandiwasto_private.study_assessments (
  participant_id uuid not null references pandiwasto_private.study_participants(id) on delete cascade,
  phase text not null check (phase in ('pre', 'post')),
  choices jsonb not null,
  points integer not null check (points >= 0),
  total integer not null check (total > 0 and points <= total),
  completed_at timestamptz not null default now(),
  primary key (participant_id, phase)
);

create table pandiwasto_private.study_runs (
  run_id uuid primary key references pandiwasto_private.arcade_runs(id) on delete cascade,
  participant_id uuid not null references pandiwasto_private.study_participants(id) on delete cascade
);
create index study_runs_participant on pandiwasto_private.study_runs(participant_id);

create table pandiwasto_private.study_exports_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  cohort_id uuid not null references pandiwasto_private.study_cohorts(id),
  dataset text not null check (dataset in ('assessment', 'attempt')),
  page_number integer not null check (page_number >= 0),
  exported_at timestamptz not null default now()
);

do $$
declare entry text;
begin
  foreach entry in array array['study_cohorts', 'study_participants', 'study_questions', 'study_assessments', 'study_runs', 'study_exports_log'] loop
    execute format('alter table pandiwasto_private.%I enable row level security', entry);
    execute format('revoke all on table pandiwasto_private.%I from public, anon, authenticated, service_role', entry);
  end loop;
end
$$;

create function pandiwasto_private.require_study_admin(account_id uuid)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (select 1 from pandiwasto_private.arcade_admins as admin where admin.player_id = account_id) then
    raise sqlstate 'PT403' using message = 'Admin access required.';
  end if;
end
$$;

create function pandiwasto_private.find_confirmed_player(lookup text)
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare matches uuid[];
begin
  if lookup is null or char_length(btrim(lookup)) not between 1 and 64 then
    raise sqlstate 'PT400' using message = 'Player alias or ID is required.';
  end if;
  select array_agg(candidate.id) into matches from (
    select player.id from auth.users player where player.email_confirmed_at is not null
    and (lower(btrim(lookup)) = player.id::text
      or upper(btrim(lookup)) = 'PLAYER ' || upper(substr(md5('pandiwasto-rankings:' || player.id::text), 1, 10)))
    limit 2
  ) candidate;
  if matches is null then raise sqlstate 'PT404' using message = 'Confirmed player not found.'; end if;
  if cardinality(matches) <> 1 then raise sqlstate 'PT409' using message = 'The alias is ambiguous. Enter the account ID.'; end if;
  return matches[1];
end
$$;

-- The alias matches the existing opaque name in Rankings. Only staff can look up its UUID.
create function public.pandiwasto_admin_score_lookup(account_id uuid, game integer, lookup text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb; target uuid;
begin
  perform pandiwasto_private.require_study_admin(account_id);
  if game is null or game not between 1 and 7 or lookup is null or char_length(btrim(lookup)) not between 1 and 64 then
    raise sqlstate 'PT400' using message = 'Game and player alias or ID are required.';
  end if;
  target := pandiwasto_private.find_confirmed_player(lookup);
  select jsonb_build_object('accountId', score.player_id, 'alias', 'Player ' || upper(substr(md5('pandiwasto-rankings:' || score.player_id::text), 1, 10)),
    'score', score.best_score, 'hidden', hidden.player_id is not null) into result
  from public.pandiwasto_game_scores as score
  left join pandiwasto_private.arcade_hidden_scores as hidden
    on (hidden.game_id, hidden.player_id) = (score.game_id, score.player_id)
  where score.game_id = game and score.player_id = target;
  if not found then raise sqlstate 'PT404' using message = 'Score not found.'; end if;
  return result;
end
$$;

create function public.pandiwasto_admin_study_list(account_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform pandiwasto_private.require_study_admin(account_id);
  return jsonb_build_object('cohorts', coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'protocol', c.protocol,
      'opensAt', c.opens_at, 'posttestAt', c.posttest_at, 'closesAt', c.closes_at,
      'preCount', (select count(*) from pandiwasto_private.study_questions q where q.cohort_id = c.id and q.phase = 'pre'),
      'postCount', (select count(*) from pandiwasto_private.study_questions q where q.cohort_id = c.id and q.phase = 'post'),
      'participants', (select count(*) from pandiwasto_private.study_participants p where p.cohort_id = c.id and p.withdrawn_at is null),
      'sealed', exists(select 1 from pandiwasto_private.study_participants p where p.cohort_id = c.id and p.consented_at is not null)
    ) order by c.opens_at desc)
    from (select * from pandiwasto_private.study_cohorts order by opens_at desc limit 100) as c
  ), '[]'::jsonb));
end
$$;

create function public.pandiwasto_admin_study_create(
  account_id uuid, title text, protocol text, approval_reference text, information text,
  opens_at timestamptz, posttest_at timestamptz, closes_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare new_id uuid;
begin
  perform pandiwasto_private.require_study_admin(account_id);
  if opens_at is null or posttest_at is null or closes_at is null or not (opens_at < posttest_at and posttest_at < closes_at)
    or closes_at <= now() or title is null or char_length(btrim(title)) not between 1 and 100
    or protocol is null or char_length(btrim(protocol)) not between 1 and 60
    or approval_reference is null or char_length(btrim(approval_reference)) not between 1 and 120
    or information is null or char_length(btrim(information)) not between 1 and 1200 then
      raise sqlstate 'PT400' using message = 'A protocol, approval reference, participant information, and ordered dates are required.';
  end if;
  insert into pandiwasto_private.study_cohorts
    (title, protocol, approval_reference, information, opens_at, posttest_at, closes_at, created_by)
  values (btrim(title), btrim(protocol), btrim(approval_reference), btrim(information), opens_at, posttest_at, closes_at, account_id)
  returning id into new_id;
  return jsonb_build_object('cohortId', new_id);
end
$$;

create function public.pandiwasto_admin_study_question(
  account_id uuid, study_id uuid, form text, skill text, question text, choices text[], answer_index integer
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare new_id uuid;
begin
  perform pandiwasto_private.require_study_admin(account_id);
  perform 1 from pandiwasto_private.study_cohorts c where c.id = study_id for update;
  if not found then raise sqlstate 'PT404' using message = 'Study cohort not found.'; end if;
  if exists (select 1 from pandiwasto_private.study_participants p where p.cohort_id = study_id and p.consented_at is not null) then
    raise sqlstate 'PT409' using message = 'Forms are sealed after the first assent.';
  end if;
  if form is null or form not in ('pre', 'post') or question is null or char_length(btrim(question)) not between 1 and 300
    or skill is null or skill !~ '^[a-z][a-z0-9-]{0,79}$'
    or choices is null or cardinality(choices) <> 3 or answer_index is null or answer_index not between 0 and 2
    or exists (select 1 from unnest(choices) as option_text(value) where value is null or char_length(btrim(value)) not between 1 and 120)
    or (select count(distinct lower(btrim(value))) from unnest(choices) as option_text(value)) <> 3 then
    raise sqlstate 'PT400' using message = 'The question needs a skill, prompt, and three distinct answer choices.';
  end if;
  if not exists (select 1 from pandiwasto_private.arcade_skills where skill_key = skill) then
    raise sqlstate 'PT400' using message = 'The skill is unavailable.';
  end if;
  if exists (select 1 from pandiwasto_private.study_questions q where q.cohort_id = study_id and lower(q.prompt) = lower(btrim(question))) then
    raise sqlstate 'PT409' using message = 'Assessment prompts must be distinct.';
  end if;
  if (select count(*) from pandiwasto_private.study_questions q where q.cohort_id = study_id and q.phase = form) >= 40 then
    raise sqlstate 'PT409' using message = 'Assessment form is full.';
  end if;
  insert into pandiwasto_private.study_questions (cohort_id, phase, skill_key, prompt, options, answer)
  values (study_id, form, skill, btrim(question), array(select btrim(value) from unnest(choices) as option_text(value)), answer_index)
  returning id into new_id;
  return jsonb_build_object('questionId', new_id);
end
$$;

create function public.pandiwasto_admin_study_invite(account_id uuid, study_id uuid, target_lookup text, consent_type text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare cohort pandiwasto_private.study_cohorts%rowtype; target_account_id uuid;
begin
  perform pandiwasto_private.require_study_admin(account_id);
  target_account_id := pandiwasto_private.find_confirmed_player(target_lookup);
  perform pandiwasto_private.lock_arcade_account(target_account_id);
  select * into cohort from pandiwasto_private.study_cohorts where id = study_id for update;
  if not found then raise sqlstate 'PT404' using message = 'Study cohort not found.'; end if;
  if cohort.posttest_at <= now() then raise sqlstate 'PT409' using message = 'The cohort is closed to new participants.'; end if;
  if consent_type is null or consent_type not in ('adult', 'guardian') then
    raise sqlstate 'PT400' using message = 'Attest how external consent was verified.';
  end if;
  if exists (select 1 from pandiwasto_private.study_participants p where p.player_id = target_account_id and p.cohort_id = study_id and p.withdrawn_at is null) then
    return jsonb_build_object('invited', true);
  end if;
  if exists (select 1 from pandiwasto_private.study_participants p join pandiwasto_private.study_cohorts c on c.id = p.cohort_id
    where p.player_id = target_account_id and (p.cohort_id = study_id or p.withdrawn_at is null and c.closes_at > cohort.opens_at and c.opens_at < cohort.closes_at)) then
    raise sqlstate 'PT409' using message = 'The player already has an overlapping or withdrawn enrollment.';
  end if;
  insert into pandiwasto_private.study_participants (cohort_id, player_id, consent_kind, approved_by)
  values (study_id, target_account_id, consent_type, account_id);
  return jsonb_build_object('invited', true);
end
$$;

create function public.pandiwasto_study_status(account_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare member record; current_state text; current_phase text; response jsonb; items jsonb;
begin
  select p.id, p.cohort_id, p.consented_at, c.title, c.information, c.protocol, c.opens_at, c.posttest_at, c.closes_at
  into member
  from pandiwasto_private.study_participants p join pandiwasto_private.study_cohorts c on c.id = p.cohort_id
  where p.player_id = account_id and p.withdrawn_at is null
  order by (now() >= c.opens_at and now() < c.closes_at) desc, (now() < c.opens_at) desc, c.opens_at desc limit 1;
  if not found then return jsonb_build_object('state', 'unavailable'); end if;

  current_state := case
    when exists(select 1 from pandiwasto_private.study_assessments a where a.participant_id = member.id and a.phase = 'post') then 'completed'
    when now() >= member.closes_at then 'closed'
    when member.consented_at is null then 'invited'
    when now() < member.opens_at then 'scheduled'
    when now() < member.posttest_at and not exists(select 1 from pandiwasto_private.study_assessments a where a.participant_id = member.id and a.phase = 'pre') then 'pretest'
    when not exists(select 1 from pandiwasto_private.study_assessments a where a.participant_id = member.id and a.phase = 'pre') then 'closed'
    when now() < member.posttest_at then 'practice'
    else 'posttest'
  end;
  current_phase := case current_state when 'pretest' then 'pre' when 'posttest' then 'post' end;
  if current_phase is not null then
    select jsonb_agg(jsonb_build_object('id', q.id, 'prompt', q.prompt, 'choices', q.options) order by q.id) into items
    from pandiwasto_private.study_questions q where q.cohort_id = member.cohort_id and q.phase = current_phase;
  end if;
  response := jsonb_build_object('state', current_state, 'title', member.title, 'information', member.information,
    'protocol', member.protocol, 'opensAt', member.opens_at, 'posttestAt', member.posttest_at, 'closesAt', member.closes_at,
    'canWithdraw', member.consented_at is not null);
  if current_phase is not null then response := response || jsonb_build_object('questions', coalesce(items, '[]'::jsonb)); end if;
  return response;
end
$$;

create function public.pandiwasto_study_consent(account_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare member record; assigned text;
begin
  perform pandiwasto_private.lock_arcade_account(account_id);
  select p.id, p.cohort_id, p.consented_at into member
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
  select groups.value into strict assigned from (values ('A'), ('B'), ('C')) as groups(value)
  order by (select count(*) from pandiwasto_private.study_participants p
    where p.cohort_id = member.cohort_id and p.condition = groups.value), random() limit 1;
  update pandiwasto_private.study_participants p set consented_at = clock_timestamp(), condition = assigned where p.id = member.id;
  return public.pandiwasto_study_status(account_id);
end
$$;

create function public.pandiwasto_study_withdraw(account_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  perform pandiwasto_private.lock_arcade_account(account_id);
  update pandiwasto_private.study_participants p set withdrawn_at = clock_timestamp()
  where p.player_id = account_id and p.withdrawn_at is null;
  return jsonb_build_object('state', 'unavailable');
end
$$;

create function public.pandiwasto_study_submit(account_id uuid, form text, responses jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare state jsonb; member record; expected integer; received integer; earned integer;
begin
  if form is null or form not in ('pre', 'post') or responses is null or jsonb_typeof(responses) <> 'array' then
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
  select count(*) into expected from pandiwasto_private.study_questions q where q.cohort_id = member.cohort_id and q.phase = form;
  select count(distinct q.id), count(*) filter (where q.answer::text = r->>'choice')
    into received, earned
  from jsonb_array_elements(responses) r
  join pandiwasto_private.study_questions q on q.id = (r->>'itemId')::uuid and q.cohort_id = member.cohort_id and q.phase = form;
  if expected <> jsonb_array_length(responses) or received <> expected then
    raise sqlstate 'PT400' using message = 'Provide one answer for every question.';
  end if;
  insert into pandiwasto_private.study_assessments (participant_id, phase, choices, points, total)
  values (member.id, form, responses, earned, expected);
  return public.pandiwasto_study_status(account_id);
end
$$;

create or replace function pandiwasto_private.study_is_practicing(account_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1
    from pandiwasto_private.study_participants p join pandiwasto_private.study_cohorts c on c.id = p.cohort_id
    join pandiwasto_private.study_assessments a on a.participant_id = p.id and a.phase = 'pre'
    where p.player_id = account_id and p.consented_at is not null and p.withdrawn_at is null
      and now() >= c.opens_at and now() < c.posttest_at);
$$;

create or replace function pandiwasto_private.attach_study_run(account_id uuid, run_id uuid)
returns void language sql security definer set search_path = ''
as $$
  insert into pandiwasto_private.study_runs (run_id, participant_id)
  select $2, p.id from pandiwasto_private.study_participants p join pandiwasto_private.study_cohorts c on c.id = p.cohort_id
  join pandiwasto_private.study_assessments a on a.participant_id = p.id and a.phase = 'pre'
  where p.player_id = account_id and p.consented_at is not null and p.withdrawn_at is null and now() >= c.opens_at and now() < c.posttest_at
  on conflict do nothing;
$$;

create or replace function pandiwasto_private.allow_study_hint(account_id uuid, run_id uuid, skill_key text, item_index int)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare assignment text; game integer; withdrawn boolean; misses integer; latest_correct boolean; probability numeric;
begin
  select p.condition, r.game_id, p.withdrawn_at is not null into assignment, game, withdrawn from pandiwasto_private.study_runs s
  join pandiwasto_private.study_participants p on p.id = s.participant_id
  join pandiwasto_private.arcade_runs r on r.id = s.run_id
  where s.run_id = $2 and p.player_id = account_id;
  if not found then return true; end if;
  if assignment = 'C' or withdrawn or not pandiwasto_private.study_is_practicing(account_id) then return false; end if;

  if game = 1 then
    if (select count(*) from pandiwasto_private.arcade_run_items i where i.run_id = $2 and i.hint_requested_at is not null and i.round_index <> $4) >= 4 then
      return false;
    end if;
    select count(*) filter (where not recent.correct), (array_agg(recent.correct order by recent.recorded_at desc, recent.request_id desc))[1]
    into misses, latest_correct from (select a.correct, a.recorded_at, a.request_id from pandiwasto_private.arcade_attempts a
      where a.run_id = $2 order by a.recorded_at desc, a.request_id desc limit 2) as recent;
  else
    if (select count(*) from pandiwasto_private.arcade_ranked_moves m where m.run_id = $2 and m.action_type = 'hint') >= 4 then
      return false;
    end if;
    select count(*) filter (where not recent.correct), (array_agg(recent.correct order by recent.move_version desc, recent.observation_index desc))[1]
    into misses, latest_correct
    from (select o.correct, o.move_version, o.observation_index from pandiwasto_private.arcade_ranked_observations o
      where o.run_id = $2 and not o.timed_out
      order by o.move_version desc, o.observation_index desc limit 2) as recent;
  end if;
  if assignment = 'B' then return misses = 2; end if;
  select coalesce(m.probability, s.initial_mastery) into probability from pandiwasto_private.arcade_skills s
  left join pandiwasto_private.arcade_mastery m on m.skill_key = s.skill_key and m.player_id = account_id where s.skill_key = $3;
  return coalesce(latest_correct = false and probability < 0.7, false);
end
$$;

-- Pop keeps its dedicated state machine. The same study guard applies at its data boundary.
create function pandiwasto_private.study_tag_pop()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform pandiwasto_private.attach_study_run(new.player_id, new.id);
  return new;
end
$$;
create trigger study_tag_pop after insert on pandiwasto_private.arcade_runs
for each row when (new.game_id = 1) execute function pandiwasto_private.study_tag_pop();

create function pandiwasto_private.study_guard_pop_hint()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare owner_id uuid; skill text;
begin
  select r.player_id, i.skill_key into strict owner_id, skill from pandiwasto_private.arcade_runs r
  join pandiwasto_private.arcade_items i on (i.game_id, i.item_key, i.version) = (new.game_id, new.item_key, new.item_version)
  where r.id = new.run_id;
  if not pandiwasto_private.allow_study_hint(owner_id, new.run_id, skill, new.round_index) then
    raise sqlstate 'PT403' using message = 'A hint is unavailable for this round.';
  end if;
  return new;
end
$$;
create trigger study_guard_pop_hint before update of hint_requested_at on pandiwasto_private.arcade_run_items
for each row when (new.game_id = 1 and new.hint_requested_at is not null)
execute function pandiwasto_private.study_guard_pop_hint();

create function public.pandiwasto_admin_study_export(account_id uuid, study_id uuid, dataset text, page_number integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare results jsonb;
begin
  perform pandiwasto_private.require_study_admin(account_id);
  if dataset is null or dataset not in ('assessment', 'attempt') or page_number is null or page_number not between 0 and 10000 then
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
  else
    select coalesce(jsonb_agg(records.payload order by records.participant, records.game_run, records.move_version, records.observation_index), '[]'::jsonb) into results from (
      select p.id as participant, run.id as game_run, obs.move_version, obs.observation_index,
        jsonb_build_object('participantId', p.id, 'condition', p.condition, 'gameId', run.game_id, 'runId', run.id,
          'move', obs.move_version, 'observation', obs.observation_index, 'item', obs.item_key,
          'skill', obs.skill_key, 'itemVersion', obs.item_version, 'correct', obs.correct, 'firstAttempt', obs.first_attempt,
          'hintUsed', obs.hint_used, 'timedOut', obs.timed_out, 'responseMs', obs.response_ms,
          'masteryBefore', obs.mastery_before, 'masteryAfter', obs.mastery_after) as payload
      from pandiwasto_private.study_participants p join pandiwasto_private.study_cohorts c on c.id = p.cohort_id
      join pandiwasto_private.study_runs s on s.participant_id = p.id
      join pandiwasto_private.arcade_runs run on run.id = s.run_id
      join lateral (
        select o.move_version::bigint, o.observation_index, o.item_key, o.item_version, o.skill_key,
          o.correct, o.first_attempt, o.hint_used, o.timed_out, o.response_ms, o.mastery_before, o.mastery_after, o.recorded_at
        from pandiwasto_private.arcade_ranked_observations o where o.run_id = run.id
        union all
        select row_number() over (order by a.recorded_at, a.request_id), 0, dealt.item_key, dealt.item_version, item.skill_key,
          a.correct, a.first_attempt, a.hint_used, false, a.response_ms, a.mastery_before, a.mastery_after, a.recorded_at
        from pandiwasto_private.arcade_attempts a
        join pandiwasto_private.arcade_run_items dealt on (dealt.run_id, dealt.round_index) = (a.run_id, a.round_index)
        join pandiwasto_private.arcade_items item on (item.game_id, item.item_key, item.version) = (dealt.game_id, dealt.item_key, dealt.item_version)
        where a.run_id = run.id and run.game_id = 1
      ) obs on true
      where p.cohort_id = study_id and p.consented_at is not null and p.withdrawn_at is null
        and obs.recorded_at >= p.consented_at and obs.recorded_at < c.posttest_at
      order by p.id, run.id, obs.move_version, obs.observation_index limit 201 offset page_number * 200
    ) records;
  end if;
  insert into pandiwasto_private.study_exports_log (actor_id, cohort_id, dataset, page_number)
  values (account_id, study_id, $3, $4);
  return jsonb_build_object('records', jsonb_path_query_array(results, '$[0 to 199]'), 'hasMore', jsonb_array_length(results) > 200);
end
$$;

revoke all on function pandiwasto_private.require_study_admin(uuid),
  pandiwasto_private.find_confirmed_player(text),
  pandiwasto_private.study_is_practicing(uuid), pandiwasto_private.attach_study_run(uuid, uuid),
  pandiwasto_private.allow_study_hint(uuid, uuid, text, int),
  pandiwasto_private.study_tag_pop(), pandiwasto_private.study_guard_pop_hint()
from public, anon, authenticated, service_role;
revoke all on function
  public.pandiwasto_admin_score_lookup(uuid, integer, text), public.pandiwasto_admin_study_list(uuid),
  public.pandiwasto_admin_study_create(uuid, text, text, text, text, timestamptz, timestamptz, timestamptz),
  public.pandiwasto_admin_study_question(uuid, uuid, text, text, text, text[], integer),
  public.pandiwasto_admin_study_invite(uuid, uuid, text, text), public.pandiwasto_study_status(uuid),
  public.pandiwasto_study_consent(uuid), public.pandiwasto_study_withdraw(uuid),
  public.pandiwasto_study_submit(uuid, text, jsonb), public.pandiwasto_admin_study_export(uuid, uuid, text, integer)
from public, anon, authenticated, service_role;
grant execute on function
  public.pandiwasto_admin_score_lookup(uuid, integer, text), public.pandiwasto_admin_study_list(uuid),
  public.pandiwasto_admin_study_create(uuid, text, text, text, text, timestamptz, timestamptz, timestamptz),
  public.pandiwasto_admin_study_question(uuid, uuid, text, text, text, text[], integer),
  public.pandiwasto_admin_study_invite(uuid, uuid, text, text), public.pandiwasto_study_status(uuid),
  public.pandiwasto_study_consent(uuid), public.pandiwasto_study_withdraw(uuid),
  public.pandiwasto_study_submit(uuid, text, jsonb), public.pandiwasto_admin_study_export(uuid, uuid, text, integer)
to service_role;

commit;
