-- Daily five-game allowance, owner-managed Game Passes, and ticket deletion.
alter table public.profiles add column if not exists gamepass_expires_at timestamptz;

create or replace function public.activate_picklester_gamepass(target_user uuid,pass_days integer)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare expiry timestamptz;
begin
  if not public.is_picklester_owner() then raise exception 'Only the owner can activate Game Pass'; end if;
  if pass_days not in (5,7,30) then raise exception 'Choose 5 days, 1 week, or 1 month'; end if;
  expiry := now()+make_interval(days=>pass_days);
  update public.profiles set gamepass_expires_at=expiry,updated_at=now() where id=target_user;
  return expiry;
end; $$;
grant execute on function public.activate_picklester_gamepass(uuid,integer) to authenticated;

create or replace function public.enforce_picklester_daily_game_limit()
returns trigger language plpgsql security definer set search_path='' as $$
declare played integer; member_role text; pass_until timestamptz;
begin
  select role,gamepass_expires_at into member_role,pass_until from public.profiles where id=new.user_id;
  if member_role in ('owner','admin') or pass_until>now() then return new; end if;
  select count(*) into played from public.picklester_game_participants participant join public.picklester_games game on game.id=participant.game_id where participant.user_id=new.user_id and game.status='completed' and game.ended_at >= date_trunc('day',now());
  if played>=5 then raise exception 'Daily limit reached. You have played 5 games today. Purchase a Game Pass in the Shop to continue, or wait for your free games to reset tomorrow.'; end if;
  return new;
end; $$;
drop trigger if exists enforce_picklester_daily_game_limit_before_join on public.picklester_game_participants;
create trigger enforce_picklester_daily_game_limit_before_join before insert on public.picklester_game_participants for each row execute procedure public.enforce_picklester_daily_game_limit();

create or replace function public.delete_picklester_ticket(target_ticket uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_picklester_owner() then raise exception 'Only the owner can delete tickets'; end if;
  delete from public.gm_tickets where id=target_ticket;
end; $$;
grant execute on function public.delete_picklester_ticket(uuid) to authenticated;
notify pgrst,'reload schema';
