-- Picklester V28: show only recently-online, GPS-enabled players on the map.

create or replace function public.nearby_picklesters(
  current_lat double precision,
  current_lng double precision,
  radius_km double precision default 20
)
returns table(id uuid, name text, username text, avatar_url text, distance_km double precision, bearing_deg double precision)
language sql stable security definer set search_path = '' as $$
  with candidates as (
    select p.id, p.name, p.username, p.avatar_url, l.latitude, l.longitude,
      6371 * 2 * asin(sqrt(
        power(sin(radians((l.latitude - current_lat) / 2)), 2)
        + cos(radians(current_lat)) * cos(radians(l.latitude))
        * power(sin(radians((l.longitude - current_lng) / 2)), 2)
      )) as distance_km
    from public.profile_locations l
    join public.profiles p on p.id = l.user_id
    where l.location_enabled
      and l.latitude is not null
      and l.longitude is not null
      and l.updated_at >= now() - interval '5 minutes'
      and p.verified
      and p.id <> auth.uid()
      and exists (
        select 1 from public.profiles me
        where me.id = auth.uid() and (me.verified or me.role in ('owner','admin'))
      )
  )
  select c.id, c.name, c.username, c.avatar_url, c.distance_km,
    degrees(atan2(
      sin(radians(c.longitude - current_lng)) * cos(radians(c.latitude)),
      cos(radians(current_lat)) * sin(radians(c.latitude))
      - sin(radians(current_lat)) * cos(radians(c.latitude)) * cos(radians(c.longitude - current_lng))
    ))::double precision as bearing_deg
  from candidates c
  where c.distance_km <= least(greatest(radius_km, 0), 20)
  order by c.distance_km asc
  limit 100;
$$;

revoke all on function public.nearby_picklesters(double precision, double precision, double precision) from public;
grant execute on function public.nearby_picklesters(double precision, double precision, double precision) to authenticated;

notify pgrst, 'reload schema';
