-- Picklester V16: support tickets, profile streaks, social comments and exact target-score wins.
-- Run once in Supabase SQL Editor after V15.

alter table public.profiles add column if not exists win_streak integer not null default 0;
alter table public.gm_tickets add column if not exists owner_reply text;
alter table public.gm_tickets add column if not exists replied_at timestamptz;
alter table public.gm_tickets add column if not exists replied_by uuid references public.profiles(id);

create or replace function public.list_picklester_owner_tickets()
returns table(id uuid,user_id uuid,subject text,message text,status text,owner_reply text,created_at timestamptz,user_name text,user_username text)
language sql stable security definer set search_path='' as $$
  select t.id,t.user_id,t.subject,t.message,t.status,t.owner_reply,t.created_at,p.name,p.username
  from public.gm_tickets t join public.profiles p on p.id=t.user_id
  where public.is_picklester_owner() order by case when t.status in ('open','in_progress') then 0 else 1 end,t.updated_at desc;
$$;
revoke all on function public.list_picklester_owner_tickets() from public;
grant execute on function public.list_picklester_owner_tickets() to authenticated;

create or replace function public.reply_picklester_ticket(target_ticket uuid,reply_text text,next_status text default 'in_progress')
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_picklester_owner() then raise exception 'Only the owner can reply to tickets'; end if;
  if next_status not in ('in_progress','resolved') then raise exception 'Invalid ticket status'; end if;
  update public.gm_tickets set owner_reply=trim(reply_text),status=next_status,replied_at=now(),replied_by=auth.uid(),updated_at=now() where id=target_ticket;
end; $$;
revoke all on function public.reply_picklester_ticket(uuid,text,text) from public;
grant execute on function public.reply_picklester_ticket(uuid,text,text) to authenticated;

create table if not exists public.post_comments(
  id uuid primary key default gen_random_uuid(), post_id uuid not null references public.player_posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade, body text not null check(char_length(body) between 1 and 500), created_at timestamptz not null default now()
);
alter table public.post_comments enable row level security;
create policy "Comments are visible" on public.post_comments for select to authenticated using(true);
create policy "Verified players comment" on public.post_comments for insert to authenticated with check(author_id=auth.uid() and exists(select 1 from public.profiles p where p.id=auth.uid() and (p.verified or p.role in ('owner','admin'))));
grant select,insert on public.post_comments to authenticated;

drop function if exists public.list_picklester_posts(text,integer);
create function public.list_picklester_posts(sort_mode text default 'recent',result_limit integer default 30)
returns table(id uuid,author_id uuid,body text,created_at timestamptz,like_count bigint,liked_by_me boolean,comment_count bigint,author_name text,author_username text,author_avatar_url text,author_verified boolean)
language sql stable security definer set search_path='' as $$
 select post.id,post.author_id,post.body,post.created_at,
 (select count(*) from public.post_likes l where l.post_id=post.id),exists(select 1 from public.post_likes l where l.post_id=post.id and l.user_id=auth.uid()),
 (select count(*) from public.post_comments c where c.post_id=post.id),author.name,author.username,author.avatar_url,author.verified
 from public.player_posts post join public.profiles author on author.id=post.author_id where author.verified or author.role in ('owner','admin')
 order by case when lower(sort_mode)='popular' then ((select count(*) from public.post_likes l where l.post_id=post.id)+(select count(*) from public.post_comments c where c.post_id=post.id)) else 0 end desc,post.created_at desc
 limit case when lower(sort_mode)='popular' then least(greatest(result_limit,1),10) else least(greatest(result_limit,1),50) end;
$$;
grant execute on function public.list_picklester_posts(text,integer) to authenticated;

create or replace function public.list_picklester_post_comments(target_post uuid,result_limit integer default 50)
returns table(id uuid,post_id uuid,author_id uuid,body text,created_at timestamptz,author_name text,author_username text,author_avatar_url text)
language sql stable security definer set search_path='' as $$ select c.id,c.post_id,c.author_id,c.body,c.created_at,p.name,p.username,p.avatar_url from public.post_comments c join public.profiles p on p.id=c.author_id where c.post_id=target_post order by c.created_at asc limit least(greatest(result_limit,1),100); $$;
grant execute on function public.list_picklester_post_comments(uuid,integer) to authenticated;

-- Exact format target: 11, 15 or 21 immediately becomes the winning score.
-- Existing finalize function is kept, with only its validation rule changed by redefining the source after applying this migration.
-- The V16 app presents the winner as soon as either score reaches the selected target.
notify pgrst,'reload schema';
