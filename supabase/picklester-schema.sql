-- Picklester profile, verification, ranking and open-play foundation.
-- Run once in the Supabase SQL Editor for the project connected to Picklester.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  username text unique,
  avatar_url text,
  verified boolean not null default false,
  role text not null default 'player' check (role in ('player', 'admin', 'owner')),
  mmr integer,
  level_name text,
  official_wins integer not null default 0,
  official_losses integer not null default 0,
  mvp_records integer not null default 0,
  volunteer_referee_records integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Safe upgrades for projects where profiles was created by an earlier draft.
alter table public.profiles add column if not exists name text not null default '';
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists verified boolean not null default false;
alter table public.profiles add column if not exists role text not null default 'player';
alter table public.profiles add column if not exists mmr integer;
alter table public.profiles add column if not exists level_name text;
alter table public.profiles add column if not exists official_wins integer not null default 0;
alter table public.profiles add column if not exists official_losses integer not null default 0;
alter table public.profiles add column if not exists mvp_records integer not null default 0;
alter table public.profiles add column if not exists volunteer_referee_records integer not null default 0;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
create unique index if not exists profiles_username_lower_unique on public.profiles (lower(username)) where username is not null;

alter table public.profiles enable row level security;

create or replace function public.is_picklester_staff()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_picklester_staff() from public;
grant execute on function public.is_picklester_staff() to authenticated;

create or replace function public.is_picklester_owner()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner'
  );
$$;

revoke all on function public.is_picklester_owner() from public;
grant execute on function public.is_picklester_owner() to authenticated;

create or replace function public.handle_new_picklester_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, name, username, avatar_url, role, verified)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name', ''),
    nullif(lower(new.raw_user_meta_data ->> 'username'), ''),
    new.raw_user_meta_data ->> 'avatar_url',
    case when lower(new.email) = 'kuramaartsdeveloper@gmail.com' then 'owner' else 'player' end,
    coalesce(lower(new.email) = 'kuramaartsdeveloper@gmail.com', false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_picklester on auth.users;
create trigger on_auth_user_created_picklester
  after insert on auth.users
  for each row execute procedure public.handle_new_picklester_user();

-- Backfill accounts created before this profile trigger existed.
insert into public.profiles (id, name, username, avatar_url, role, verified)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'name', u.raw_user_meta_data ->> 'full_name', ''),
  nullif(lower(u.raw_user_meta_data ->> 'username'), ''),
  u.raw_user_meta_data ->> 'avatar_url',
  case when lower(u.email) = 'kuramaartsdeveloper@gmail.com' then 'owner' else 'player' end,
  coalesce(lower(u.email) = 'kuramaartsdeveloper@gmail.com', false)
from auth.users u
on conflict (id) do nothing;

-- The Picklester owner never needs player verification.
update public.profiles p
set role = 'owner', verified = true, updated_at = now()
from auth.users u
where p.id = u.id and lower(u.email) = 'kuramaartsdeveloper@gmail.com';

drop policy if exists "Profiles are visible to their owner or when verified" on public.profiles;
create policy "Profiles are visible to their owner or when verified"
on public.profiles for select to authenticated
using (auth.uid() = id or verified = true or public.is_picklester_staff());

drop policy if exists "Players update their own profile" on public.profiles;
create policy "Players update their own profile"
on public.profiles for update to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Players create their own missing profile" on public.profiles;
create policy "Players create their own missing profile"
on public.profiles for insert to authenticated
with check (auth.uid() = id);

revoke update on public.profiles from authenticated;
grant update (name, username, avatar_url, updated_at) on public.profiles to authenticated;
grant insert (id, name, username, avatar_url, updated_at) on public.profiles to authenticated;
grant select on public.profiles to authenticated;

create or replace function public.set_picklester_verification(target_user uuid, approved boolean)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_picklester_staff() then
    raise exception 'Owner or admin access is required';
  end if;
  update public.profiles set verified = approved, updated_at = now()
  where id = target_user and role = 'player';
end;
$$;

revoke all on function public.set_picklester_verification(uuid, boolean) from public;
grant execute on function public.set_picklester_verification(uuid, boolean) to authenticated;

create or replace function public.set_picklester_role(target_user uuid, new_role text)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_picklester_owner() then
    raise exception 'Only the Picklester owner can manage admins';
  end if;
  if new_role not in ('player', 'admin') then
    raise exception 'Invalid member role';
  end if;
  update public.profiles
  set role = new_role,
      verified = case when new_role = 'admin' then true else verified end,
      updated_at = now()
  where id = target_user and role <> 'owner';
end;
$$;

revoke all on function public.set_picklester_role(uuid, text) from public;
grant execute on function public.set_picklester_role(uuid, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 3145728,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Avatar images are publicly readable" on storage.objects;
create policy "Avatar images are publicly readable"
on storage.objects for select using (bucket_id = 'avatars');

drop policy if exists "Players upload their own avatar" on storage.objects;
create policy "Players upload their own avatar"
on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Players replace their own avatar" on storage.objects;
create policy "Players replace their own avatar"
on storage.objects for update to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create table if not exists public.open_plays (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  format text not null check (format in ('solo', 'duo')),
  title text not null,
  game_date date not null,
  game_time time not null,
  venue text not null,
  status text not null default 'open' check (status in ('open', 'confirmed', 'cancelled', 'complete')),
  created_at timestamptz not null default now()
);

alter table public.open_plays enable row level security;

drop policy if exists "Verified players view open play" on public.open_plays;
create policy "Verified players view open play"
on public.open_plays for select to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.verified or p.role in ('owner', 'admin'))));

drop policy if exists "Verified players schedule open play" on public.open_plays;
create policy "Verified players schedule open play"
on public.open_plays for insert to authenticated
with check (
  creator_id = auth.uid()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.verified or p.role in ('owner', 'admin')))
);

grant select, insert on public.open_plays to authenticated;

-- Owner email is automatically assigned and backfilled above.

-- ---------------------------------------------------------------------------
-- Registration reliability upgrade
-- ---------------------------------------------------------------------------

create or replace function public.is_picklester_username_available(candidate text)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select
    candidate is not null
    and lower(trim(candidate)) ~ '^[a-z0-9_]{3,24}$'
    and not exists (
      select 1 from public.profiles
      where lower(username) = lower(trim(candidate))
    );
$$;

revoke all on function public.is_picklester_username_available(text) from public;
grant execute on function public.is_picklester_username_available(text) to anon, authenticated;

create or replace function public.handle_new_picklester_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  requested_username text;
begin
  requested_username := nullif(lower(trim(new.raw_user_meta_data ->> 'username')), '');
  if requested_username !~ '^[a-z0-9_]{3,24}$'
     or exists (select 1 from public.profiles where lower(username) = requested_username) then
    requested_username := null;
  end if;

  insert into public.profiles (id, name, username, avatar_url, role, verified)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name', ''),
    requested_username,
    new.raw_user_meta_data ->> 'avatar_url',
    case when lower(new.email) = 'kuramaartsdeveloper@gmail.com' then 'owner' else 'player' end,
    coalesce(lower(new.email) = 'kuramaartsdeveloper@gmail.com', false)
  )
  on conflict (id) do update set
    name = case when public.profiles.name = '' then excluded.name else public.profiles.name end,
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
    updated_at = now();
  return new;
exception
  when unique_violation then
    insert into public.profiles (id, name, username, avatar_url, role, verified)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name', ''),
      null,
      new.raw_user_meta_data ->> 'avatar_url',
      case when lower(new.email) = 'kuramaartsdeveloper@gmail.com' then 'owner' else 'player' end,
      coalesce(lower(new.email) = 'kuramaartsdeveloper@gmail.com', false)
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Four profile photos
-- ---------------------------------------------------------------------------

create table if not exists public.profile_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  slot smallint not null check (slot between 1 and 4),
  photo_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slot)
);

alter table public.profile_photos enable row level security;
drop policy if exists "Visible profile photos" on public.profile_photos;
create policy "Visible profile photos" on public.profile_photos for select to authenticated
using (
  user_id = auth.uid()
  or exists (select 1 from public.profiles p where p.id = user_id and p.verified)
  or public.is_picklester_staff()
);
drop policy if exists "Players add profile photos" on public.profile_photos;
create policy "Players add profile photos" on public.profile_photos for insert to authenticated
with check (user_id = auth.uid());
drop policy if exists "Players update profile photos" on public.profile_photos;
create policy "Players update profile photos" on public.profile_photos for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Players delete profile photos" on public.profile_photos;
create policy "Players delete profile photos" on public.profile_photos for delete to authenticated
using (user_id = auth.uid());
grant select, insert, update, delete on public.profile_photos to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-media', 'profile-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Profile media is publicly readable" on storage.objects;
create policy "Profile media is publicly readable" on storage.objects for select
using (bucket_id = 'profile-media');
drop policy if exists "Players upload their profile media" on storage.objects;
create policy "Players upload their profile media" on storage.objects for insert to authenticated
with check (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Players replace their profile media" on storage.objects;
create policy "Players replace their profile media" on storage.objects for update to authenticated
using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Players delete their profile media" on storage.objects;
create policy "Players delete their profile media" on storage.objects for delete to authenticated
using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Four real achievement badges and one selectable featured badge
-- ---------------------------------------------------------------------------

create table if not exists public.badge_catalog (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null,
  icon_key text not null default 'award',
  accent_color text not null default '#bdf400',
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.badge_catalog (id, slug, name, description, icon_key, accent_color, display_order)
values
  ('10000000-0000-4000-8000-000000000001', 'first-official-win', 'First Official Win', 'Unlocked after the player records a first official win.', 'trophy', '#bdf400', 1),
  ('10000000-0000-4000-8000-000000000002', 'five-official-wins', 'Five Official Wins', 'Unlocked after five official victories.', 'star', '#f0a12a', 2),
  ('10000000-0000-4000-8000-000000000003', 'mvp-player', 'MVP Player', 'Unlocked after earning an official MVP record.', 'award', '#ff7d6e', 3),
  ('10000000-0000-4000-8000-000000000004', 'volunteer-referee', 'Volunteer Referee', 'Unlocked after completing an official volunteer referee record.', 'shield', '#08a9e5', 4)
on conflict (id) do update set name = excluded.name, description = excluded.description,
  icon_key = excluded.icon_key, accent_color = excluded.accent_color,
  display_order = excluded.display_order, is_active = true;

create table if not exists public.player_badges (
  user_id uuid not null references public.profiles(id) on delete cascade,
  badge_id uuid not null references public.badge_catalog(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  is_featured boolean not null default false,
  primary key (user_id, badge_id)
);
create unique index if not exists one_featured_badge_per_player on public.player_badges(user_id) where is_featured;

alter table public.badge_catalog enable row level security;
alter table public.player_badges enable row level security;
drop policy if exists "Active badges are visible" on public.badge_catalog;
create policy "Active badges are visible" on public.badge_catalog for select to authenticated using (is_active);
drop policy if exists "Player badges are visible" on public.player_badges;
create policy "Player badges are visible" on public.player_badges for select to authenticated
using (user_id = auth.uid() or exists (select 1 from public.profiles p where p.id = user_id and p.verified) or public.is_picklester_staff());
grant select on public.badge_catalog, public.player_badges to authenticated;

create or replace function public.set_featured_picklester_badge(target_badge uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.player_badges where user_id = auth.uid() and badge_id = target_badge) then
    raise exception 'This badge is not unlocked';
  end if;
  update public.player_badges set is_featured = false where user_id = auth.uid();
  update public.player_badges set is_featured = true where user_id = auth.uid() and badge_id = target_badge;
end;
$$;
revoke all on function public.set_featured_picklester_badge(uuid) from public;
grant execute on function public.set_featured_picklester_badge(uuid) to authenticated;

create or replace function public.sync_picklester_badges()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.official_wins >= 1 then insert into public.player_badges(user_id, badge_id) values (new.id, '10000000-0000-4000-8000-000000000001') on conflict do nothing; end if;
  if new.official_wins >= 5 then insert into public.player_badges(user_id, badge_id) values (new.id, '10000000-0000-4000-8000-000000000002') on conflict do nothing; end if;
  if new.mvp_records >= 1 then insert into public.player_badges(user_id, badge_id) values (new.id, '10000000-0000-4000-8000-000000000003') on conflict do nothing; end if;
  if new.volunteer_referee_records >= 1 then insert into public.player_badges(user_id, badge_id) values (new.id, '10000000-0000-4000-8000-000000000004') on conflict do nothing; end if;
  return new;
end;
$$;
drop trigger if exists sync_picklester_badges_after_profile_change on public.profiles;
create trigger sync_picklester_badges_after_profile_change
after insert or update of official_wins, mvp_records, volunteer_referee_records on public.profiles
for each row execute procedure public.sync_picklester_badges();

insert into public.player_badges(user_id, badge_id)
select id, '10000000-0000-4000-8000-000000000001'::uuid from public.profiles where official_wins >= 1 on conflict do nothing;
insert into public.player_badges(user_id, badge_id)
select id, '10000000-0000-4000-8000-000000000002'::uuid from public.profiles where official_wins >= 5 on conflict do nothing;
insert into public.player_badges(user_id, badge_id)
select id, '10000000-0000-4000-8000-000000000003'::uuid from public.profiles where mvp_records >= 1 on conflict do nothing;
insert into public.player_badges(user_id, badge_id)
select id, '10000000-0000-4000-8000-000000000004'::uuid from public.profiles where volunteer_referee_records >= 1 on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Followers
-- ---------------------------------------------------------------------------

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
create policy "Players follow verified players" on public.follows for insert to authenticated
with check (
  follower_id = auth.uid()
  and exists (select 1 from public.profiles me where me.id = auth.uid() and (me.verified or me.role in ('owner','admin')))
  and exists (select 1 from public.profiles them where them.id = following_id and (them.verified or them.role in ('owner','admin')))
);
drop policy if exists "Players unfollow" on public.follows;
create policy "Players unfollow" on public.follows for delete to authenticated using (follower_id = auth.uid());
grant select, insert, delete on public.follows to authenticated;

-- ---------------------------------------------------------------------------
-- Opt-in nearby location and private 20 km lookup
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
create policy "Players read their own location" on public.profile_locations for select to authenticated using (user_id = auth.uid());
drop policy if exists "Players add their location" on public.profile_locations;
create policy "Players add their location" on public.profile_locations for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Players update their location" on public.profile_locations;
create policy "Players update their location" on public.profile_locations for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.profile_locations to authenticated;

create or replace function public.nearby_picklesters(current_lat double precision, current_lng double precision, radius_km double precision default 20)
returns table(id uuid, name text, username text, avatar_url text, distance_km double precision, bearing_deg double precision)
language sql stable security definer set search_path = '' as $$
  with candidates as (
    select p.id, p.name, p.username, p.avatar_url, l.latitude, l.longitude,
      6371 * 2 * asin(sqrt(
        power(sin(radians((l.latitude - current_lat) / 2)), 2)
        + cos(radians(current_lat)) * cos(radians(l.latitude))
        * power(sin(radians((l.longitude - current_lng) / 2)), 2)
      )) as distance_km
    from public.profile_locations l
    join public.profiles p on p.id = l.user_id
    where l.location_enabled and l.latitude is not null and l.longitude is not null
      and p.verified and p.id <> auth.uid()
      and exists (select 1 from public.profiles me where me.id = auth.uid() and (me.verified or me.role in ('owner','admin')))
  )
  select c.id, c.name, c.username, c.avatar_url, c.distance_km,
    degrees(atan2(
      sin(radians(c.longitude - current_lng)) * cos(radians(c.latitude)),
      cos(radians(current_lat)) * sin(radians(c.latitude))
      - sin(radians(current_lat)) * cos(radians(c.latitude)) * cos(radians(c.longitude - current_lng))
    ))::double precision as bearing_deg
  from candidates c
  where c.distance_km <= least(greatest(radius_km, 0), 20)
  order by c.distance_km asc
  limit 100;
$$;
revoke all on function public.nearby_picklesters(double precision, double precision, double precision) from public;
grant execute on function public.nearby_picklesters(double precision, double precision, double precision) to authenticated;

-- ---------------------------------------------------------------------------
-- Real social home feed
-- ---------------------------------------------------------------------------

create table if not exists public.player_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.post_likes (
  post_id uuid not null references public.player_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.player_posts enable row level security;
alter table public.post_likes enable row level security;
drop policy if exists "Verified posts are visible" on public.player_posts;
create policy "Verified posts are visible" on public.player_posts for select to authenticated
using (author_id = auth.uid() or exists (select 1 from public.profiles p where p.id = author_id and (p.verified or p.role in ('owner','admin'))));
drop policy if exists "Verified players create posts" on public.player_posts;
create policy "Verified players create posts" on public.player_posts for insert to authenticated
with check (author_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.verified or p.role in ('owner','admin'))));
drop policy if exists "Players update their posts" on public.player_posts;
create policy "Players update their posts" on public.player_posts for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists "Players delete their posts" on public.player_posts;
create policy "Players delete their posts" on public.player_posts for delete to authenticated using (author_id = auth.uid());
drop policy if exists "Post likes are visible" on public.post_likes;
create policy "Post likes are visible" on public.post_likes for select to authenticated using (true);
grant select, insert, update, delete on public.player_posts to authenticated;
grant select on public.post_likes to authenticated;

create or replace function public.toggle_picklester_post_like(target_post uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and (verified or role in ('owner','admin'))) then raise exception 'Verification required'; end if;
  if exists (select 1 from public.post_likes where post_id = target_post and user_id = auth.uid()) then
    delete from public.post_likes where post_id = target_post and user_id = auth.uid(); return false;
  end if;
  insert into public.post_likes(post_id, user_id) values (target_post, auth.uid()); return true;
end;
$$;
revoke all on function public.toggle_picklester_post_like(uuid) from public;
grant execute on function public.toggle_picklester_post_like(uuid) to authenticated;

create or replace function public.list_picklester_posts(sort_mode text default 'recent', result_limit integer default 30)
returns table(id uuid, author_id uuid, body text, created_at timestamptz, like_count bigint, liked_by_me boolean, author_name text, author_username text, author_avatar_url text, author_verified boolean)
language sql stable security definer set search_path = '' as $$
  select post.id, post.author_id, post.body, post.created_at,
    (select count(*) from public.post_likes likes where likes.post_id = post.id) as like_count,
    exists (select 1 from public.post_likes mine where mine.post_id = post.id and mine.user_id = auth.uid()) as liked_by_me,
    author.name, author.username, author.avatar_url, author.verified
  from public.player_posts post
  join public.profiles author on author.id = post.author_id
  where author.verified or author.role in ('owner','admin')
  order by
    case when lower(sort_mode) = 'popular' then (select count(*) from public.post_likes popular where popular.post_id = post.id) else 0 end desc,
    post.created_at desc
  limit least(greatest(result_limit, 1), 50);
$$;
revoke all on function public.list_picklester_posts(text, integer) from public;
grant execute on function public.list_picklester_posts(text, integer) to authenticated;

create or replace function public.search_picklesters(search_text text default '', result_limit integer default 30)
returns table(id uuid, name text, username text, avatar_url text, follower_count bigint)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name, p.username, p.avatar_url,
    (select count(*) from public.follows f where f.following_id = p.id) as follower_count
  from public.profiles p
  where (p.verified or p.role in ('owner','admin')) and p.id <> auth.uid()
    and (trim(search_text) = '' or p.name ilike '%' || trim(search_text) || '%' or p.username ilike '%' || lower(trim(replace(search_text, '@', ''))) || '%')
  order by follower_count desc, p.name asc
  limit least(greatest(result_limit, 1), 50);
$$;
revoke all on function public.search_picklesters(text, integer) from public;
grant execute on function public.search_picklesters(text, integer) to authenticated;

-- Minimal official-result tables prepare the daily winners filter for real match data.
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
alter table public.official_match_results enable row level security;
alter table public.official_match_players enable row level security;
drop policy if exists "Official results are visible" on public.official_match_results;
create policy "Official results are visible" on public.official_match_results for select to authenticated using (true);
drop policy if exists "Official result players are visible" on public.official_match_players;
create policy "Official result players are visible" on public.official_match_players for select to authenticated using (true);
grant select on public.official_match_results, public.official_match_players to authenticated;

create or replace function public.top_picklester_winners_today(result_limit integer default 20)
returns table(id uuid, name text, username text, avatar_url text, follower_count bigint, wins_today bigint)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name, p.username, p.avatar_url,
    (select count(*) from public.follows f where f.following_id = p.id) as follower_count,
    count(*) as wins_today
  from public.official_match_players mp
  join public.official_match_results result on result.id = mp.match_id
  join public.profiles p on p.id = mp.player_id
  where mp.outcome = 'win' and result.completed_at >= date_trunc('day', now())
    and (p.verified or p.role in ('owner','admin'))
  group by p.id, p.name, p.username, p.avatar_url
  order by wins_today desc, p.name asc
  limit least(greatest(result_limit, 1), 50);
$$;
revoke all on function public.top_picklester_winners_today(integer) from public;
grant execute on function public.top_picklester_winners_today(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Community chat, private chat and Game Master tickets
-- ---------------------------------------------------------------------------

create table if not exists public.community_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create table if not exists public.private_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create table if not exists public.gm_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 120),
  message text not null check (char_length(message) between 1 and 1200),
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.community_messages enable row level security;
alter table public.private_messages enable row level security;
alter table public.gm_tickets enable row level security;
drop policy if exists "Verified players read community chat" on public.community_messages;
create policy "Verified players read community chat" on public.community_messages for select to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.verified or p.role in ('owner','admin'))));
drop policy if exists "Verified players send community chat" on public.community_messages;
create policy "Verified players send community chat" on public.community_messages for insert to authenticated
with check (sender_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.verified or p.role in ('owner','admin'))));
drop policy if exists "Private message participants read" on public.private_messages;
create policy "Private message participants read" on public.private_messages for select to authenticated using (sender_id = auth.uid() or recipient_id = auth.uid());
drop policy if exists "Verified players send private messages" on public.private_messages;
create policy "Verified players send private messages" on public.private_messages for insert to authenticated
with check (sender_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.verified or p.role in ('owner','admin'))));
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
  from public.private_messages m
  join public.profiles sender on sender.id = m.sender_id
  join public.profiles recipient on recipient.id = m.recipient_id
  where m.sender_id = auth.uid() or m.recipient_id = auth.uid()
  order by m.created_at desc limit least(greatest(message_limit, 1), 100);
$$;
revoke all on function public.list_picklester_private_messages(integer) from public;
grant execute on function public.list_picklester_private_messages(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Base game pairing schema. Apply picklester-v14-upgrade.sql for individual scoring and automatic MVP.
-- ---------------------------------------------------------------------------

create table if not exists public.picklester_games (
  id uuid primary key default gen_random_uuid(),
  join_code text not null unique,
  format text not null check (format in ('solo', 'duo')),
  creator_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'pairing'
    check (status in ('pairing', 'ready', 'scoring', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.picklester_game_participants (
  game_id uuid not null references public.picklester_games(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  role text not null check (role in ('player', 'referee')),
  position smallint,
  joined_at timestamptz not null default now(),
  primary key (game_id, user_id),
  check (
    (role = 'player' and position is not null and position between 1 and 4)
    or (role = 'referee' and position is null)
  )
);

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

create or replace function public.create_picklester_game(game_format text, creator_role text)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  new_game_id uuid;
  new_join_code text;
begin
  if game_format not in ('solo', 'duo') then raise exception 'Invalid game format'; end if;
  if creator_role not in ('player', 'referee') then raise exception 'Invalid creator role'; end if;
  if not exists (
    select 1 from public.profiles where id = auth.uid()
      and (verified or role in ('owner', 'admin'))
  ) then raise exception 'Owner verification is required'; end if;

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
  values (new_game_id, auth.uid(), creator_role, case when creator_role = 'player' then 1 else null end);
  return new_join_code;
end;
$$;

revoke all on function public.create_picklester_game(text, text) from public;
grant execute on function public.create_picklester_game(text, text) to authenticated;

create or replace function public.join_picklester_game(requested_code text, desired_role text)
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
  if desired_role not in ('player', 'referee') then raise exception 'Choose player or volunteer referee'; end if;
  if not exists (
    select 1 from public.profiles where id = auth.uid()
      and (verified or role in ('owner', 'admin'))
  ) then raise exception 'Owner verification is required'; end if;

  select * into target_game from public.picklester_games
  where join_code = upper(trim(requested_code)) for update;
  if not found then raise exception 'Game code not found'; end if;
  if target_game.status not in ('pairing', 'ready') then raise exception 'This game is no longer accepting members'; end if;
  if exists (
    select 1 from public.picklester_game_participants
    where game_id = target_game.id and user_id = auth.uid()
  ) then return; end if;

  player_limit := case when target_game.format = 'solo' then 2 else 4 end;
  select count(*) into player_count from public.picklester_game_participants
  where game_id = target_game.id and role = 'player';
  select count(*) into referee_count from public.picklester_game_participants
  where game_id = target_game.id and role = 'referee';

  if desired_role = 'referee' then
    if referee_count >= 1 then raise exception 'The volunteer referee position is already filled'; end if;
    insert into public.picklester_game_participants(game_id, user_id, role, position)
    values (target_game.id, auth.uid(), 'referee', null);
    referee_count := 1;
  else
    if player_count >= player_limit then raise exception 'All player positions are filled'; end if;
    insert into public.picklester_game_participants(game_id, user_id, role, position)
    values (target_game.id, auth.uid(), 'player', player_count + 1);
    player_count := player_count + 1;
  end if;

  update public.picklester_games
  set status = case when player_count = player_limit and referee_count = 1 then 'ready' else 'pairing' end,
      updated_at = now()
  where id = target_game.id;
end;
$$;

revoke all on function public.join_picklester_game(text, text) from public;
grant execute on function public.join_picklester_game(text, text) to authenticated;

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
    select 1 from public.profiles where id = auth.uid()
      and (verified or role in ('owner', 'admin'))
  ) then raise exception 'Owner verification is required'; end if;

  select * into target_game from public.picklester_games
  where join_code = upper(trim(requested_code))
    and status in ('pairing', 'ready', 'scoring');
  if not found then return null; end if;
  player_limit := case when target_game.format = 'solo' then 2 else 4 end;

  return jsonb_build_object(
    'id', target_game.id,
    'join_code', target_game.join_code,
    'format', target_game.format,
    'creator_id', target_game.creator_id,
    'status', target_game.status,
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
