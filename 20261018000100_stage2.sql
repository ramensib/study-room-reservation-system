-- Stage 2 draft. Apply only after approval and inspection of the target project.
-- FR-01 through FR-12 storage/security foundation; NFR-03 and NFR-04.
begin;

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
set local search_path = public, extensions;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  role text not null default 'student' check (role in ('student', 'administrator'))
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  capacity integer not null check (capacity > 0),
  features text[] not null default '{}',
  constraint features_have_no_nulls check (array_position(features, null) is null)
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete restrict,
  student_id uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  constraint valid_interval check (
    isfinite(starts_at) and isfinite(ends_at) and ends_at > starts_at
  ),
  -- Checks concurrent writes inside PostgreSQL, not just a client pre-check.
  -- [start, end): 10:00–11:00 and 11:00–12:00 do not overlap.
  constraint no_active_room_overlap exclude using gist (
    room_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'active')
);
create index reservations_owner_start on public.reservations(student_id, starts_at);

-- Ignore all client metadata, including any requested administrator role.
create function private.create_student_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, role) values (new.id, 'student');
  return new;
end;
$$;
revoke all on function private.create_student_profile() from public, anon, authenticated;
create trigger on_auth_user_created
after insert on auth.users for each row execute function private.create_student_profile();

-- Existing accounts become students; administrator promotions require trusted SQL.
insert into public.profiles(id, role) select id, 'student' from auth.users;

create function private.current_role()
returns text language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid());
$$;
revoke all on function private.current_role() from public, anon;
grant execute on function private.current_role() to authenticated;

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.reservations enable row level security;

-- Explicit privileges override Supabase's default grants. No client may change roles.
revoke all on public.profiles, public.rooms, public.reservations from public, anon, authenticated;
grant select on public.profiles, public.rooms, public.reservations to authenticated;
grant insert(name, capacity, features), update(name, capacity, features) on public.rooms to authenticated;
grant insert(room_id, starts_at, ends_at) on public.reservations to authenticated;
grant update(status) on public.reservations to authenticated;

create policy profile_read_self on public.profiles for select to authenticated
using (id = (select auth.uid()));

create policy rooms_read on public.rooms for select to authenticated
using ((select private.current_role()) in ('student', 'administrator'));
create policy rooms_admin_insert on public.rooms for insert to authenticated
with check ((select private.current_role()) = 'administrator');
create policy rooms_admin_update on public.rooms for update to authenticated
using ((select private.current_role()) = 'administrator')
with check ((select private.current_role()) = 'administrator');

create policy reservations_read on public.reservations for select to authenticated
using (
  (select private.current_role()) = 'administrator'
  or (student_id = (select auth.uid()) and (select private.current_role()) = 'student')
);
create policy reservations_student_insert on public.reservations for insert to authenticated
with check (
  (select private.current_role()) = 'student'
  and student_id = (select auth.uid()) and status = 'active'
  and starts_at > statement_timestamp()
);
create policy reservations_cancel on public.reservations for update to authenticated
using (
  status = 'active' and (
    (select private.current_role()) = 'administrator'
    or ((select private.current_role()) = 'student'
        and student_id = (select auth.uid()) and starts_at > statement_timestamp())
  )
)
with check (
  status = 'cancelled' and (
    (select private.current_role()) = 'administrator'
    or ((select private.current_role()) = 'student' and student_id = (select auth.uid()))
  )
);

-- Runs with caller permissions: RLS + status-only column grant remain effective.
-- The administrator decides invalidity; no new automated invalidity rule is introduced.
create function public.cancel_reservation(reservation_id uuid)
returns public.reservations language plpgsql security invoker set search_path = '' as $$
declare cancelled public.reservations;
begin
  update public.reservations set status = 'cancelled'
  where id = reservation_id and status = 'active'
  returning * into cancelled;
  if not found then
    raise exception 'Reservation unavailable or cancellation not permitted' using errcode = 'P0002';
  end if;
  return cancelled;
end;
$$;
revoke all on function public.cancel_reservation(uuid) from public, anon;
grant execute on function public.cancel_reservation(uuid) to authenticated;

-- Availability needs busy times without exposing other students' reservation records.
-- This narrowly scoped definer function returns only interval boundaries, never owners/IDs.
create function public.room_busy_intervals(target_room uuid, window_start timestamptz, window_end timestamptz)
returns table(starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if window_start is null or window_end is null or not isfinite(window_start)
    or not isfinite(window_end) or window_end <= window_start then
    raise exception 'Invalid time window' using errcode = '22023';
  end if;
  return query select r.starts_at, r.ends_at from public.reservations r
  where r.room_id = target_room and r.status = 'active'
    and r.starts_at < window_end and r.ends_at > window_start
  order by r.starts_at;
end;
$$;
revoke all on function public.room_busy_intervals(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.room_busy_intervals(uuid, timestamptz, timestamptz) to authenticated;

commit;
