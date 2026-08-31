-- Picklester V21: Forever Game Pass, purchase logs, expiry cleanup, and 5 free games daily.
alter table public.profiles add column if not exists gamepass_expires_at timestamptz;
alter table public.profiles add column if not exists gamepass_forever boolean not null default false;

create table if not exists public.picklester_gamepass_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  pass_type text not null check (pass_type in ('5 days','1 week','1 month','Forever')),
  amount numeric(12,2),
  payment_reference text,
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.picklester_gamepass_purchases enable row level security;

create or replace function public.activate_picklester_gamepass(target_user uuid,pass_days integer)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare expiry timestamptz;
begin
  if not public.is_picklester_owner() then raise exception 'Only the owner can activate Game Pass'; end if;
  if pass_days not in (0,5,7,30) then raise exception 'Choose 5 days, 1 week, 1 month, or Forever'; end if;
  if pass_days=0 then
    update public.profiles set gamepass_forever=true,gamepass_expires_at=null,updated_at=now() where id=target_user;
    return null;
  end if;
  expiry := now()+make_interval(days=>pass_days);
  update public.profiles set gamepass_forever=false,gamepass_expires_at=expiry,updated_at=now() where id=target_user;
  return expiry;
end; $$;

create or replace function public.record_picklester_gamepass_purchase(target_user uuid,pass_days integer,paid_amount numeric default null,payment_ref text default null)
returns void language plpgsql security definer set search_path='' as $$
declare label text;
begin
  if not public.is_picklester_owner() then raise exception 'Only the owner can record Game Pass purchases'; end if;
  label := case pass_days when 5 then '5 days' when 7 then '1 week' when 30 then '1 month' when 0 then 'Forever' else null end;
  if label is null then raise exception 'Choose a valid Game Pass'; end if;
  perform public.activate_picklester_gamepass(target_user,pass_days);
  insert into public.picklester_gamepass_purchases(user_id,pass_type,amount,payment_reference,recorded_by)
  values(target_user,label,paid_amount,nullif(trim(payment_ref),''),auth.uid());
end; $$;

create or replace function public.list_picklester_gamepass_purchases()
returns table(id uuid,user_id uuid,pass_type text,amount numeric,payment_reference text,created_at timestamptz,user_name text,user_username text)
language sql stable security definer set search_path='' as $$
  select purchase.id,purchase.user_id,purchase.pass_type,purchase.amount,purchase.payment_reference,purchase.created_at,profile.name,profile.username
  from public.picklester_gamepass_purchases purchase join public.profiles profile on profile.id=purchase.user_id
  where public.is_picklester_owner() order by purchase.created_at desc limit 100;
$$;

create or replace function public.enforce_picklester_daily_game_limit()
returns trigger language plpgsql security definer set search_path='' as $$
declare played integer; member_role text; pass_until timestamptz; forever_pass boolean;
begin
  select role,gamepass_expires_at,gamepass_forever into member_role,pass_until,forever_pass from public.profiles where id=new.user_id;
  if member_role in ('owner','admin') or forever_pass or pass_until>now() then return new; end if;
  if pass_until is not null and pass_until<=now() then
    update public.profiles set gamepass_expires_at=null,updated_at=now() where id=new.user_id;
  end if;
  select count(*) into played
  from public.picklester_game_participants participant join public.picklester_games game on game.id=participant.game_id
  where participant.user_id=new.user_id and game.status='completed' and game.ended_at>=date_trunc('day',now());
  if played>=5 then raise exception 'Daily limit reached. You have reached the maximum number of game matches for today. Purchase an additional Game Pass or wait until tomorrow to receive another 5 free games.'; end if;
  return new;
end; $$;

drop trigger if exists enforce_picklester_daily_game_limit_before_join on public.picklester_game_participants;
create trigger enforce_picklester_daily_game_limit_before_join before insert on public.picklester_game_participants for each row execute procedure public.enforce_picklester_daily_game_limit();

grant execute on function public.activate_picklester_gamepass(uuid,integer) to authenticated;
grant execute on function public.record_picklester_gamepass_purchase(uuid,integer,numeric,text) to authenticated;
grant execute on function public.list_picklester_gamepass_purchases() to authenticated;
notify pgrst,'reload schema';
