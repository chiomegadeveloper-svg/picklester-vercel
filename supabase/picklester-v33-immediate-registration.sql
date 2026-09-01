-- Picklester v33: activate every registration immediately.
-- Run in the Supabase SQL Editor after the earlier Picklester migrations.

alter table public.profiles alter column verified set default true;

update public.profiles
set verified = true, updated_at = now()
where verified = false;

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
    true
  )
  on conflict (id) do update
  set verified = true,
      updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_picklester on auth.users;
create trigger on_auth_user_created_picklester
  after insert on auth.users
  for each row execute procedure public.handle_new_picklester_user();
