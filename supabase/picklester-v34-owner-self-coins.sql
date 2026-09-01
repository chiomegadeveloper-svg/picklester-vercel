-- Picklester v34: allow the owner to grant Gold Coins to any account,
-- including the owner account, while keeping every grant auditable.

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

  update public.profiles
  set coin_points = coin_points + coin_amount, updated_at = now()
  where id = target_user
  returning coin_points into new_balance;

  if not found then raise exception 'Player was not found'; end if;

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
