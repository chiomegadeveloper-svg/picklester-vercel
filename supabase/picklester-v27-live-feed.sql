-- Picklester V27: realtime activity feed and badge/frame activity.
-- Run this entire file once in Supabase SQL Editor. Safe to run again.

alter table public.picklester_activity_feed
  drop constraint if exists picklester_activity_feed_event_type_check;
alter table public.picklester_activity_feed
  add constraint picklester_activity_feed_event_type_check
  check (event_type in ('verified','match_win','mvp','top10','badge','frame','joined'));

create or replace function public.feed_picklester_badge_unlock()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare badge_name text;
begin
  select name into badge_name
  from public.badge_catalog
  where id=new.badge_id;

  insert into public.picklester_activity_feed(event_type,actor_id,message)
  values (
    'badge',
    new.user_id,
    'unlocked the '||coalesce(badge_name,'new')||' avatar frame.'
  );
  return new;
end;
$$;

drop trigger if exists feed_picklester_badge_unlock_after_insert
  on public.player_badges;
create trigger feed_picklester_badge_unlock_after_insert
after insert on public.player_badges
for each row execute procedure public.feed_picklester_badge_unlock();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='picklester_activity_feed'
  ) then
    alter publication supabase_realtime
      add table public.picklester_activity_feed;
  end if;
end;
$$;

notify pgrst,'reload schema';

select
  to_regprocedure('public.feed_picklester_badge_unlock()') as badge_feed_trigger,
  exists (
    select 1
    from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='picklester_activity_feed'
  ) as realtime_enabled;
