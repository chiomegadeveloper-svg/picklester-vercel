-- Reliable Admin/Owner Control Center access.
create or replace function public.list_picklester_control_center()
returns setof public.profiles
language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role in ('owner','admin')) then
    raise exception 'Admin or owner access is required';
  end if;
  return query select p.* from public.profiles p order by p.created_at desc;
end; $$;
revoke all on function public.list_picklester_control_center() from public;
grant execute on function public.list_picklester_control_center() to authenticated;

-- Repair the four-feature-photo table and public storage bucket.
create table if not exists public.profile_photos(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  slot smallint not null check(slot between 1 and 4), photo_url text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,slot)
);
alter table public.profile_photos enable row level security;
drop policy if exists "Visible profile photos" on public.profile_photos;
create policy "Visible profile photos" on public.profile_photos for select to authenticated using(true);
drop policy if exists "Players add profile photos" on public.profile_photos;
create policy "Players add profile photos" on public.profile_photos for insert to authenticated with check(user_id=auth.uid());
drop policy if exists "Players update profile photos" on public.profile_photos;
create policy "Players update profile photos" on public.profile_photos for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists "Players delete profile photos" on public.profile_photos;
create policy "Players delete profile photos" on public.profile_photos for delete to authenticated using(user_id=auth.uid());
grant select,insert,update,delete on public.profile_photos to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-media','profile-media',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=true,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
drop policy if exists "Profile media is publicly readable" on storage.objects;
create policy "Profile media is publicly readable" on storage.objects for select using(bucket_id='profile-media');
drop policy if exists "Players upload their profile media" on storage.objects;
create policy "Players upload their profile media" on storage.objects for insert to authenticated with check(bucket_id='profile-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Players replace their profile media" on storage.objects;
create policy "Players replace their profile media" on storage.objects for update to authenticated using(bucket_id='profile-media' and (storage.foldername(name))[1]=auth.uid()::text) with check(bucket_id='profile-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Players delete their profile media" on storage.objects;
create policy "Players delete their profile media" on storage.objects for delete to authenticated using(bucket_id='profile-media' and (storage.foldername(name))[1]=auth.uid()::text);
notify pgrst,'reload schema';
