-- Picklester V31: WebP photo posts with short captions in Recent and Popular.
-- Run after V30.

alter table public.player_posts add column if not exists photo_url text;
alter table public.picklester_activity_feed add column if not exists photo_url text;

alter table public.picklester_activity_feed
  drop constraint if exists picklester_activity_feed_event_type_check;
alter table public.picklester_activity_feed
  add constraint picklester_activity_feed_event_type_check
  check (event_type in ('verified','match_win','mvp','top10','badge','frame','joined','photo'));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('feed-media','feed-media',true,2097152,array['image/webp'])
on conflict(id) do update set public=true,file_size_limit=2097152,allowed_mime_types=array['image/webp'];

drop policy if exists "Public feed photos" on storage.objects;
create policy "Public feed photos" on storage.objects for select to authenticated
using(bucket_id='feed-media');
drop policy if exists "Players upload feed photos" on storage.objects;
create policy "Players upload feed photos" on storage.objects for insert to authenticated
with check(bucket_id='feed-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Players delete own feed photos" on storage.objects;
create policy "Players delete own feed photos" on storage.objects for delete to authenticated
using(bucket_id='feed-media' and (storage.foldername(name))[1]=auth.uid()::text);

create or replace function public.feed_picklester_photo_post()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.photo_url is not null then
    insert into public.picklester_activity_feed(event_type,actor_id,message,photo_url)
    values('photo',new.author_id,new.body,new.photo_url);
  end if;
  return new;
end; $$;
drop trigger if exists feed_picklester_photo_post_after_insert on public.player_posts;
create trigger feed_picklester_photo_post_after_insert after insert on public.player_posts
for each row execute procedure public.feed_picklester_photo_post();

drop function if exists public.list_picklester_activity_feed(integer);
create function public.list_picklester_activity_feed(result_limit integer default 100)
returns table(id uuid,event_type text,actor_id uuid,actor_name text,actor_username text,actor_avatar_url text,message text,created_at timestamptz,reaction_count bigint,reacted_by_me boolean,comment_count bigint,feed_background_code text,photo_url text)
language sql stable security definer set search_path='' as $$
  select f.id,f.event_type,f.actor_id,p.name,p.username,p.avatar_url,f.message,f.created_at,
    (select count(*) from public.picklester_activity_reactions r where r.activity_id=f.id),
    exists(select 1 from public.picklester_activity_reactions r where r.activity_id=f.id and r.user_id=auth.uid()),
    (select count(*) from public.picklester_activity_comments c where c.activity_id=f.id),
    p.selected_feed_background,f.photo_url
  from public.picklester_activity_feed f join public.profiles p on p.id=f.actor_id
  where f.created_at>=now()-interval '36 hours'
    and exists(select 1 from public.profiles me where me.id=auth.uid() and (me.verified or me.role in ('owner','admin')))
  order by f.created_at desc limit least(greatest(result_limit,1),100);
$$;
grant execute on function public.list_picklester_activity_feed(integer) to authenticated;

drop function if exists public.list_picklester_posts(text,integer);
create function public.list_picklester_posts(sort_mode text default 'recent',result_limit integer default 30)
returns table(id uuid,author_id uuid,body text,photo_url text,created_at timestamptz,like_count bigint,liked_by_me boolean,comment_count bigint,author_name text,author_username text,author_avatar_url text,author_verified boolean,feed_background_code text)
language sql stable security definer set search_path='' as $$
 select post.id,post.author_id,post.body,post.photo_url,post.created_at,
 (select count(*) from public.post_likes l where l.post_id=post.id),
 exists(select 1 from public.post_likes l where l.post_id=post.id and l.user_id=auth.uid()),
 (select count(*) from public.post_comments c where c.post_id=post.id),
 author.name,author.username,author.avatar_url,author.verified,author.selected_feed_background
 from public.player_posts post join public.profiles author on author.id=post.author_id
 where author.verified or author.role in ('owner','admin')
 order by case when lower(sort_mode)='popular' then ((select count(*) from public.post_likes l where l.post_id=post.id)+(select count(*) from public.post_comments c where c.post_id=post.id)) else 0 end desc,post.created_at desc
 limit case when lower(sort_mode)='popular' then least(greatest(result_limit,1),10) else least(greatest(result_limit,1),50) end;
$$;
grant execute on function public.list_picklester_posts(text,integer) to authenticated;

notify pgrst,'reload schema';
