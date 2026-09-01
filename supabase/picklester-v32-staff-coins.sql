-- Picklester V32: separate Admin and Game Master roles, owner-only Coin grants,
-- and staff ticket support. Run once in Supabase SQL Editor after V31.

alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('player', 'gm', 'admin', 'owner'));

-- Admins can verify members. Game Masters are support/game-operations staff.
create or replace function public.is_picklester_support()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('owner', 'admin', 'gm')
  );
$$;
revoke all on function public.is_picklester_support() from public;
grant execute on function public.is_picklester_support() to authenticated;

create or replace function public.list_picklester_control_center()
returns setof public.profiles
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_picklester_support() then
    raise exception 'Picklester staff access is required';
  end if;
  return query select profile.* from public.profiles profile order by profile.created_at desc;
end;
$$;
revoke all on function public.list_picklester_control_center() from public;
grant execute on function public.list_picklester_control_center() to authenticated;

create or replace function public.set_picklester_role(target_user uuid, new_role text)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_picklester_owner() then
    raise exception 'Only the Picklester owner can manage staff roles';
  end if;
  if new_role not in ('player', 'gm', 'admin') then
    raise exception 'Choose Player, Game Master, or Admin';
  end if;
  if not exists(select 1 from public.profiles where id = target_user and role <> 'owner') then
    raise exception 'This member role cannot be changed';
  end if;

  update public.profiles
  set role = new_role,
      verified = case when new_role in ('gm', 'admin') then true else verified end,
      updated_at = now()
  where id = target_user and role <> 'owner';
end;
$$;
revoke all on function public.set_picklester_role(uuid, text) from public;
grant execute on function public.set_picklester_role(uuid, text) to authenticated;

-- Preserve the existing ledger sources and add an explicit, auditable owner grant.
alter table public.picklester_coin_ledger
  drop constraint if exists picklester_coin_ledger_source_check;
alter table public.picklester_coin_ledger
  add constraint picklester_coin_ledger_source_check
  check (source in (
    'welcome', 'daily_online', 'match_win', 'match_loss', 'maya_purchase',
    'background_purchase', 'adjustment', 'owner_grant'
  ));

create or replace function public.grant_picklester_coins(
  target_user uuid,
  coin_amount integer,
  grant_reason text
)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  target_role text;
  new_balance integer;
  clean_reason text := trim(coalesce(grant_reason, ''));
begin
  if not public.is_picklester_owner() then
    raise exception 'Only the Picklester owner can grant Gold Coins';
  end if;
  if coin_amount is null or coin_amount < 1 or coin_amount > 100000 then
    raise exception 'Enter a Coin amount from 1 to 100,000';
  end if;
  if char_length(clean_reason) < 3 or char_length(clean_reason) > 200 then
    raise exception 'Enter a reason from 3 to 200 characters';
  end if;

  select role into target_role
  from public.profiles
  where id = target_user
  for update;
  if not found then raise exception 'Player was not found'; end if;
  if target_role = 'owner' then raise exception 'Choose a player or staff member'; end if;

  update public.profiles
  set coin_points = coin_points + coin_amount, updated_at = now()
  where id = target_user
  returning coin_points into new_balance;

  insert into public.picklester_coin_ledger(
    user_id, amount, source, source_reference, description
  ) values (
    target_user, coin_amount, 'owner_grant', gen_random_uuid()::text, clean_reason
  );

  return jsonb_build_object(
    'granted', true,
    'amount', coin_amount,
    'balance', new_balance
  );
end;
$$;
revoke all on function public.grant_picklester_coins(uuid, integer, text) from public;
grant execute on function public.grant_picklester_coins(uuid, integer, text) to authenticated;

-- Admins and GMs may read and answer support tickets. Permanent deletion stays
-- owner-only through delete_picklester_ticket().
drop policy if exists "Users and staff read GM tickets" on public.gm_tickets;
create policy "Users and staff read GM tickets"
on public.gm_tickets for select to authenticated
using (user_id = auth.uid() or public.is_picklester_support());

drop policy if exists "Staff update GM tickets" on public.gm_tickets;
create policy "Staff update GM tickets"
on public.gm_tickets for update to authenticated
using (public.is_picklester_support())
with check (public.is_picklester_support());

create or replace function public.list_picklester_owner_tickets()
returns table(
  id uuid,
  user_id uuid,
  subject text,
  message text,
  status text,
  owner_reply text,
  created_at timestamptz,
  user_name text,
  user_username text
)
language sql stable security definer set search_path = '' as $$
  select ticket.id, ticket.user_id, ticket.subject, ticket.message,
    ticket.status, ticket.owner_reply, ticket.created_at,
    profile.name, profile.username
  from public.gm_tickets ticket
  join public.profiles profile on profile.id = ticket.user_id
  where public.is_picklester_support()
  order by case when ticket.status in ('open', 'in_progress') then 0 else 1 end,
    ticket.updated_at desc;
$$;
revoke all on function public.list_picklester_owner_tickets() from public;
grant execute on function public.list_picklester_owner_tickets() to authenticated;

create or replace function public.reply_picklester_ticket(
  target_ticket uuid,
  reply_text text,
  next_status text default 'in_progress'
)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_picklester_support() then
    raise exception 'Picklester staff access is required';
  end if;
  if char_length(trim(coalesce(reply_text, ''))) < 1 then
    raise exception 'Write a reply first';
  end if;
  if next_status not in ('in_progress', 'resolved') then
    raise exception 'Invalid ticket status';
  end if;

  update public.gm_tickets
  set owner_reply = trim(reply_text), status = next_status,
      replied_at = now(), replied_by = auth.uid(), updated_at = now()
  where id = target_ticket;
end;
$$;
revoke all on function public.reply_picklester_ticket(uuid, text, text) from public;
grant execute on function public.reply_picklester_ticket(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
