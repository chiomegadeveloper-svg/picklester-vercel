-- Picklester V14: individual scoring and automatic doubles MVP.
-- Run this entire file once in the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- Verification refresh
-- ---------------------------------------------------------------------------

create or replace function public.set_picklester_verification(target_user uuid, approved boolean)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_picklester_staff() then
    raise exception 'Owner or admin access is required';
  end if;

  update public.profiles
  set verified = approved,
      updated_at = now()
  where id = target_user
    and role = 'player';

  if not found then
    raise exception 'Player profile was not found';
  end if;
end;
$$;

revoke all on function public.set_picklester_verification(uuid, boolean) from public;
grant execute on function public.set_picklester_verification(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Opt-in GPS table and private 20 km lookup
-- ---------------------------------------------------------------------------

create table if not exists public.profile_locations (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  latitude double precision,
  longitude double precision,
  location_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180)
);

alter table public.profile_locations enable row level security;

drop policy if exists "Players read their own location" on public.profile_locations;
create policy "Players read their own location"
on public.profile_locations for select to authenticated
using (user_id = auth.uid());

drop policy if exists "Players add their location" on public.profile_locations;
create policy "Players add their location"
on public.profile_locations for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "Players update their location" on public.profile_locations;
create policy "Players update their location"
on public.profile_locations for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

grant select, insert, update on public.profile_locations to authenticated;

create or replace function public.nearby_picklesters(
  current_lat double precision,
  current_lng double precision,
  radius_km double precision default 20
)
returns table(
  id uuid,
  name text,
  username text,
  avatar_url text,
  distance_km double precision,
  bearing_deg double precision
)
language sql
stable
security definer set search_path = ''
as $$
  with candidates as (
    select
      p.id,
      p.name,
      p.username,
      p.avatar_url,
      l.latitude,
      l.longitude,
      6371 * 2 * asin(sqrt(
        power(sin(radians((l.latitude - current_lat) / 2)), 2)
        + cos(radians(current_lat)) * cos(radians(l.latitude))
        * power(sin(radians((l.longitude - current_lng) / 2)), 2)
      )) as distance_km
    from public.profile_locations l
    join public.profiles p on p.id = l.user_id
    where l.location_enabled
      and l.latitude is not null
      and l.longitude is not null
      and p.verified
      and p.id <> auth.uid()
      and exists (
        select 1 from public.profiles me
        where me.id = auth.uid()
          and (me.verified or me.role in ('owner', 'admin'))
      )
  )
  select
    c.id,
    c.name,
    c.username,
    c.avatar_url,
    c.distance_km,
    degrees(atan2(
      sin(radians(c.longitude - current_lng)) * cos(radians(c.latitude)),
      cos(radians(current_lat)) * sin(radians(c.latitude))
      - sin(radians(current_lat)) * cos(radians(c.latitude))
      * cos(radians(c.longitude - current_lng))
    ))::double precision as bearing_deg
  from candidates c
  where c.distance_km <= least(greatest(radius_km, 0), 20)
  order by c.distance_km asc
  limit 100;
$$;

revoke all on function public.nearby_picklesters(double precision, double precision, double precision) from public;
grant execute on function public.nearby_picklesters(double precision, double precision, double precision) to authenticated;

-- ---------------------------------------------------------------------------
-- One creator, one QR, fixed player slots and one volunteer referee
-- ---------------------------------------------------------------------------

create table if not exists public.picklester_games (
  id uuid primary key default gen_random_uuid(),
  join_code text not null unique,
  format text not null check (format in ('solo', 'duo')),
  creator_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'pairing'
    check (status in ('pairing', 'ready', 'scoring', 'completed', 'cancelled')),
  score_team_one integer not null default 0 check (score_team_one >= 0),
  score_team_two integer not null default 0 check (score_team_two >= 0),
  score_limit integer not null default 11 check (score_limit in (11, 15, 21)),
  serving_team integer not null default 1 check (serving_team in (1, 2)),
  server_number integer not null default 0 check (server_number in (0, 1, 2)),
  winner_team integer check (winner_team in (1, 2)),
  mvp_user_id uuid,
  ended_at timestamptz,
  started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.picklester_games add column if not exists score_team_one integer not null default 0;
alter table public.picklester_games add column if not exists score_team_two integer not null default 0;
alter table public.picklester_games add column if not exists started_at timestamptz;
alter table public.picklester_games add column if not exists score_limit integer not null default 11;
alter table public.picklester_games add column if not exists serving_team integer not null default 1;
alter table public.picklester_games add column if not exists server_number integer not null default 0;
alter table public.picklester_games add column if not exists winner_team integer;
alter table public.picklester_games add column if not exists mvp_user_id uuid;
alter table public.picklester_games add column if not exists ended_at timestamptz;

create table if not exists public.picklester_game_participants (
  game_id uuid not null references public.picklester_games(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  role text not null check (role in ('player', 'referee')),
  position smallint,
  individual_points integer not null default 0,
  joined_at timestamptz not null default now(),
  primary key (game_id, user_id),
  check (
    (role = 'player' and position is not null and position between 1 and 4)
    or (role = 'referee' and position is null)
  )
);

alter table public.picklester_game_participants add column if not exists individual_points integer not null default 0;

create unique index if not exists one_referee_per_picklester_game
on public.picklester_game_participants(game_id)
where role = 'referee';

create unique index if not exists one_player_per_picklester_position
on public.picklester_game_participants(game_id, position)
where role = 'player';

alter table public.picklester_games enable row level security;
alter table public.picklester_game_participants enable row level security;

drop policy if exists "Game members view their games" on public.picklester_games;
create policy "Game members view their games"
on public.picklester_games for select to authenticated
using (
  creator_id = auth.uid()
  or exists (
    select 1 from public.picklester_game_participants member
    where member.game_id = id and member.user_id = auth.uid()
  )
);

drop policy if exists "Game members view participants" on public.picklester_game_participants;
create policy "Game members view participants"
on public.picklester_game_participants for select to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.picklester_games game
    where game.id = game_id and game.creator_id = auth.uid()
  )
);

revoke all on public.picklester_games from anon, authenticated;
revoke all on public.picklester_game_participants from anon, authenticated;

create or replace function public.create_picklester_game(
  game_format text,
  creator_role text
)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  new_game_id uuid;
  new_join_code text;
begin
  if game_format not in ('solo', 'duo') then
    raise exception 'Invalid game format';
  end if;

  if creator_role not in ('player', 'referee') then
    raise exception 'Invalid creator role';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (verified or role in ('owner', 'admin'))
  ) then
    raise exception 'Owner verification is required';
  end if;

  loop
    new_join_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    begin
      insert into public.picklester_games(join_code, format, creator_id)
      values (new_join_code, game_format, auth.uid())
      returning id into new_game_id;
      exit;
    exception when unique_violation then
      -- Generate another short code.
    end;
  end loop;

  insert into public.picklester_game_participants(game_id, user_id, role, position)
  values (
    new_game_id,
    auth.uid(),
    creator_role,
    case when creator_role = 'player' then 1 else null end
  );

  return new_join_code;
end;
$$;

revoke all on function public.create_picklester_game(text, text) from public;
grant execute on function public.create_picklester_game(text, text) to authenticated;

create or replace function public.create_picklester_game_v13(game_format text, creator_role text, game_score_limit integer)
returns text language plpgsql security definer set search_path = '' as $$
declare new_game_id uuid; new_join_code text;
begin
  if game_format not in ('solo', 'duo') then raise exception 'Invalid game format'; end if;
  if creator_role not in ('player', 'referee') then raise exception 'Invalid creator role'; end if;
  if game_score_limit not in (11, 15, 21) then raise exception 'Choose a game to 11, 15 or 21'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and (verified or role in ('owner', 'admin'))) then
    raise exception 'Owner verification is required';
  end if;
  loop
    new_join_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    begin
      insert into public.picklester_games(join_code, format, creator_id, score_limit)
      values (new_join_code, game_format, auth.uid(), game_score_limit) returning id into new_game_id;
      exit;
    exception when unique_violation then end;
  end loop;
  insert into public.picklester_game_participants(game_id, user_id, role, position)
  values (new_game_id, auth.uid(), creator_role, case when creator_role = 'player' then 1 else null end);
  return new_join_code;
end;
$$;

revoke all on function public.create_picklester_game_v13(text, text, integer) from public;
grant execute on function public.create_picklester_game_v13(text, text, integer) to authenticated;

create or replace function public.join_picklester_game(
  requested_code text,
  desired_role text
)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  target_game public.picklester_games%rowtype;
  player_limit integer;
  player_count integer;
  referee_count integer;
begin
  if desired_role not in ('player', 'referee') then
    raise exception 'Choose player or volunteer referee';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (verified or role in ('owner', 'admin'))
  ) then
    raise exception 'Owner verification is required';
  end if;

  select * into target_game
  from public.picklester_games
  where join_code = upper(trim(requested_code))
  for update;

  if not found then
    raise exception 'Game code not found';
  end if;

  if target_game.status not in ('pairing', 'ready') then
    raise exception 'This game is no longer accepting members';
  end if;

  if exists (
    select 1 from public.picklester_game_participants
    where game_id = target_game.id and user_id = auth.uid()
  ) then
    return;
  end if;

  player_limit := case when target_game.format = 'solo' then 2 else 4 end;

  select count(*) into player_count
  from public.picklester_game_participants
  where game_id = target_game.id and role = 'player';

  select count(*) into referee_count
  from public.picklester_game_participants
  where game_id = target_game.id and role = 'referee';

  if desired_role = 'referee' then
    if referee_count >= 1 then
      raise exception 'The volunteer referee position is already filled';
    end if;
    insert into public.picklester_game_participants(game_id, user_id, role, position)
    values (target_game.id, auth.uid(), 'referee', null);
    referee_count := 1;
  else
    if player_count >= player_limit then
      raise exception 'All player positions are filled';
    end if;
    insert into public.picklester_game_participants(game_id, user_id, role, position)
    values (target_game.id, auth.uid(), 'player', player_count + 1);
    player_count := player_count + 1;
  end if;

  update public.picklester_games
  set status = case
      when player_count = player_limit and referee_count = 1 then 'ready'
      else 'pairing'
    end,
    updated_at = now()
  where id = target_game.id;
end;
$$;

revoke all on function public.join_picklester_game(text, text) from public;
grant execute on function public.join_picklester_game(text, text) to authenticated;

create or replace function public.change_picklester_game_role(requested_code text, desired_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  target_game public.picklester_games%rowtype;
  player_limit integer;
  new_position integer;
  player_count integer;
  referee_count integer;
begin
  if desired_role not in ('player', 'referee') then raise exception 'Choose player or volunteer referee'; end if;
  select * into target_game from public.picklester_games
  where join_code = upper(trim(requested_code)) for update;
  if not found then raise exception 'Game code not found'; end if;
  if target_game.status not in ('pairing', 'ready') then raise exception 'Roles can only change during pairing'; end if;
  if not exists (select 1 from public.picklester_game_participants where game_id = target_game.id and user_id = auth.uid()) then
    raise exception 'Join this game before changing roles';
  end if;
  if exists (select 1 from public.picklester_game_participants where game_id = target_game.id and user_id = auth.uid() and role = desired_role) then return; end if;
  player_limit := case when target_game.format = 'solo' then 2 else 4 end;
  if desired_role = 'referee' then
    if exists (select 1 from public.picklester_game_participants where game_id = target_game.id and role = 'referee' and user_id <> auth.uid()) then
      raise exception 'The volunteer referee position is already filled';
    end if;
    update public.picklester_game_participants set role = 'referee', position = null
    where game_id = target_game.id and user_id = auth.uid();
  else
    select candidate.slot into new_position
    from generate_series(1, player_limit) as candidate(slot)
    where not exists (select 1 from public.picklester_game_participants member where member.game_id = target_game.id and member.role = 'player' and member.position = candidate.slot)
    order by candidate.slot limit 1;
    if new_position is null then raise exception 'All player positions are filled'; end if;
    update public.picklester_game_participants set role = 'player', position = new_position
    where game_id = target_game.id and user_id = auth.uid();
  end if;
  select count(*) filter (where role = 'player'), count(*) filter (where role = 'referee')
  into player_count, referee_count from public.picklester_game_participants where game_id = target_game.id;
  update public.picklester_games set status = case when player_count = player_limit and referee_count = 1 then 'ready' else 'pairing' end, updated_at = now()
  where id = target_game.id;
end;
$$;

revoke all on function public.change_picklester_game_role(text, text) from public;
grant execute on function public.change_picklester_game_role(text, text) to authenticated;

create or replace function public.start_picklester_game(requested_code text)
returns void language plpgsql security definer set search_path = '' as $$
declare target_game public.picklester_games%rowtype;
begin
  select * into target_game from public.picklester_games where join_code = upper(trim(requested_code)) for update;
  if not found then raise exception 'Game code not found'; end if;
  if target_game.status <> 'ready' then raise exception 'Every player and the volunteer referee must be paired first'; end if;
  if not exists (select 1 from public.picklester_game_participants where game_id = target_game.id and user_id = auth.uid() and role = 'referee') then
    raise exception 'Only the volunteer referee can start this game';
  end if;
  update public.picklester_games set status = 'scoring', score_team_one = 0, score_team_two = 0,
    serving_team = 1, server_number = 0, started_at = now(), updated_at = now() where id = target_game.id;
  update public.picklester_game_participants set individual_points = 0 where game_id = target_game.id and role = 'player';
end;
$$;

revoke all on function public.start_picklester_game(text) from public;
grant execute on function public.start_picklester_game(text) to authenticated;

create or replace function public.update_picklester_score(requested_code text, score_team integer, score_delta integer)
returns void language plpgsql security definer set search_path = '' as $$
declare target_game public.picklester_games%rowtype;
begin
  if score_team not in (1, 2) or score_delta not in (-1, 1) then raise exception 'Invalid score update'; end if;
  select * into target_game from public.picklester_games where join_code = upper(trim(requested_code)) for update;
  if not found then raise exception 'Game code not found'; end if;
  if target_game.status <> 'scoring' then raise exception 'Start the game before scoring'; end if;
  if not exists (select 1 from public.picklester_game_participants where game_id = target_game.id and user_id = auth.uid() and role = 'referee') then
    raise exception 'Only the volunteer referee controls scoring';
  end if;
  update public.picklester_games set
    score_team_one = case when score_team = 1 then greatest(0, score_team_one + score_delta) else score_team_one end,
    score_team_two = case when score_team = 2 then greatest(0, score_team_two + score_delta) else score_team_two end,
    updated_at = now()
  where id = target_game.id;
end;
$$;

revoke all on function public.update_picklester_score(text, integer, integer) from public;
grant execute on function public.update_picklester_score(text, integer, integer) to authenticated;

create or replace function public.update_picklester_player_score(requested_code text, scored_user uuid, score_delta integer)
returns void language plpgsql security definer set search_path = '' as $$
declare target_game public.picklester_games%rowtype; scorer public.picklester_game_participants%rowtype; scorer_team integer;
begin
  if score_delta not in (-1, 1) then raise exception 'Invalid score update'; end if;
  select * into target_game from public.picklester_games where join_code = upper(trim(requested_code)) for update;
  if not found then raise exception 'Game code not found'; end if;
  if target_game.status <> 'scoring' then raise exception 'Start the game before scoring'; end if;
  if not exists (select 1 from public.picklester_game_participants where game_id = target_game.id and user_id = auth.uid() and role = 'referee') then
    raise exception 'Only the volunteer referee controls scoring';
  end if;
  select * into scorer from public.picklester_game_participants
  where game_id = target_game.id and user_id = scored_user and role = 'player' for update;
  if not found then raise exception 'Player is not paired in this game'; end if;
  if score_delta = -1 and scorer.individual_points = 0 then return; end if;
  scorer_team := case when target_game.format = 'solo' then scorer.position when scorer.position <= 2 then 1 else 2 end;
  update public.picklester_game_participants set individual_points = greatest(0, individual_points + score_delta)
  where game_id = target_game.id and user_id = scored_user;
  update public.picklester_games set
    score_team_one = case when scorer_team = 1 then greatest(0, score_team_one + score_delta) else score_team_one end,
    score_team_two = case when scorer_team = 2 then greatest(0, score_team_two + score_delta) else score_team_two end,
    updated_at = now()
  where id = target_game.id;
end;
$$;

revoke all on function public.update_picklester_player_score(text, uuid, integer) from public;
grant execute on function public.update_picklester_player_score(text, uuid, integer) to authenticated;

create or replace function public.update_picklester_serve(requested_code text, new_serving_team integer, new_server_number integer)
returns void language plpgsql security definer set search_path = '' as $$
declare target_game public.picklester_games%rowtype;
begin
  if new_serving_team not in (1, 2) or new_server_number not in (0, 1, 2) then raise exception 'Invalid serving position'; end if;
  select * into target_game from public.picklester_games where join_code = upper(trim(requested_code)) for update;
  if not found then raise exception 'Game code not found'; end if;
  if target_game.status <> 'scoring' then raise exception 'Start the game before changing serve'; end if;
  if not exists (select 1 from public.picklester_game_participants where game_id = target_game.id and user_id = auth.uid() and role = 'referee') then
    raise exception 'Only the volunteer referee controls serving';
  end if;
  update public.picklester_games set serving_team = new_serving_team, server_number = new_server_number, updated_at = now()
  where id = target_game.id;
end;
$$;

revoke all on function public.update_picklester_serve(text, integer, integer) from public;
grant execute on function public.update_picklester_serve(text, integer, integer) to authenticated;

create or replace function public.finalize_picklester_game(requested_code text, requested_mvp uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  target_game public.picklester_games%rowtype;
  winning_team integer;
begin
  select * into target_game from public.picklester_games where join_code = upper(trim(requested_code)) for update;
  if not found then raise exception 'Game code not found'; end if;
  if target_game.status <> 'scoring' then raise exception 'This result has already been recorded or the game has not started'; end if;
  if not exists (select 1 from public.picklester_game_participants where game_id = target_game.id and user_id = auth.uid() and role = 'referee') then
    raise exception 'Only the volunteer referee can record the final result';
  end if;
  if greatest(target_game.score_team_one, target_game.score_team_two) < target_game.score_limit then
    raise exception 'The target score has not been reached';
  end if;
  winning_team := case when target_game.score_team_one > target_game.score_team_two then 1 else 2 end;
  if not exists (
    select 1 from public.picklester_game_participants member
    where member.game_id = target_game.id and member.user_id = requested_mvp and member.role = 'player'
      and ((target_game.format = 'solo' and member.position = winning_team)
        or (target_game.format = 'duo' and ((winning_team = 1 and member.position <= 2) or (winning_team = 2 and member.position > 2))))
  ) then raise exception 'Choose the MVP from the winning side'; end if;

  update public.profiles profile set
    mmr = greatest(0, coalesce(profile.mmr, 1000)
      + case when ((target_game.format = 'solo' and member.position = winning_team)
        or (target_game.format = 'duo' and ((winning_team = 1 and member.position <= 2) or (winning_team = 2 and member.position > 2)))) then 25 else -15 end
      + case when profile.id = requested_mvp then 5 else 0 end),
    official_wins = profile.official_wins + case when ((target_game.format = 'solo' and member.position = winning_team)
      or (target_game.format = 'duo' and ((winning_team = 1 and member.position <= 2) or (winning_team = 2 and member.position > 2)))) then 1 else 0 end,
    official_losses = profile.official_losses + case when ((target_game.format = 'solo' and member.position = winning_team)
      or (target_game.format = 'duo' and ((winning_team = 1 and member.position <= 2) or (winning_team = 2 and member.position > 2)))) then 0 else 1 end,
    mvp_records = profile.mvp_records + case when profile.id = requested_mvp then 1 else 0 end,
    updated_at = now()
  from public.picklester_game_participants member
  where member.game_id = target_game.id and member.role = 'player' and profile.id = member.user_id;

  update public.profiles profile set volunteer_referee_records = profile.volunteer_referee_records + 1, updated_at = now()
  from public.picklester_game_participants member
  where member.game_id = target_game.id and member.role = 'referee' and profile.id = member.user_id;

  update public.picklester_games set status = 'completed', winner_team = winning_team,
    mvp_user_id = requested_mvp, ended_at = now(), updated_at = now()
  where id = target_game.id;
end;
$$;

revoke all on function public.finalize_picklester_game(text, uuid) from public;
grant execute on function public.finalize_picklester_game(text, uuid) to authenticated;

create or replace function public.finalize_picklester_game_v14(requested_code text)
returns void language plpgsql security definer set search_path = '' as $$
declare target_game public.picklester_games%rowtype; winning_team integer; automatic_mvp uuid;
begin
  select * into target_game from public.picklester_games where join_code = upper(trim(requested_code));
  if not found then raise exception 'Game code not found'; end if;
  winning_team := case when target_game.score_team_one > target_game.score_team_two then 1 else 2 end;
  select member.user_id into automatic_mvp
  from public.picklester_game_participants member
  where member.game_id = target_game.id and member.role = 'player'
    and ((target_game.format = 'solo' and member.position = winning_team)
      or (target_game.format = 'duo' and ((winning_team = 1 and member.position <= 2) or (winning_team = 2 and member.position > 2))))
  order by member.individual_points desc, member.position asc
  limit 1;
  if automatic_mvp is null then raise exception 'Winning player could not be identified'; end if;
  perform public.finalize_picklester_game(requested_code, automatic_mvp);
end;
$$;

revoke all on function public.finalize_picklester_game_v14(text) from public;
grant execute on function public.finalize_picklester_game_v14(text) to authenticated;

create or replace function public.get_picklester_game(requested_code text)
returns jsonb
language plpgsql
stable
security definer set search_path = ''
as $$
declare
  target_game public.picklester_games%rowtype;
  player_limit integer;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (verified or role in ('owner', 'admin'))
  ) then
    raise exception 'Owner verification is required';
  end if;

  select * into target_game
  from public.picklester_games
  where join_code = upper(trim(requested_code))
    and status in ('pairing', 'ready', 'scoring', 'completed');

  if not found then
    return null;
  end if;

  player_limit := case when target_game.format = 'solo' then 2 else 4 end;

  return jsonb_build_object(
    'id', target_game.id,
    'join_code', target_game.join_code,
    'format', target_game.format,
    'creator_id', target_game.creator_id,
    'status', target_game.status,
    'score_team_one', target_game.score_team_one,
    'score_team_two', target_game.score_team_two,
    'score_limit', target_game.score_limit,
    'serving_team', target_game.serving_team,
    'server_number', target_game.server_number,
    'winner_team', target_game.winner_team,
    'mvp_user_id', target_game.mvp_user_id,
    'player_limit', player_limit,
    'total_required', player_limit + 1,
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', member.user_id,
        'role', member.role,
        'position', member.position,
        'name', profile.name,
        'username', profile.username,
        'avatar_url', profile.avatar_url
        ,'individual_points', member.individual_points
      ) order by case when member.role = 'player' then 0 else 1 end, member.position nulls last)
      from public.picklester_game_participants member
      join public.profiles profile on profile.id = member.user_id
      where member.game_id = target_game.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_picklester_game(text) from public;
grant execute on function public.get_picklester_game(text) to authenticated;

notify pgrst, 'reload schema';
