-- Picklester V25: definitive repair for the honesty-mode Start Game RPC.
-- Safe to run more than once. No user or match data is deleted.
drop function if exists public.start_picklester_honesty_game(text);

create function public.start_picklester_honesty_game(requested_code text)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  target_game public.picklester_games%rowtype;
  player_count integer;
  required_players integer;
begin
  select * into target_game
  from public.picklester_games
  where join_code=upper(trim(requested_code))
  for update;

  if not found then raise exception 'Game code not found'; end if;
  if not target_game.honesty_mode then raise exception 'This game is not in honesty mode'; end if;
  if target_game.creator_id<>auth.uid() then raise exception 'Only the game creator can start honesty mode'; end if;
  if target_game.status not in ('pairing','ready') then raise exception 'This game cannot be started now'; end if;

  required_players:=case when target_game.format='solo' then 2 else 4 end;
  select count(*) into player_count
  from public.picklester_game_participants
  where game_id=target_game.id and role='player';

  if player_count<>required_players then
    raise exception 'Every player must join before the creator can start';
  end if;

  update public.picklester_games
  set status='scoring',score_team_one=0,score_team_two=0,
      serving_team=1,server_number=0,started_at=now(),updated_at=now()
  where id=target_game.id;

  update public.picklester_game_participants
  set individual_points=0
  where game_id=target_game.id and role='player';
end;
$$;

revoke all on function public.start_picklester_honesty_game(text) from public;
grant execute on function public.start_picklester_honesty_game(text) to authenticated;
notify pgrst,'reload schema';

-- The result must be: public.start_picklester_honesty_game(text)
select to_regprocedure('public.start_picklester_honesty_game(text)') as installed_function;
