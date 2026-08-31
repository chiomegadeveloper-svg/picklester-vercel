-- Picklester honesty-mode scoring. Run in Supabase SQL Editor after V17.
create or replace function public.update_picklester_honesty_score(
  requested_code text,
  scored_user uuid,
  score_delta integer
)
returns void language plpgsql security definer set search_path='' as $$
declare target_game public.picklester_games%rowtype; scorer public.picklester_game_participants%rowtype; scorer_team integer;
begin
  if score_delta not in (-1,1) then raise exception 'Invalid score update'; end if;
  select * into target_game from public.picklester_games where join_code=upper(trim(requested_code)) for update;
  if not found then raise exception 'Game code not found'; end if;
  if not target_game.honesty_mode then raise exception 'This game is not in honesty mode'; end if;
  if not exists(select 1 from public.picklester_game_participants where game_id=target_game.id and user_id=auth.uid() and role='player') then raise exception 'Only paired players can enter this score'; end if;
  select * into scorer from public.picklester_game_participants where game_id=target_game.id and user_id=scored_user and role='player' for update;
  if not found then raise exception 'Player is not paired in this game'; end if;
  if score_delta=-1 and scorer.individual_points=0 then return; end if;
  scorer_team := case when target_game.format='solo' then scorer.position when scorer.position<=2 then 1 else 2 end;
  update public.picklester_game_participants set individual_points=greatest(0,individual_points+score_delta) where game_id=target_game.id and user_id=scored_user;
  update public.picklester_games set status='scoring',score_team_one=case when scorer_team=1 then greatest(0,score_team_one+score_delta) else score_team_one end,score_team_two=case when scorer_team=2 then greatest(0,score_team_two+score_delta) else score_team_two end,updated_at=now() where id=target_game.id;
end; $$;
grant execute on function public.update_picklester_honesty_score(text,uuid,integer) to authenticated;
notify pgrst,'reload schema';
