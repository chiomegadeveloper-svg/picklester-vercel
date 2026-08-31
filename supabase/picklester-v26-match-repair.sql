-- Picklester V26: one definitive pairing, honesty start and scoring repair.
-- Run this entire file once in Supabase SQL Editor. It is safe to run again.

alter table public.picklester_games
  add column if not exists honesty_mode boolean not null default false;
alter table public.picklester_game_participants
  add column if not exists individual_points integer not null default 0;
alter table public.picklester_game_participants
  add column if not exists mmr_delta integer not null default 0;
alter table public.picklester_game_participants
  add column if not exists was_winner boolean not null default false;
alter table public.picklester_game_participants
  add column if not exists was_mvp boolean not null default false;
alter table public.profiles
  add column if not exists in_top_ten boolean not null default false;
alter table public.profiles
  add column if not exists win_streak integer not null default 0;

create table if not exists public.official_match_results (
  id uuid primary key default gen_random_uuid(),
  format text not null check (format in ('solo','duo')),
  completed_at timestamptz not null default now(),
  volunteer_referee_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.official_match_players (
  match_id uuid not null references public.official_match_results(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  outcome text not null check (outcome in ('win','loss')),
  points_delta integer not null default 0,
  primary key (match_id, player_id)
);

drop function if exists public.join_picklester_game_v26(text,text);
create function public.join_picklester_game_v26(requested_code text, desired_role text)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  target_game public.picklester_games%rowtype;
  player_limit integer;
  player_count integer;
  referee_count integer;
begin
  if desired_role not in ('player','referee') then
    raise exception 'Choose player or volunteer referee';
  end if;

  if not exists (
    select 1 from public.profiles
    where id=auth.uid() and (verified or role in ('owner','admin'))
  ) then
    raise exception 'Owner verification is required';
  end if;

  select * into target_game
  from public.picklester_games
  where join_code=upper(trim(requested_code))
  for update;

  if not found then raise exception 'Game code not found'; end if;
  if target_game.status not in ('pairing','ready') then
    raise exception 'This game is no longer accepting members';
  end if;
  if target_game.honesty_mode and desired_role='referee' then
    raise exception 'HONESTY MODE has no volunteer referee';
  end if;

  player_limit:=case when target_game.format='solo' then 2 else 4 end;
  select count(*) into player_count
  from public.picklester_game_participants
  where game_id=target_game.id and role='player';
  select count(*) into referee_count
  from public.picklester_game_participants
  where game_id=target_game.id and role='referee';

  if not exists (
    select 1 from public.picklester_game_participants
    where game_id=target_game.id and user_id=auth.uid()
  ) then
    if desired_role='referee' then
      if referee_count>=1 then
        raise exception 'The volunteer referee position is already filled';
      end if;
      insert into public.picklester_game_participants(game_id,user_id,role,position)
      values(target_game.id,auth.uid(),'referee',null);
      referee_count:=1;
    else
      if player_count>=player_limit then
        raise exception 'All player positions are filled';
      end if;
      insert into public.picklester_game_participants(game_id,user_id,role,position)
      values(target_game.id,auth.uid(),'player',player_count+1);
      player_count:=player_count+1;
    end if;
  end if;

  update public.picklester_games
  set status=case
      when honesty_mode and player_count=player_limit then 'ready'
      when not honesty_mode and player_count=player_limit and referee_count=1 then 'ready'
      else 'pairing'
    end,
    updated_at=now()
  where id=target_game.id;
end;
$$;

drop function if exists public.start_picklester_honesty_game_v26(text);
create function public.start_picklester_honesty_game_v26(requested_code text)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  target_game public.picklester_games%rowtype;
  required_players integer;
  player_count integer;
begin
  select * into target_game
  from public.picklester_games
  where join_code=upper(trim(requested_code))
  for update;

  if not found then raise exception 'Game code not found'; end if;
  if not target_game.honesty_mode then raise exception 'This game is not in HONESTY MODE'; end if;
  if target_game.creator_id<>auth.uid() then raise exception 'Only the creator can start this HONESTY MODE game'; end if;
  if target_game.status not in ('pairing','ready') then raise exception 'This game cannot be started now'; end if;

  required_players:=case when target_game.format='solo' then 2 else 4 end;
  select count(*) into player_count
  from public.picklester_game_participants
  where game_id=target_game.id and role='player';

  if player_count<>required_players then
    raise exception 'Every player must join before the creator can start';
  end if;

  update public.picklester_games
  set status='scoring', score_team_one=0, score_team_two=0,
      serving_team=1, server_number=0, started_at=now(), updated_at=now()
  where id=target_game.id;

  update public.picklester_game_participants
  set individual_points=0, mmr_delta=0, was_winner=false, was_mvp=false
  where game_id=target_game.id and role='player';
end;
$$;

drop function if exists public.update_picklester_honesty_score_v26(text,uuid,integer);
create function public.update_picklester_honesty_score_v26(
  requested_code text,
  scored_user uuid,
  score_delta integer
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  target_game public.picklester_games%rowtype;
  scorer public.picklester_game_participants%rowtype;
  scorer_team integer;
  next_team_score integer;
  winning_team integer;
  automatic_mvp uuid;
  result_id uuid;
  ranked record;
begin
  if score_delta not in (-1,1) then raise exception 'Invalid score update'; end if;

  select * into target_game
  from public.picklester_games
  where join_code=upper(trim(requested_code))
  for update;

  if not found then raise exception 'Game code not found'; end if;
  if not target_game.honesty_mode then raise exception 'This game is not in HONESTY MODE'; end if;
  if target_game.status<>'scoring' then raise exception 'The creator must start the game before scoring'; end if;
  if not exists (
    select 1 from public.picklester_game_participants
    where game_id=target_game.id and user_id=auth.uid() and role='player'
  ) then
    raise exception 'Only paired players can report this score';
  end if;

  select * into scorer
  from public.picklester_game_participants
  where game_id=target_game.id and user_id=scored_user and role='player'
  for update;

  if not found then raise exception 'Player is not paired in this game'; end if;
  if score_delta=-1 and scorer.individual_points=0 then return; end if;

  scorer_team:=case
    when target_game.format='solo' then scorer.position
    when scorer.position<=2 then 1
    else 2
  end;
  next_team_score:=greatest(0,
    (case when scorer_team=1 then target_game.score_team_one else target_game.score_team_two end)+score_delta
  );

  update public.picklester_game_participants
  set individual_points=greatest(0,individual_points+score_delta)
  where game_id=target_game.id and user_id=scored_user;

  update public.picklester_games
  set score_team_one=case when scorer_team=1 then next_team_score else score_team_one end,
      score_team_two=case when scorer_team=2 then next_team_score else score_team_two end,
      updated_at=now()
  where id=target_game.id;

  if score_delta<>1 or next_team_score<target_game.score_limit then return; end if;

  winning_team:=scorer_team;
  select member.user_id into automatic_mvp
  from public.picklester_game_participants member
  where member.game_id=target_game.id and member.role='player'
    and (
      (target_game.format='solo' and member.position=winning_team)
      or (target_game.format='duo' and (
        (winning_team=1 and member.position<=2)
        or (winning_team=2 and member.position>2)
      ))
    )
  order by member.individual_points desc,member.position asc
  limit 1;

  update public.picklester_game_participants member
  set was_winner=(
        (target_game.format='solo' and member.position=winning_team)
        or (target_game.format='duo' and (
          (winning_team=1 and member.position<=2)
          or (winning_team=2 and member.position>2)
        ))
      ),
      was_mvp=member.user_id=automatic_mvp,
      mmr_delta=case when (
        (target_game.format='solo' and member.position=winning_team)
        or (target_game.format='duo' and (
          (winning_team=1 and member.position<=2)
          or (winning_team=2 and member.position>2)
        ))
      ) then 3 else -4 end
      + case when member.user_id=automatic_mvp then 3 else 0 end
  where member.game_id=target_game.id and member.role='player';

  update public.profiles profile
  set mmr=greatest(0,coalesce(profile.mmr,1000)+member.mmr_delta),
      official_wins=profile.official_wins+case when member.was_winner then 1 else 0 end,
      official_losses=profile.official_losses+case when member.was_winner then 0 else 1 end,
      win_streak=case when member.was_winner then coalesce(profile.win_streak,0)+1 else 0 end,
      mvp_records=profile.mvp_records+case when member.was_mvp then 1 else 0 end,
      updated_at=now()
  from public.picklester_game_participants member
  where member.game_id=target_game.id and member.role='player' and profile.id=member.user_id;

  update public.picklester_games
  set status='completed', winner_team=winning_team, mvp_user_id=automatic_mvp,
      ended_at=now(), updated_at=now()
  where id=target_game.id;

  insert into public.official_match_results(format,completed_at,volunteer_referee_id)
  values(target_game.format,now(),null)
  returning id into result_id;

  insert into public.official_match_players(match_id,player_id,outcome,points_delta)
  select result_id,user_id,case when was_winner then 'win' else 'loss' end,mmr_delta
  from public.picklester_game_participants
  where game_id=target_game.id and role='player';

  if to_regclass('public.picklester_activity_feed') is not null then
    insert into public.picklester_activity_feed(event_type,actor_id,game_id,message)
    select 'match_win',user_id,target_game.id,'won a '||target_game.format||' HONESTY MODE match.'
    from public.picklester_game_participants
    where game_id=target_game.id and role='player' and was_winner;
    insert into public.picklester_activity_feed(event_type,actor_id,game_id,message)
    values('mvp',automatic_mvp,target_game.id,'earned MVP in an HONESTY MODE match.');
  end if;

  for ranked in
    select profile.id,
      row_number() over (order by profile.mmr desc,profile.updated_at asc,profile.id) as position,
      profile.in_top_ten
    from public.profiles profile
    where profile.mmr is not null and (profile.verified or profile.role in ('owner','admin'))
  loop
    update public.profiles set in_top_ten=ranked.position<=10 where id=ranked.id;
  end loop;
end;
$$;

drop function if exists public.update_picklester_serve_v26(text,integer,integer);
create function public.update_picklester_serve_v26(
  requested_code text,
  new_serving_team integer,
  new_server_number integer
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare target_game public.picklester_games%rowtype;
begin
  if new_serving_team not in (1,2) or new_server_number not in (0,1,2) then
    raise exception 'Invalid serving position';
  end if;
  select * into target_game
  from public.picklester_games
  where join_code=upper(trim(requested_code))
  for update;
  if not found then raise exception 'Game code not found'; end if;
  if target_game.status<>'scoring' then raise exception 'Start the game before changing serve'; end if;
  if not exists (
    select 1 from public.picklester_game_participants
    where game_id=target_game.id and user_id=auth.uid()
      and ((target_game.honesty_mode and role='player') or (not target_game.honesty_mode and role='referee'))
  ) then
    raise exception 'Only a scoring controller can change the serve';
  end if;
  update public.picklester_games
  set serving_team=new_serving_team,server_number=new_server_number,updated_at=now()
  where id=target_game.id;
end;
$$;

revoke all on function public.join_picklester_game_v26(text,text) from public;
revoke all on function public.start_picklester_honesty_game_v26(text) from public;
revoke all on function public.update_picklester_honesty_score_v26(text,uuid,integer) from public;
revoke all on function public.update_picklester_serve_v26(text,integer,integer) from public;
grant execute on function public.join_picklester_game_v26(text,text) to authenticated;
grant execute on function public.start_picklester_honesty_game_v26(text) to authenticated;
grant execute on function public.update_picklester_honesty_score_v26(text,uuid,integer) to authenticated;
grant execute on function public.update_picklester_serve_v26(text,integer,integer) to authenticated;

notify pgrst,'reload schema';

select installed_function
from (values
  (to_regprocedure('public.join_picklester_game_v26(text,text)')),
  (to_regprocedure('public.start_picklester_honesty_game_v26(text)')),
  (to_regprocedure('public.update_picklester_honesty_score_v26(text,uuid,integer)')),
  (to_regprocedure('public.update_picklester_serve_v26(text,integer,integer)'))
) as installed(installed_function);
