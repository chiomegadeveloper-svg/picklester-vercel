-- Honesty mode: games without a volunteer referee.
alter table public.picklester_games add column if not exists honesty_mode boolean not null default false;

create or replace function public.create_picklester_honesty_game(game_format text, game_score_limit integer)
returns text language plpgsql security definer set search_path='' as $$
declare code text; game_id uuid;
begin
  code := public.create_picklester_game_v13(game_format, 'player', game_score_limit);
  select id into game_id from public.picklester_games where join_code=code;
  update public.picklester_games set honesty_mode=true where id=game_id;
  return code;
end; $$;
grant execute on function public.create_picklester_honesty_game(text,integer) to authenticated;

-- Allow an honesty-mode game to become ready once all player slots are filled.
create or replace function public.refresh_picklester_honesty_status(target_game uuid)
returns void language plpgsql security definer set search_path='' as $$
declare limit_count integer; players integer;
begin
  select case when format='solo' then 2 else 4 end into limit_count from public.picklester_games where id=target_game;
  select count(*) into players from public.picklester_game_participants where game_id=target_game and role='player';
  update public.picklester_games set status=case when players=limit_count then 'ready' else 'pairing' end, updated_at=now() where id=target_game and honesty_mode=true;
end; $$;
grant execute on function public.refresh_picklester_honesty_status(uuid) to authenticated;

notify pgrst,'reload schema';
