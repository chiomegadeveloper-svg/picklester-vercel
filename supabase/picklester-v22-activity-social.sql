-- Picklester V22: reactions and retractable comments for automatic Recent activity logs.
create table if not exists public.picklester_activity_reactions (
  activity_id uuid not null references public.picklester_activity_feed(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(activity_id,user_id)
);
create table if not exists public.picklester_activity_comments (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.picklester_activity_feed(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check(length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
alter table public.picklester_activity_reactions enable row level security;
alter table public.picklester_activity_comments enable row level security;

create or replace function public.list_picklester_activity_feed(result_limit integer default 100)
returns table(id uuid,event_type text,actor_id uuid,actor_name text,actor_username text,actor_avatar_url text,message text,created_at timestamptz,reaction_count bigint,reacted_by_me boolean,comment_count bigint)
language sql stable security definer set search_path='' as $$
  select f.id,f.event_type,f.actor_id,p.name,p.username,p.avatar_url,f.message,f.created_at,
    (select count(*) from public.picklester_activity_reactions r where r.activity_id=f.id),
    exists(select 1 from public.picklester_activity_reactions r where r.activity_id=f.id and r.user_id=auth.uid()),
    (select count(*) from public.picklester_activity_comments c where c.activity_id=f.id)
  from public.picklester_activity_feed f join public.profiles p on p.id=f.actor_id
  where f.created_at>=now()-interval '36 hours'
    and exists(select 1 from public.profiles me where me.id=auth.uid() and (me.verified or me.role in ('owner','admin')))
  order by f.created_at desc limit least(greatest(result_limit,1),100);
$$;

create or replace function public.toggle_picklester_activity_reaction(target_activity uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.picklester_activity_reactions where activity_id=target_activity and user_id=auth.uid()) then
    delete from public.picklester_activity_reactions where activity_id=target_activity and user_id=auth.uid(); return false;
  end if;
  insert into public.picklester_activity_reactions(activity_id,user_id) values(target_activity,auth.uid()); return true;
end; $$;

create or replace function public.list_picklester_activity_comments(target_activity uuid,result_limit integer default 50)
returns table(id uuid,activity_id uuid,author_id uuid,body text,created_at timestamptz,author_name text,author_username text,author_avatar_url text)
language sql stable security definer set search_path='' as $$
  select c.id,c.activity_id,c.author_id,c.body,c.created_at,p.name,p.username,p.avatar_url
  from public.picklester_activity_comments c join public.profiles p on p.id=c.author_id
  where c.activity_id=target_activity order by c.created_at asc limit least(greatest(result_limit,1),100);
$$;

create or replace function public.comment_picklester_activity(target_activity uuid,comment_body text)
returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and (verified or role in ('owner','admin'))) then raise exception 'Verification is required to comment'; end if;
  insert into public.picklester_activity_comments(activity_id,author_id,body) values(target_activity,auth.uid(),trim(comment_body)) returning id into new_id;
  return new_id;
end; $$;

revoke all on function public.list_picklester_activity_feed(integer) from public;
grant execute on function public.list_picklester_activity_feed(integer) to authenticated;
grant execute on function public.toggle_picklester_activity_reaction(uuid) to authenticated;
grant execute on function public.list_picklester_activity_comments(uuid,integer) to authenticated;
grant execute on function public.comment_picklester_activity(uuid,text) to authenticated;
notify pgrst,'reload schema';
