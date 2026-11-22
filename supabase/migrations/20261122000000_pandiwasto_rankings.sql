begin;

create schema if not exists pandiwasto_private;
revoke all on schema pandiwasto_private from public, anon, authenticated;
grant usage on schema pandiwasto_private to authenticated;

create table public.pandiwasto_game_scores (
  game_id integer not null check (game_id between 1 and 7),
  player_id uuid not null references auth.users(id) on delete cascade,
  best_score integer not null check (best_score >= 0),
  primary key (game_id, player_id)
);

create index pandiwasto_game_scores_player_idx on public.pandiwasto_game_scores (player_id);
alter table public.pandiwasto_game_scores enable row level security;
revoke all on public.pandiwasto_game_scores from public, anon, authenticated;
grant select, insert, update on public.pandiwasto_game_scores to service_role;

-- Expose generated aliases and ranks, never account metadata or IDs.
create function pandiwasto_private.read_rankings(requested_game integer, page_offset integer)
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
  where (select auth.uid()) is not null
    and players.email_confirmed_at is not null
    and (requested_game is null or scores.game_id is not null)
  order by scores.best_score desc nulls last, player_name, players.id
  limit 21
  offset greatest(page_offset, 0);
$$;

revoke execute on function pandiwasto_private.read_rankings(integer, integer) from public, anon, authenticated;
grant execute on function pandiwasto_private.read_rankings(integer, integer) to authenticated;

create function public.pandiwasto_rankings(requested_game integer default null, page_offset integer default 0)
returns table (player_name text, place bigint, score integer, is_you boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from pandiwasto_private.read_rankings(requested_game, page_offset);
$$;

revoke execute on function public.pandiwasto_rankings(integer, integer) from public, anon, authenticated;
grant execute on function public.pandiwasto_rankings(integer, integer) to authenticated;

-- Call this only after the server validates a completed game attempt.
create function public.pandiwasto_record_game_score(scored_game integer, scored_player uuid, points integer)
returns void
language sql
set search_path = ''
as $$
  insert into public.pandiwasto_game_scores as existing (game_id, player_id, best_score)
  values (scored_game, scored_player, points)
  on conflict (game_id, player_id) do update
  set best_score = greatest(existing.best_score, excluded.best_score);
$$;

revoke execute on function public.pandiwasto_record_game_score(integer, uuid, integer) from public, anon, authenticated;
grant execute on function public.pandiwasto_record_game_score(integer, uuid, integer) to service_role;

commit;
