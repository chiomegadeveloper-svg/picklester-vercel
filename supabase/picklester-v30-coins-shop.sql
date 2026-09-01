-- Picklester V30: coin wallet, daily/match rewards, Maya coin products, and
-- purchase rewards. Run this once in the Supabase SQL Editor after V29.

alter table public.profiles
  add column if not exists coin_points integer not null default 10
  check (coin_points >= 0),
  add column if not exists last_online_coin_claim date;

alter table public.profiles
  add column if not exists selected_feed_background text;

alter table public.picklester_maya_orders
  add column if not exists coin_reward integer not null default 0
  check (coin_reward >= 0);
alter table public.picklester_maya_orders
  add column if not exists background_code text;

-- V29 allowed only Game Pass product codes. V30 also allows Coin packages.
alter table public.picklester_maya_orders
  drop constraint if exists picklester_maya_orders_product_code_check;
alter table public.picklester_maya_orders
  add constraint picklester_maya_orders_product_code_check check (
    product_code in (
      'extra_5_games','pass_5_days','pass_1_week','pass_1_month','pass_forever',
      'coins_30','coins_50','coins_100','coins_500',
      'bg_midnight','bg_teal','bg_forest','bg_maroon','bg_royal','bg_ocean',
      'bg_amber','bg_rose','bg_slate','bg_indigo','bg_emerald','bg_sunset',
      'bg_neon_cyan','bg_neon_lime','bg_laser_blue','bg_hot_magenta','bg_plasma','bg_solar_orange'
    )
  );

create table if not exists public.picklester_coin_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null check (amount <> 0),
  source text not null check (source in ('welcome','daily_online','match_win','match_loss','maya_purchase','background_purchase','adjustment')),
  source_reference text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, source, source_reference)
);

alter table public.picklester_coin_ledger enable row level security;
drop policy if exists "Players can view own Coin ledger" on public.picklester_coin_ledger;
create policy "Players can view own Coin ledger"
on public.picklester_coin_ledger for select to authenticated
using (user_id = auth.uid() or public.is_picklester_owner());
grant select on public.picklester_coin_ledger to authenticated;

create table if not exists public.picklester_feed_backgrounds (
  user_id uuid not null references public.profiles(id) on delete cascade,
  background_code text not null,
  payment_method text not null check (payment_method in ('maya','coins','admin')),
  purchased_at timestamptz not null default now(),
  primary key(user_id,background_code)
);
alter table public.picklester_feed_backgrounds enable row level security;
drop policy if exists "Players view owned feed backgrounds" on public.picklester_feed_backgrounds;
create policy "Players view owned feed backgrounds" on public.picklester_feed_backgrounds
for select to authenticated using(user_id=auth.uid() or public.is_picklester_owner());
grant select on public.picklester_feed_backgrounds to authenticated;

create or replace function public.buy_picklester_background_with_coins(product_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare player_id uuid:=auth.uid();
declare price integer;
declare balance integer;
begin
  price:=case product_code
    when 'bg_midnight' then 30 when 'bg_teal' then 45 when 'bg_forest' then 65 when 'bg_maroon' then 90
    when 'bg_royal' then 120 when 'bg_ocean' then 150 when 'bg_amber' then 180 when 'bg_rose' then 215
    when 'bg_slate' then 250 when 'bg_indigo' then 295 when 'bg_emerald' then 340 when 'bg_sunset' then 388
    when 'bg_neon_cyan' then 380 when 'bg_neon_lime' then 500 when 'bg_laser_blue' then 620
    when 'bg_hot_magenta' then 740 when 'bg_plasma' then 860 when 'bg_solar_orange' then 988
    else null end;
  if player_id is null then raise exception 'Sign in is required'; end if;
  if price is null then raise exception 'Invalid background product'; end if;
  if exists(select 1 from public.picklester_feed_backgrounds where user_id=player_id and background_code=product_code) then
    update public.profiles set selected_feed_background=product_code,updated_at=now() where id=player_id;
    select coin_points into balance from public.profiles where id=player_id;
    return jsonb_build_object('purchased',false,'selected',true,'balance',balance);
  end if;
  update public.profiles set coin_points=coin_points-price,selected_feed_background=product_code,updated_at=now()
  where id=player_id and coin_points>=price returning coin_points into balance;
  if not found then raise exception 'Not enough Picklester Coins'; end if;
  insert into public.picklester_feed_backgrounds(user_id,background_code,payment_method)
  values(player_id,product_code,'coins');
  insert into public.picklester_coin_ledger(user_id,amount,source,source_reference,description)
  values(player_id,-price,'background_purchase',product_code,'Recent feed background purchase');
  return jsonb_build_object('purchased',true,'selected',true,'balance',balance);
end; $$;
revoke all on function public.buy_picklester_background_with_coins(text) from public;
grant execute on function public.buy_picklester_background_with_coins(text) to authenticated;

create or replace function public.update_picklester_profile_with_coins(
  new_name text,
  new_username text,
  new_avatar_url text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_profile public.profiles%rowtype;
declare total_cost integer:=0;
declare is_first_setup boolean;
begin
  select * into current_profile from public.profiles where id=auth.uid() for update;
  if not found then raise exception 'Profile was not found'; end if;
  if nullif(trim(new_name),'') is null or nullif(trim(new_username),'') is null then
    raise exception 'Name and username are required';
  end if;
  is_first_setup:=nullif(trim(current_profile.name),'') is null
    or current_profile.username is null or current_profile.avatar_url is null;
  if not is_first_setup and current_profile.role='player' then
    if trim(new_name) is distinct from current_profile.name then total_cost:=total_cost+150; end if;
    if lower(trim(new_username)) is distinct from lower(current_profile.username) then total_cost:=total_cost+280; end if;
    if new_avatar_url is distinct from current_profile.avatar_url then total_cost:=total_cost+100; end if;
  end if;
  if current_profile.coin_points<total_cost then
    raise exception 'Not enough Picklester Coins. This profile change costs % Coins.',total_cost;
  end if;
  update public.profiles set
    name=trim(new_name),username=lower(trim(new_username)),avatar_url=new_avatar_url,
    coin_points=coin_points-total_cost,updated_at=now()
  where id=auth.uid();
  if total_cost>0 then
    insert into public.picklester_coin_ledger(user_id,amount,source,source_reference,description)
    values(auth.uid(),-total_cost,'adjustment',gen_random_uuid()::text,'Profile change service');
  end if;
  return jsonb_build_object('saved',true,'cost',total_cost,'balance',current_profile.coin_points-total_cost);
end; $$;
revoke all on function public.update_picklester_profile_with_coins(text,text,text) from public;
grant execute on function public.update_picklester_profile_with_coins(text,text,text) to authenticated;

-- Record the initial 10 Coins without adding them again to the profile balance.
insert into public.picklester_coin_ledger(user_id,amount,source,source_reference,description)
select id,10,'welcome','account','New-player welcome Coins'
from public.profiles
on conflict (user_id,source,source_reference) do nothing;

create or replace function public.claim_picklester_daily_coins()
returns jsonb language plpgsql security definer set search_path='' as $$
declare player_id uuid := auth.uid();
declare inserted_id uuid;
declare balance integer;
begin
  if player_id is null then raise exception 'Sign in is required'; end if;

  insert into public.picklester_coin_ledger(user_id,amount,source,source_reference,description)
  values(player_id,2,'daily_online',current_date::text,'Daily online reward')
  on conflict (user_id,source,source_reference) do nothing
  returning id into inserted_id;

  if inserted_id is not null then
    update public.profiles
    set coin_points=coin_points+2,last_online_coin_claim=current_date,updated_at=now()
    where id=player_id
    returning coin_points into balance;
    return jsonb_build_object('claimed',true,'amount',2,'balance',balance);
  end if;

  select coin_points into balance from public.profiles where id=player_id;
  return jsonb_build_object('claimed',false,'amount',0,'balance',coalesce(balance,10));
end; $$;

revoke all on function public.claim_picklester_daily_coins() from public;
grant execute on function public.claim_picklester_daily_coins() to authenticated;

-- Award +2 Coins to winners and +1 Coin to losing players exactly once per game.
create or replace function public.reward_picklester_completed_game_coins()
returns trigger language plpgsql security definer set search_path='' as $$
declare member record;
declare reward integer;
declare inserted_id uuid;
begin
  if new.status <> 'completed' or old.status = 'completed' then return new; end if;

  for member in
    select user_id,was_winner
    from public.picklester_game_participants
    where game_id=new.id and role='player'
  loop
    reward := case when member.was_winner then 2 else 1 end;
    inserted_id := null;
    insert into public.picklester_coin_ledger(user_id,amount,source,source_reference,description)
    values(
      member.user_id,
      reward,
      case when member.was_winner then 'match_win' else 'match_loss' end,
      new.id::text,
      case when member.was_winner then 'Official match win' else 'Official match participation' end
    )
    on conflict (user_id,source,source_reference) do nothing
    returning id into inserted_id;

    if inserted_id is not null then
      update public.profiles
      set coin_points=coin_points+reward,updated_at=now()
      where id=member.user_id;
    end if;
  end loop;
  return new;
end; $$;

drop trigger if exists reward_picklester_completed_game_coins on public.picklester_games;
create trigger reward_picklester_completed_game_coins
after update of status on public.picklester_games
for each row execute procedure public.reward_picklester_completed_game_coins();

create or replace function public.fulfill_picklester_maya_order(
  order_id uuid,
  maya_payment_id_input text default null,
  webhook_payload_input jsonb default null,
  maya_response_input jsonb default null
)
returns void language plpgsql security definer set search_path='' as $$
declare order_row public.picklester_maya_orders%rowtype;
declare label text;
begin
  select * into order_row from public.picklester_maya_orders where id=order_id for update;
  if not found then raise exception 'Maya order was not found'; end if;
  if order_row.status='paid' then return; end if;

  if order_row.product_code like 'bg_%' then
    insert into public.picklester_feed_backgrounds(user_id,background_code,payment_method)
    values(order_row.user_id,order_row.product_code,'maya')
    on conflict(user_id,background_code) do nothing;
    update public.profiles set selected_feed_background=order_row.product_code,updated_at=now()
    where id=order_row.user_id;
    label := 'Feed background: '||order_row.product_code;
  elsif order_row.product_code like 'coins_%' then
    label := order_row.coin_reward::text || ' Coins';
  elsif order_row.extra_games > 0 then
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
    update public.profiles
    set gamepass_expires_at=case
          when gamepass_forever then null
          else greatest(coalesce(gamepass_expires_at,now()),now())+make_interval(days=>order_row.pass_days)
        end,
        updated_at=now()
    where id=order_row.user_id;
    label := case order_row.pass_days when 5 then '5 days' when 7 then '1 week' when 30 then '1 month' end;
  else
    raise exception 'Invalid Maya order product';
  end if;

  if order_row.coin_reward > 0 then
    insert into public.picklester_coin_ledger(user_id,amount,source,source_reference,description)
    values(order_row.user_id,order_row.coin_reward,'maya_purchase',order_row.id::text,label||' purchase reward')
    on conflict (user_id,source,source_reference) do nothing;

    if found then
      update public.profiles
      set coin_points=coin_points+order_row.coin_reward,updated_at=now()
      where id=order_row.user_id;
    end if;
  end if;

  insert into public.picklester_gamepass_purchases(user_id,pass_type,amount,payment_reference,recorded_by)
  values(order_row.user_id,label,order_row.amount,order_row.request_reference_number,order_row.user_id);

  update public.picklester_maya_orders
  set status='paid',
      maya_payment_id=coalesce(nullif(trim(maya_payment_id_input),''),maya_payment_id),
      webhook_payload=coalesce(webhook_payload_input,webhook_payload),
      maya_response=coalesce(maya_response_input,maya_response),
      fulfilled_at=now(),updated_at=now()
  where id=order_row.id;
end; $$;

revoke all on function public.fulfill_picklester_maya_order(uuid,text,jsonb,jsonb) from public;
grant execute on function public.fulfill_picklester_maya_order(uuid,text,jsonb,jsonb) to service_role;

drop function if exists public.list_picklester_activity_feed(integer);
create function public.list_picklester_activity_feed(result_limit integer default 100)
returns table(id uuid,event_type text,actor_id uuid,actor_name text,actor_username text,actor_avatar_url text,message text,created_at timestamptz,reaction_count bigint,reacted_by_me boolean,comment_count bigint,feed_background_code text)
language sql stable security definer set search_path='' as $$
  select f.id,f.event_type,f.actor_id,p.name,p.username,p.avatar_url,f.message,f.created_at,
    (select count(*) from public.picklester_activity_reactions r where r.activity_id=f.id),
    exists(select 1 from public.picklester_activity_reactions r where r.activity_id=f.id and r.user_id=auth.uid()),
    (select count(*) from public.picklester_activity_comments c where c.activity_id=f.id),
    p.selected_feed_background
  from public.picklester_activity_feed f join public.profiles p on p.id=f.actor_id
  where f.created_at>=now()-interval '36 hours'
    and exists(select 1 from public.profiles me where me.id=auth.uid() and (me.verified or me.role in ('owner','admin')))
  order by f.created_at desc limit least(greatest(result_limit,1),100);
$$;
revoke all on function public.list_picklester_activity_feed(integer) from public;
grant execute on function public.list_picklester_activity_feed(integer) to authenticated;

drop function if exists public.list_picklester_posts(text,integer);
create function public.list_picklester_posts(sort_mode text default 'recent',result_limit integer default 30)
returns table(id uuid,author_id uuid,body text,created_at timestamptz,like_count bigint,liked_by_me boolean,comment_count bigint,author_name text,author_username text,author_avatar_url text,author_verified boolean,feed_background_code text)
language sql stable security definer set search_path='' as $$
 select post.id,post.author_id,post.body,post.created_at,
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
