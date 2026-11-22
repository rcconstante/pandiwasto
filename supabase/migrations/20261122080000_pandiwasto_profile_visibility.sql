begin;

-- Keep existing alias-only profiles discoverable until their owner changes visibility.
create or replace function pandiwasto_private.read_ranking_profiles(requested_game integer, page_offset integer)
returns table (player_name text, place bigint, score integer, is_you boolean, avatar text, level integer)
language sql stable security definer set search_path = ''
as $$
  select
    'Player ' || upper(substr(md5('pandiwasto-rankings:' || players.id::text), 1, 10)) as player_name,
    case when requested_game is not null then rank() over (order by scores.best_score desc) end as place,
    scores.best_score as score,
    players.id = (select auth.uid()) as is_you,
    case
      when players.raw_user_meta_data ->> 'avatar' in ('cat', 'turtle', 'bunny', 'chick', 'puppy', 'panda', 'fox', 'frog', 'bear', 'owl')
        then players.raw_user_meta_data ->> 'avatar'
      when players.raw_user_meta_data ->> 'avatar' = 'dashboard/games.webp' then 'puppy'
      when players.raw_user_meta_data ->> 'avatar' = 'dashboard/lessons.webp' then 'owl'
      else 'chick'
    end as avatar,
    1 + coalesce(progress.xp, 0) / 100 as level
  from auth.users as players
  left join pandiwasto_private.arcade_progress as progress on progress.player_id = players.id
  left join public.pandiwasto_game_scores as scores
    on scores.player_id = players.id and scores.game_id = requested_game
    and not exists (select 1 from pandiwasto_private.arcade_hidden_scores as hidden
      where (hidden.game_id, hidden.player_id) = (scores.game_id, scores.player_id))
  where (select auth.uid()) is not null
    and players.email_confirmed_at is not null
    and (requested_game is null or scores.game_id is not null)
    and (
      coalesce(players.raw_user_meta_data ->> 'profile_visibility', 'public') <> 'private'
      or (requested_game is null and players.id = (select auth.uid()))
    )
  order by scores.best_score desc nulls last, player_name, players.id
  limit 21 offset greatest(page_offset, 0);
$$;

-- Keep older clients on the same visibility rules.
create or replace function pandiwasto_private.read_rankings(requested_game integer, page_offset integer)
returns table (player_name text, place bigint, score integer, is_you boolean)
language sql stable security definer set search_path = ''
as $$
  select profiles.player_name, profiles.place, profiles.score, profiles.is_you
  from pandiwasto_private.read_ranking_profiles(requested_game, page_offset) as profiles;
$$;

commit;
