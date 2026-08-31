-- Picklester V15: working social tools, automatic activity feed and match rewards.
-- Run this entire file once in Supabase SQL Editor after the V14 upgrade.

alter table public.profiles add column if not exists in_top_ten boolean not null default false;
alter table public.picklester_game_participants add column if not exists mmr_delta integer not null default 0;
alter table public.picklester_game_participants add column if not exists was_winner boolean not null default false;
alter table public.picklester_game_participants add column if not exists was_mvp boolean not null default false;

-- Followers (safe to run even when the original social schema was never installed).
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
create index if not exists follows_following_idx on public.follows(following_id);
alter table public.follows enable row level security;
drop policy if exists "Followers are visible to players" on public.follows;
create policy "Followers are visible to players" on public.follows for select to authenticated using (true);
drop policy if exists "Players follow verified players" on public.follows;
create policy "Players follow verified players" on public.follows for insert to authenticated with check (
  follower_id = auth.uid()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.verified or p.role in ('owner','admin')))
  and exists (select 1 from public.profiles p where p.id = following_id and (p.verified or p.role in ('owner','admin')))
);
drop policy if exists "Players unfollow" on public.follows;
create policy "Players unfollow" on public.follows for delete to authenticated using (follower_id = auth.uid());
grant select, insert, delete on public.follows to authenticated;

-- Community, private messages and GM tickets.
create table if not exists public.community_messages (
  id uuid primary key default gen_random_uuid(), sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500), created_at timestamptz not null default now()
);
create table if not exists public.private_messages (
  id uuid primary key default gen_random_uuid(), sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500), created_at timestamptz not null default now(), check (sender_id <> recipient_id)
);
create table if not exists public.gm_tickets (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 120), message text not null check (char_length(message) between 1 and 1200),
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.community_messages enable row level security;
alter table public.private_messages enable row level security;
alter table public.gm_tickets enable row level security;
drop policy if exists "Verified players read community chat" on public.community_messages;
create policy "Verified players read community chat" on public.community_messages for select to authenticated using (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.verified or p.role in ('owner','admin'))));
drop policy if exists "Verified players send community chat" on public.community_messages;
create policy "Verified players send community chat" on public.community_messages for insert to authenticated with check (sender_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.verified or p.role in ('owner','admin'))));
drop policy if exists "Private message participants read" on public.private_messages;
create policy "Private message participants read" on public.private_messages for select to authenticated using (sender_id = auth.uid() or recipient_id = auth.uid());
drop policy if exists "Verified players send private messages" on public.private_messages;
create policy "Verified players send private messages" on public.private_messages for insert to authenticated with check (sender_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.verified or p.role in ('owner','admin'))));
drop policy if exists "Users and staff read GM tickets" on public.gm_tickets;
create policy "Users and staff read GM tickets" on public.gm_tickets for select to authenticated using (user_id = auth.uid() or public.is_picklester_staff());
drop policy if exists "Users create GM tickets" on public.gm_tickets;
create policy "Users create GM tickets" on public.gm_tickets for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Staff update GM tickets" on public.gm_tickets;
create policy "Staff update GM tickets" on public.gm_tickets for update to authenticated using (public.is_picklester_staff()) with check (public.is_picklester_staff());
grant select, insert on public.community_messages, public.private_messages to authenticated;
grant select, insert, update on public.gm_tickets to authenticated;

create or replace function public.list_picklester_community_messages(message_limit integer default 50)
returns table(id uuid, sender_id uuid, body text, created_at timestamptz, sender_name text, sender_username text, sender_avatar_url text)
language sql stable security definer set search_path = '' as $$
  select m.id, m.sender_id, m.body, m.created_at, p.name, p.username, p.avatar_url
  from public.community_messages m join public.profiles p on p.id = m.sender_id
  where exists (select 1 from public.profiles me where me.id = auth.uid() and (me.verified or me.role in ('owner','admin')))
  order by m.created_at desc limit least(greatest(message_limit, 1), 100);
$$;
revoke all on function public.list_picklester_community_messages(integer) from public;
grant execute on function public.list_picklester_community_messages(integer) to authenticated;

create or replace function public.list_picklester_private_messages(message_limit integer default 50)
returns table(id uuid, sender_id uuid, recipient_id uuid, body text, created_at timestamptz, sender_name text, sender_username text, sender_avatar_url text, recipient_name text)
language sql stable security definer set search_path = '' as $$
  select m.id, m.sender_id, m.recipient_id, m.body, m.created_at, sender.name, sender.username, sender.avatar_url, recipient.name
  from public.private_messages m join public.profiles sender on sender.id = m.sender_id join public.profiles recipient on recipient.id = m.recipient_id
  where m.sender_id = auth.uid() or m.recipient_id = auth.uid()
  order by m.created_at desc limit least(greatest(message_limit, 1), 100);
$$;
revoke all on function public.list_picklester_private_messages(integer) from public;
grant execute on function public.list_picklester_private_messages(integer) to authenticated;

-- Compact 36-hour automatic feed, capped at 100 rows.
create table if not exists public.picklester_activity_feed (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('verified','match_win','mvp','top10')),
  actor_id uuid not null references public.profiles(id) on delete cascade,
  game_id uuid references public.picklester_games(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);
create index if not exists picklester_activity_feed_recent_idx on public.picklester_activity_feed(created_at desc);
alter table public.picklester_activity_feed enable row level security;
drop policy if exists "Verified players read activity feed" on public.picklester_activity_feed;
create policy "Verified players read activity feed" on public.picklester_activity_feed for select to authenticated using (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.verified or p.role in ('owner','admin'))));
grant select on public.picklester_activity_feed to authenticated;

create or replace function public.trim_picklester_activity_feed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.picklester_activity_feed where created_at < now() - interval '36 hours';
  delete from public.picklester_activity_feed where id in (select id from public.picklester_activity_feed order by created_at desc offset 100);
  return new;
end;
$$;
drop trigger if exists trim_picklester_activity_feed_after_insert on public.picklester_activity_feed;
create trigger trim_picklester_activity_feed_after_insert after insert on public.picklester_activity_feed for each statement execute procedure public.trim_picklester_activity_feed();

create or replace function public.feed_picklester_verification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.verified and not old.verified then
    insert into public.picklester_activity_feed(event_type, actor_id, message) values ('verified', new.id, 'joined the verified Picklester community.');
  end if;
  return new;
end;
$$;
drop trigger if exists feed_picklester_verification_after_update on public.profiles;
create trigger feed_picklester_verification_after_update after update of verified on public.profiles for each row execute procedure public.feed_picklester_verification();

create or replace function public.list_picklester_activity_feed(result_limit integer default 100)
returns table(id uuid, event_type text, actor_id uuid, actor_name text, actor_username text, actor_avatar_url text, message text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select f.id, f.event_type, f.actor_id, p.name, p.username, p.avatar_url, f.message, f.created_at
  from public.picklester_activity_feed f join public.profiles p on p.id = f.actor_id
  where f.created_at >= now() - interval '36 hours'
    and exists (select 1 from public.profiles me where me.id = auth.uid() and (me.verified or me.role in ('owner','admin')))
  order by f.created_at desc limit least(greatest(result_limit, 1), 100);
$$;
revoke all on function public.list_picklester_activity_feed(integer) from public;
grant execute on function public.list_picklester_activity_feed(integer) to authenticated;

create table if not exists public.official_match_results (
  id uuid primary key default gen_random_uuid(), format text not null check (format in ('solo','duo')),
  completed_at timestamptz not null default now(), volunteer_referee_id uuid references public.profiles(id), created_at timestamptz not null default now()
);
create table if not exists public.official_match_players (
  match_id uuid not null references public.official_match_results(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  outcome text not null check (outcome in ('win','loss')), points_delta integer not null default 0,
  primary key (match_id, player_id)
);
alter table public.official_match_results enable row level security;
alter table public.official_match_players enable row level security;
drop policy if exists "Official results are visible" on public.official_match_results;
create policy "Official results are visible" on public.official_match_results for select to authenticated using (true);
drop policy if exists "Official result players are visible" on public.official_match_players;
create policy "Official result players are visible" on public.official_match_players for select to authenticated using (true);
grant select on public.official_match_results, public.official_match_players to authenticated;

-- Conservative V15 rewards: winner +3, loser -4, MVP bonus +3.
create or replace function public.finalize_picklester_game_v15(requested_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_game public.picklester_games%rowtype; winning_team integer; automatic_mvp uuid; result_id uuid; ranked record;
begin
  select * into target_game from public.picklester_games where join_code = upper(trim(requested_code)) for update;
  if not found then raise exception 'Game code not found'; end if;
  if target_game.status <> 'scoring' then raise exception 'This result has already been recorded or the game has not started'; end if;
  if not exists (select 1 from public.picklester_game_participants where game_id = target_game.id and user_id = auth.uid() and role = 'referee') then raise exception 'Only the volunteer referee can record the final result'; end if;
  if greatest(target_game.score_team_one, target_game.score_team_two) < target_game.score_limit then raise exception 'The target score has not been reached'; end if;
  winning_team := case when target_game.score_team_one > target_game.score_team_two then 1 else 2 end;
  select member.user_id into automatic_mvp from public.picklester_game_participants member
  where member.game_id = target_game.id and member.role = 'player' and ((target_game.format = 'solo' and member.position = winning_team) or (target_game.format = 'duo' and ((winning_team = 1 and member.position <= 2) or (winning_team = 2 and member.position > 2))))
  order by member.individual_points desc, member.position asc limit 1;

  update public.picklester_game_participants member set
    was_winner = ((target_game.format = 'solo' and member.position = winning_team) or (target_game.format = 'duo' and ((winning_team = 1 and member.position <= 2) or (winning_team = 2 and member.position > 2)))),
    was_mvp = member.user_id = automatic_mvp,
    mmr_delta = case when ((target_game.format = 'solo' and member.position = winning_team) or (target_game.format = 'duo' and ((winning_team = 1 and member.position <= 2) or (winning_team = 2 and member.position > 2)))) then 3 else -4 end + case when member.user_id = automatic_mvp then 3 else 0 end
  where member.game_id = target_game.id and member.role = 'player';

  update public.profiles p set mmr = greatest(0, coalesce(p.mmr, 1000) + member.mmr_delta),
    official_wins = p.official_wins + case when member.was_winner then 1 else 0 end,
    official_losses = p.official_losses + case when member.was_winner then 0 else 1 end,
    win_streak = case when member.was_winner then coalesce(p.win_streak,0)+1 else 0 end,
    mvp_records = p.mvp_records + case when member.was_mvp then 1 else 0 end, updated_at = now()
  from public.picklester_game_participants member where member.game_id = target_game.id and member.role = 'player' and p.id = member.user_id;
  update public.profiles p set volunteer_referee_records = p.volunteer_referee_records + 1, updated_at = now()
  from public.picklester_game_participants member where member.game_id = target_game.id and member.role = 'referee' and p.id = member.user_id;
  update public.picklester_games set status = 'completed', winner_team = winning_team, mvp_user_id = automatic_mvp, ended_at = now(), updated_at = now() where id = target_game.id;

  insert into public.official_match_results(format, completed_at, volunteer_referee_id)
  select target_game.format, now(), user_id from public.picklester_game_participants where game_id = target_game.id and role = 'referee' returning id into result_id;
  insert into public.official_match_players(match_id, player_id, outcome, points_delta)
  select result_id, user_id, case when was_winner then 'win' else 'loss' end, mmr_delta from public.picklester_game_participants where game_id = target_game.id and role = 'player';
  insert into public.picklester_activity_feed(event_type, actor_id, game_id, message)
  select 'match_win', user_id, target_game.id, 'won a ' || target_game.format || ' match.' from public.picklester_game_participants where game_id = target_game.id and role = 'player' and was_winner;
  insert into public.picklester_activity_feed(event_type, actor_id, game_id, message) values ('mvp', automatic_mvp, target_game.id, 'earned MVP with the most points on the winning side.');

  for ranked in select p.id, row_number() over (order by p.mmr desc, p.updated_at asc, p.id) as position, p.in_top_ten from public.profiles p where p.mmr is not null and (p.verified or p.role in ('owner','admin')) loop
    if ranked.position <= 10 and not ranked.in_top_ten then insert into public.picklester_activity_feed(event_type, actor_id, message) values ('top10', ranked.id, 'entered the Picklester Top 10.'); end if;
    update public.profiles set in_top_ten = ranked.position <= 10 where id = ranked.id;
  end loop;
  return jsonb_build_object('game_id', target_game.id, 'winner_team', winning_team, 'mvp_user_id', automatic_mvp);
end;
$$;
revoke all on function public.finalize_picklester_game_v15(text) from public;
grant execute on function public.finalize_picklester_game_v15(text) to authenticated;

create or replace function public.get_picklester_game(requested_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare target_game public.picklester_games%rowtype; player_limit integer;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and (verified or role in ('owner','admin'))) then raise exception 'Owner verification is required'; end if;
  select * into target_game from public.picklester_games where join_code = upper(trim(requested_code)) and status in ('pairing','ready','scoring','completed');
  if not found then return null; end if;
  player_limit := case when target_game.format = 'solo' then 2 else 4 end;
  return jsonb_build_object('id',target_game.id,'join_code',target_game.join_code,'format',target_game.format,'creator_id',target_game.creator_id,'status',target_game.status,
    'score_team_one',target_game.score_team_one,'score_team_two',target_game.score_team_two,'score_limit',target_game.score_limit,'serving_team',target_game.serving_team,'server_number',target_game.server_number,
    'winner_team',target_game.winner_team,'mvp_user_id',target_game.mvp_user_id,'player_limit',player_limit,'total_required',player_limit+1,
    'participants',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'role',m.role,'position',m.position,'name',p.name,'username',p.username,'avatar_url',p.avatar_url,
      'individual_points',m.individual_points,'mmr_delta',m.mmr_delta,'was_winner',m.was_winner,'was_mvp',m.was_mvp) order by case when m.role='player' then 0 else 1 end,m.position nulls last)
      from public.picklester_game_participants m join public.profiles p on p.id=m.user_id where m.game_id=target_game.id),'[]'::jsonb));
end;
$$;
revoke all on function public.get_picklester_game(text) from public;
grant execute on function public.get_picklester_game(text) to authenticated;

notify pgrst, 'reload schema';
