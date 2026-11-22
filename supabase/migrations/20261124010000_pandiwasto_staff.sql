begin;

-- Roles are exclusive: a learner, a teacher, or an admin (arcade_admins).
create table pandiwasto_private.arcade_teachers (
  player_id uuid primary key references auth.users (id) on delete cascade,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now()
);

create table pandiwasto_private.arcade_classes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  teacher_id uuid references pandiwasto_private.arcade_teachers (player_id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index arcade_classes_teacher on pandiwasto_private.arcade_classes (teacher_id);

create table pandiwasto_private.arcade_class_members (
  class_id uuid not null references pandiwasto_private.arcade_classes (id) on delete cascade,
  player_id uuid not null references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (class_id, player_id)
);
create index arcade_class_members_player on pandiwasto_private.arcade_class_members (player_id);

create table pandiwasto_private.arcade_account_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  subject_id uuid references auth.users (id) on delete set null,
  action text not null check (action in ('create', 'role', 'suspend', 'unsuspend')),
  detail text check (char_length(detail) <= 40),
  recorded_at timestamptz not null default now()
);

do $$
declare entry text;
begin
  foreach entry in array array['arcade_teachers', 'arcade_classes', 'arcade_class_members', 'arcade_account_log'] loop
    execute format('alter table pandiwasto_private.%I enable row level security', entry);
    execute format('revoke all on table pandiwasto_private.%I from public, anon, authenticated, service_role', entry);
  end loop;
end
$$;

-- Admins can also find accounts by email.
create or replace function pandiwasto_private.find_confirmed_player(lookup text)
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare matches uuid[];
begin
  if lookup is null or char_length(btrim(lookup)) not between 1 and 254 then
    raise sqlstate 'PT400' using message = 'Player email, alias, or ID is required.';
  end if;
  select array_agg(candidate.id) into matches from (
    select player.id from auth.users player where player.email_confirmed_at is not null
    and (lower(btrim(lookup)) = player.id::text or lower(btrim(lookup)) = lower(player.email)
      or upper(btrim(lookup)) = 'PLAYER ' || upper(substr(md5('pandiwasto-rankings:' || player.id::text), 1, 10)))
    limit 2
  ) candidate;
  if matches is null then raise sqlstate 'PT404' using message = 'Confirmed player not found.'; end if;
  if cardinality(matches) <> 1 then raise sqlstate 'PT409' using message = 'The alias is ambiguous. Enter the account ID.'; end if;
  return matches[1];
end
$$;

create function pandiwasto_private.account_name(account_id uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select coalesce(
    nullif(btrim(concat_ws(' ', u.raw_user_meta_data->>'first_name', u.raw_user_meta_data->>'last_name')), ''),
    nullif(btrim(u.raw_user_meta_data->>'display_name'), ''),
    'Player ' || upper(substr(md5('pandiwasto-rankings:' || u.id::text), 1, 10)))
  from auth.users u where u.id = account_id;
$$;

create function public.pandiwasto_roles(account_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'admin', exists (select 1 from pandiwasto_private.arcade_admins a where a.player_id = account_id),
    'teacher', exists (select 1 from pandiwasto_private.arcade_teachers t where t.player_id = account_id));
$$;

create function public.pandiwasto_admin_accounts(account_id uuid, search text, page_number integer)
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

create function public.pandiwasto_admin_set_role(account_id uuid, target_account_id uuid, new_role text, created boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  perform pandiwasto_private.require_study_admin(account_id);
  if new_role is null or new_role not in ('student', 'teacher', 'admin') or created is null then
    raise sqlstate 'PT400' using message = 'Choose a role.';
  end if;
  if not exists (select 1 from auth.users u where u.id = target_account_id) then
    raise sqlstate 'PT404' using message = 'Account not found.';
  end if;
  if target_account_id = account_id and new_role <> 'admin' then
    raise sqlstate 'PT409' using message = 'You cannot remove your own admin access.';
  end if;
  delete from pandiwasto_private.arcade_admins a where a.player_id = target_account_id and new_role <> 'admin';
  delete from pandiwasto_private.arcade_teachers t where t.player_id = target_account_id and new_role <> 'teacher';
  if new_role = 'admin' then
    insert into pandiwasto_private.arcade_admins (player_id) values (target_account_id) on conflict do nothing;
  elsif new_role = 'teacher' then
    insert into pandiwasto_private.arcade_teachers (player_id, granted_by) values (target_account_id, account_id) on conflict do nothing;
  end if;
  insert into pandiwasto_private.arcade_account_log (actor_id, subject_id, action, detail)
  values (account_id, target_account_id, case when created then 'create' else 'role' end, new_role);
  return jsonb_build_object('role', new_role);
end
$$;

-- Checks and records a suspension before the Edge Function changes the Auth ban.
create function public.pandiwasto_admin_suspension(account_id uuid, target_account_id uuid, suspend boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform pandiwasto_private.require_study_admin(account_id);
  if suspend is null then raise sqlstate 'PT400' using message = 'Choose suspend or restore.'; end if;
  if not exists (select 1 from auth.users u where u.id = target_account_id) then
    raise sqlstate 'PT404' using message = 'Account not found.';
  end if;
  if target_account_id = account_id then
    raise sqlstate 'PT409' using message = 'You cannot suspend your own account.';
  end if;
  if suspend and exists (select 1 from pandiwasto_private.arcade_admins a where a.player_id = target_account_id) then
    raise sqlstate 'PT409' using message = 'Change the admin role before suspending this account.';
  end if;
  insert into pandiwasto_private.arcade_account_log (actor_id, subject_id, action)
  values (account_id, target_account_id, case when suspend then 'suspend' else 'unsuspend' end);
end
$$;

create function public.pandiwasto_admin_classes(account_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform pandiwasto_private.require_study_admin(account_id);
  return jsonb_build_object(
    'classes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'teacherId', c.teacher_id,
        'teacherName', case when c.teacher_id is not null then pandiwasto_private.account_name(c.teacher_id) end,
        'students', (select count(*) from pandiwasto_private.arcade_class_members m where m.class_id = c.id)
      ) order by c.name, c.id) from (select * from pandiwasto_private.arcade_classes order by name, id limit 200) c), '[]'::jsonb),
    'teachers', coalesce((select jsonb_agg(jsonb_build_object('id', t.player_id, 'name', pandiwasto_private.account_name(t.player_id))
      order by pandiwasto_private.account_name(t.player_id)) from (select * from pandiwasto_private.arcade_teachers limit 500) t), '[]'::jsonb));
end
$$;

create function public.pandiwasto_admin_class_save(account_id uuid, class_id uuid, class_name text, teacher uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare saved uuid;
begin
  perform pandiwasto_private.require_study_admin(account_id);
  if class_name is null or char_length(btrim(class_name)) not between 1 and 80 then
    raise sqlstate 'PT400' using message = 'A class name is required.';
  end if;
  if teacher is not null and not exists (select 1 from pandiwasto_private.arcade_teachers t where t.player_id = teacher) then
    raise sqlstate 'PT400' using message = 'Choose an account with the teacher role.';
  end if;
  if class_id is null then
    insert into pandiwasto_private.arcade_classes (name, teacher_id, created_by)
    values (btrim(class_name), teacher, account_id) returning id into saved;
  else
    update pandiwasto_private.arcade_classes c set name = btrim(class_name), teacher_id = teacher
    where c.id = class_id returning c.id into saved;
    if saved is null then raise sqlstate 'PT404' using message = 'Class not found.'; end if;
  end if;
  return jsonb_build_object('classId', saved);
end
$$;

create function public.pandiwasto_admin_class_delete(account_id uuid, class_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  perform pandiwasto_private.require_study_admin(account_id);
  delete from pandiwasto_private.arcade_classes c where c.id = class_id;
  if not found then raise sqlstate 'PT404' using message = 'Class not found.'; end if;
  return jsonb_build_object('deleted', true);
end
$$;

create function public.pandiwasto_admin_class_member(account_id uuid, class_id uuid, target_lookup text, add_member boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare target uuid;
begin
  perform pandiwasto_private.require_study_admin(account_id);
  if add_member is null then raise sqlstate 'PT400' using message = 'Choose add or remove.'; end if;
  perform 1 from pandiwasto_private.arcade_classes c where c.id = class_id for update;
  if not found then raise sqlstate 'PT404' using message = 'Class not found.'; end if;
  target := pandiwasto_private.find_confirmed_player(target_lookup);
  if add_member then
    insert into pandiwasto_private.arcade_class_members (class_id, player_id) values (class_id, target) on conflict do nothing;
  else
    delete from pandiwasto_private.arcade_class_members m where m.class_id = $2 and m.player_id = target;
  end if;
  return jsonb_build_object('students', (select count(*) from pandiwasto_private.arcade_class_members m where m.class_id = $2));
end
$$;

-- Teachers read only their own classes. Admins read every class. Study conditions stay hidden.
create function pandiwasto_private.require_class_access(account_id uuid, class_id uuid)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if exists (select 1 from pandiwasto_private.arcade_admins a where a.player_id = account_id) then
    if not exists (select 1 from pandiwasto_private.arcade_classes c where c.id = class_id) then
      raise sqlstate 'PT404' using message = 'Class not found.';
    end if;
  elsif not exists (select 1 from pandiwasto_private.arcade_classes c where c.id = class_id and c.teacher_id = account_id) then
    raise sqlstate 'PT403' using message = 'Class access required.';
  end if;
end
$$;

create function pandiwasto_private.student_summary(student_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', student_id,
    'name', pandiwasto_private.account_name(student_id),
    'alias', 'Player ' || upper(substr(md5('pandiwasto-rankings:' || student_id::text), 1, 10)),
    'xp', coalesce((select p.xp from pandiwasto_private.arcade_progress p where p.player_id = student_id), 0),
    'lastActive', (select max(r.started_at) from pandiwasto_private.arcade_runs r where r.player_id = student_id and not r.developer_run),
    'skills', public.pandiwasto_arcade_mastery(student_id)->'skills');
$$;

create function public.pandiwasto_teacher_classes(account_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare is_admin boolean := exists (select 1 from pandiwasto_private.arcade_admins a where a.player_id = account_id);
begin
  if not is_admin and not exists (select 1 from pandiwasto_private.arcade_teachers t where t.player_id = account_id) then
    raise sqlstate 'PT403' using message = 'Teacher access required.';
  end if;
  return jsonb_build_object('classes', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name,
      'students', (select count(*) from pandiwasto_private.arcade_class_members m where m.class_id = c.id)) order by c.name, c.id)
    from (select * from pandiwasto_private.arcade_classes c where is_admin or c.teacher_id = account_id order by c.name, c.id limit 200) c), '[]'::jsonb));
end
$$;

create function public.pandiwasto_teacher_class(account_id uuid, class_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform pandiwasto_private.require_class_access(account_id, class_id);
  return jsonb_build_object(
    'name', (select c.name from pandiwasto_private.arcade_classes c where c.id = class_id),
    'students', coalesce((select jsonb_agg(summary order by summary->>'name', summary->>'id')
      from (select pandiwasto_private.student_summary(m.player_id) as summary from pandiwasto_private.arcade_class_members m
        where m.class_id = $2 limit 500) roster), '[]'::jsonb));
end
$$;

create function public.pandiwasto_teacher_student(account_id uuid, class_id uuid, student_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform pandiwasto_private.require_class_access(account_id, class_id);
  if not exists (select 1 from pandiwasto_private.arcade_class_members m where m.class_id = $2 and m.player_id = student_id) then
    raise sqlstate 'PT404' using message = 'Student not found in this class.';
  end if;
  return pandiwasto_private.student_summary(student_id) || jsonb_build_object(
    'bestScores', coalesce((select jsonb_object_agg(s.game_id, s.best_score) from public.pandiwasto_game_scores s where s.player_id = student_id), '{}'::jsonb),
    'hints', (select count(*) from pandiwasto_private.arcade_hints h join pandiwasto_private.arcade_runs r on r.id = h.run_id
      where r.player_id = student_id and not r.developer_run),
    'answers', coalesce((select jsonb_agg(jsonb_build_object('gameId', a.game_id, 'skillId', a.skill_key, 'item', a.item_key,
        'correct', a.correct, 'firstAttempt', a.first_attempt, 'hintUsed', a.hint_used, 'timedOut', a.timed_out,
        'responseMs', a.response_ms, 'masteryBefore', a.mastery_before, 'masteryAfter', a.mastery_after, 'at', a.recorded_at)
        order by a.recorded_at desc, a.move_number desc, a.observation_index desc)
      from (select * from pandiwasto_private.scored_answers u where u.player_id = student_id and not u.developer_run
        order by u.recorded_at desc, u.move_number desc, u.observation_index desc limit 50) a), '[]'::jsonb));
end
$$;

revoke all on function pandiwasto_private.find_confirmed_player(text), pandiwasto_private.account_name(uuid),
  pandiwasto_private.require_class_access(uuid, uuid), pandiwasto_private.student_summary(uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  public.pandiwasto_roles(uuid), public.pandiwasto_admin_accounts(uuid, text, integer),
  public.pandiwasto_admin_set_role(uuid, uuid, text, boolean), public.pandiwasto_admin_suspension(uuid, uuid, boolean),
  public.pandiwasto_admin_classes(uuid), public.pandiwasto_admin_class_save(uuid, uuid, text, uuid),
  public.pandiwasto_admin_class_delete(uuid, uuid), public.pandiwasto_admin_class_member(uuid, uuid, text, boolean),
  public.pandiwasto_teacher_classes(uuid), public.pandiwasto_teacher_class(uuid, uuid), public.pandiwasto_teacher_student(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.pandiwasto_roles(uuid), public.pandiwasto_admin_accounts(uuid, text, integer),
  public.pandiwasto_admin_set_role(uuid, uuid, text, boolean), public.pandiwasto_admin_suspension(uuid, uuid, boolean),
  public.pandiwasto_admin_classes(uuid), public.pandiwasto_admin_class_save(uuid, uuid, text, uuid),
  public.pandiwasto_admin_class_delete(uuid, uuid), public.pandiwasto_admin_class_member(uuid, uuid, text, boolean),
  public.pandiwasto_teacher_classes(uuid), public.pandiwasto_teacher_class(uuid, uuid), public.pandiwasto_teacher_student(uuid, uuid, uuid)
  to service_role;

commit;
