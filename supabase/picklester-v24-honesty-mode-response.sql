-- Picklester V24: expose honesty_mode to clients and prohibit referees in
-- honesty games. Run once after V23.

create or replace function public.prevent_honesty_mode_referee()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.role='referee' and exists(
    select 1 from public.picklester_games game
    where game.id=new.game_id and game.honesty_mode
  ) then
    raise exception 'Honesty mode does not allow a volunteer referee';
  end if;
  return new;
end; $$;

drop trigger if exists prevent_honesty_mode_referee_member
  on public.picklester_game_participants;
create trigger prevent_honesty_mode_referee_member
before insert or update on public.picklester_game_participants
for each row execute procedure public.prevent_honesty_mode_referee();

create or replace function public.get_picklester_game(requested_code text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target_game public.picklester_games%rowtype; player_limit integer;
begin
  if not exists(
    select 1 from public.profiles where id=auth.uid()
    and (verified or role in ('owner','admin'))
  ) then raise exception 'Owner verification is required'; end if;

  select * into target_game from public.picklester_games
  where join_code=upper(trim(requested_code))
  and status in ('pairing','ready','scoring','completed');
  if not found then return null; end if;

  player_limit:=case when target_game.format='solo' then 2 else 4 end;
  return jsonb_build_object(
    'id',target_game.id,
    'join_code',target_game.join_code,
    'format',target_game.format,
    'creator_id',target_game.creator_id,
    'status',target_game.status,
    'honesty_mode',target_game.honesty_mode,
    'score_team_one',target_game.score_team_one,
    'score_team_two',target_game.score_team_two,
    'score_limit',target_game.score_limit,
    'serving_team',target_game.serving_team,
    'server_number',target_game.server_number,
    'winner_team',target_game.winner_team,
    'mvp_user_id',target_game.mvp_user_id,
    'player_limit',player_limit,
    'total_required',player_limit+case when target_game.honesty_mode then 0 else 1 end,
    'participants',coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id',member.user_id,
        'role',member.role,
        'position',member.position,
        'name',profile.name,
        'username',profile.username,
        'avatar_url',profile.avatar_url,
        'individual_points',member.individual_points,
        'mmr_delta',member.mmr_delta,
        'was_winner',member.was_winner,
        'was_mvp',member.was_mvp
      ) order by case when member.role='player' then 0 else 1 end,
        member.position nulls last)
      from public.picklester_game_participants member
      join public.profiles profile on profile.id=member.user_id
      where member.game_id=target_game.id
    ),'[]'::jsonb)
  );
end; $$;

revoke all on function public.get_picklester_game(text) from public;
grant execute on function public.get_picklester_game(text) to authenticated;
notify pgrst,'reload schema';
