-- Picklester V29: Maya Checkout orders, paid Game Pass activation, and extra game credits.
alter table public.profiles add column if not exists gamepass_expires_at timestamptz;
alter table public.profiles add column if not exists gamepass_forever boolean not null default false;
alter table public.profiles add column if not exists extra_game_credits integer not null default 0 check (extra_game_credits >= 0);

create table if not exists public.picklester_maya_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_code text not null check (product_code in ('extra_5_games','pass_5_days','pass_1_week','pass_1_month','pass_forever')),
  pass_days integer check (pass_days is null or pass_days in (0,5,7,30)),
  extra_games integer not null default 0 check (extra_games >= 0),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'PHP',
  request_reference_number text not null unique,
  maya_checkout_id text,
  maya_payment_id text,
  status text not null default 'created',
  maya_response jsonb,
  webhook_payload jsonb,
  fulfilled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.picklester_maya_orders enable row level security;

drop policy if exists "Players can view own Maya orders" on public.picklester_maya_orders;
create policy "Players can view own Maya orders"
on public.picklester_maya_orders for select
to authenticated
using (auth.uid() = user_id or public.is_picklester_owner());

create or replace function public.fulfill_picklester_maya_order(
  order_id uuid,
  maya_payment_id_input text default null,
  webhook_payload_input jsonb default null,
  maya_response_input jsonb default null
)
returns void language plpgsql security definer set search_path='' as $$
declare order_row public.picklester_maya_orders%rowtype;
declare expiry timestamptz;
declare label text;
begin
  select * into order_row from public.picklester_maya_orders where id=order_id for update;
  if not found then raise exception 'Maya order was not found'; end if;
  if order_row.status='paid' then return; end if;

  if order_row.extra_games > 0 then
    update public.profiles
    set extra_game_credits=extra_game_credits+order_row.extra_games,updated_at=now()
    where id=order_row.user_id;
    label := order_row.extra_games::text || ' extra games';
  elsif order_row.pass_days = 0 then
    update public.profiles
    set gamepass_forever=true,gamepass_expires_at=null,updated_at=now()
    where id=order_row.user_id;
    label := 'Forever';
  elsif order_row.pass_days in (5,7,30) then
    expiry := now()+make_interval(days=>order_row.pass_days);
    update public.profiles
    set gamepass_forever=false,gamepass_expires_at=expiry,updated_at=now()
    where id=order_row.user_id;
    label := case order_row.pass_days when 5 then '5 days' when 7 then '1 week' when 30 then '1 month' end;
  else
    raise exception 'Invalid Maya order product';
  end if;

  insert into public.picklester_gamepass_purchases(user_id,pass_type,amount,payment_reference,recorded_by)
  values(order_row.user_id,label,order_row.amount,order_row.request_reference_number,order_row.user_id);

  update public.picklester_maya_orders
  set status='paid',
      maya_payment_id=coalesce(nullif(trim(maya_payment_id_input),''),maya_payment_id),
      webhook_payload=coalesce(webhook_payload_input,webhook_payload),
      maya_response=coalesce(maya_response_input,maya_response),
      fulfilled_at=now(),
      updated_at=now()
  where id=order_row.id;
end; $$;

revoke all on function public.fulfill_picklester_maya_order(uuid,text,jsonb,jsonb) from public;
grant execute on function public.fulfill_picklester_maya_order(uuid,text,jsonb,jsonb) to service_role;

create or replace function public.enforce_picklester_daily_game_limit()
returns trigger language plpgsql security definer set search_path='' as $$
declare played integer; member_role text; pass_until timestamptz; forever_pass boolean; credits integer;
begin
  select role,gamepass_expires_at,gamepass_forever,extra_game_credits
  into member_role,pass_until,forever_pass,credits
  from public.profiles where id=new.user_id;

  if member_role in ('owner','admin') or forever_pass or pass_until>now() then return new; end if;

  if pass_until is not null and pass_until<=now() then
    update public.profiles set gamepass_expires_at=null,updated_at=now() where id=new.user_id;
  end if;

  select count(*) into played
  from public.picklester_game_participants participant join public.picklester_games game on game.id=participant.game_id
  where participant.user_id=new.user_id and game.status='completed' and game.ended_at>=date_trunc('day',now());

  if played>=5 then
    if credits > 0 then
      update public.profiles
      set extra_game_credits=extra_game_credits-1,updated_at=now()
      where id=new.user_id and extra_game_credits>0;
      return new;
    end if;
    raise exception 'Daily limit reached. You have reached the maximum number of game matches for today. Purchase an additional Game Pass or wait until tomorrow to receive another 5 free games.';
  end if;

  return new;
end; $$;

drop trigger if exists enforce_picklester_daily_game_limit_before_join on public.picklester_game_participants;
create trigger enforce_picklester_daily_game_limit_before_join before insert on public.picklester_game_participants for each row execute procedure public.enforce_picklester_daily_game_limit();

notify pgrst,'reload schema';
