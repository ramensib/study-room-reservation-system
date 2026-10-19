import { requireSupabase } from '../lib/supabase';
import { validateBookingInterval } from '../availability';
import type { OwnReservation } from '../reservationHistory';

export type Role = 'student' | 'administrator';
export type RoomInput = { name: string; capacity: number; features: string[] };
export type Room = RoomInput & { id: string };

export async function readRole(userId: string): Promise<Role> {
  const { data, error } = await requireSupabase().from('profiles').select('role').eq('id', userId).single();
  if (error) throw error;
  if (data.role !== 'student' && data.role !== 'administrator') throw new Error('Unrecognized role');
  return data.role;
}

// The database checks administrator authority even if someone calls these directly.
export async function addRoom(room: RoomInput) {
  const { data, error } = await requireSupabase().from('rooms').insert(room).select().single();
  if (error) throw error;
  return data;
}

export async function editRoom(id: string, room: RoomInput) {
  const { data, error } = await requireSupabase().from('rooms').update(room).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function listRooms(): Promise<Room[]> {
  const { data, error } = await requireSupabase().from('rooms').select('id, name, capacity, features').order('name');
  if (error) throw error;
  return (data ?? []) as Room[];
}

export async function searchRooms(minimumCapacity = 1, features: string[] = []): Promise<Room[]> {
  let query = requireSupabase().from('rooms').select('*').gte('capacity', minimumCapacity);
  if (features.length) query = query.contains('features', features);
  const { data, error } = await query.order('name');
  if (error) throw error;
  return (data ?? []) as Room[];
}

export async function reserveRoom(roomId: string, startsAt: string, endsAt: string) {
  validateBookingInterval(startsAt, endsAt);
  const client = requireSupabase();
  const { data: identity, error: identityError } = await client.auth.getUser();
  if (identityError || !identity.user) throw Object.assign(new Error('Sign in as a Student to reserve a room.'), { code: 'AUTH_REQUIRED' });
  if (await readRole(identity.user.id) !== 'student') {
    throw Object.assign(new Error('Only Students can reserve rooms.'), { code: 'AUTH_REQUIRED' });
  }
  const { data: current, error: sessionError } = await client.auth.getSession();
  if (sessionError || current.session?.user.id !== identity.user.id) {
    throw Object.assign(new Error('Your session changed. Sign in again.'), { code: 'AUTH_REQUIRED' });
  }
  // Recheck the clock after authentication requests, immediately before insertion.
  validateBookingInterval(startsAt, endsAt);
  // ISO timestamps with offsets are expected. Ownership/status are server defaults.
  const { data, error } = await client.from('reservations')
    .insert({ room_id: roomId, starts_at: startsAt, ends_at: endsAt }).select().single();
  if (error?.code === '23P01') throw Object.assign(new Error('That slot is no longer available. Choose another time.'), { code: '23P01' });
  if (error) throw error;
  if (!data?.id || data.status !== 'active' || data.student_id !== identity.user.id || data.room_id !== roomId ||
    Date.parse(data.starts_at) !== Date.parse(startsAt) || Date.parse(data.ends_at) !== Date.parse(endsAt)) {
    throw new Error('The reservation response could not be confirmed.');
  }
  return data;
}

export async function cancelReservation(id: string) {
  const { data, error } = await requireSupabase().rpc('cancel_reservation', { reservation_id: id });
  if (error) throw error;
  return data;
}

// FR-10 Student entry point; the existing RPC/RLS remains the final authority.
export async function cancelOwnReservation(id: string, expectedUserId: string) {
  const client = requireSupabase();
  const { data: identity, error: authError } = await client.auth.getUser();
  if (authError || !identity.user || identity.user.id !== expectedUserId ||
    await readRole(identity.user.id) !== 'student') {
    throw Object.assign(new Error('Student session required.'), { code: 'AUTH_REQUIRED' });
  }
  const { data: row, error } = await client.from('reservations')
    .select('id, student_id, room_id, starts_at, ends_at, status').eq('id', id)
    .eq('student_id', identity.user.id).single();
  if (error) throw error;
  if (!row || row.student_id !== identity.user.id || row.id !== id || row.status !== 'active' ||
    !(Date.parse(row.starts_at) > Date.now())) {
    throw Object.assign(new Error('Reservation no longer eligible for cancellation.'), { code: 'P0002' });
  }
  const { data: session, error: sessionError } = await client.auth.getSession();
  if (sessionError || session.session?.user.id !== expectedUserId) {
    throw Object.assign(new Error('Session changed.'), { code: 'AUTH_REQUIRED' });
  }
  if (!(Date.parse(row.starts_at) > Date.now())) {
    throw Object.assign(new Error('Reservation has started.'), { code: 'P0002' });
  }
  const cancelled = await cancelReservation(id);
  if (!cancelled || cancelled.id !== id || cancelled.student_id !== expectedUserId ||
    cancelled.status !== 'cancelled' || cancelled.room_id !== row.room_id ||
    Date.parse(cancelled.starts_at) !== Date.parse(row.starts_at) ||
    Date.parse(cancelled.ends_at) !== Date.parse(row.ends_at)) {
    throw new Error('Cancellation response could not be confirmed.');
  }
  return cancelled as { id: string; room_id: string; starts_at: string; ends_at: string; status: 'cancelled' };
}

export async function listVisibleReservations() {
  // RLS limits students to their own records; administrators can see all records.
  const { data, error } = await requireSupabase().from('reservations').select('*').order('starts_at');
  if (error) throw error;
  return data;
}

export type AdminReservation = OwnReservation & { studentId: string };

// FR-12: the Administrator determines invalidity; RLS applies inside the invoker RPC.
export async function cancelAdminReservation(id: string, expectedUserId: string) {
  const client = requireSupabase();
  const { data: identity, error: authError } = await client.auth.getUser();
  if (authError || identity.user?.id !== expectedUserId || await readRole(expectedUserId) !== 'administrator') {
    throw Object.assign(new Error('Administrator session required.'), { code: 'AUTH_REQUIRED' });
  }
  const { data: row, error } = await client.from('reservations')
    .select('id, student_id, room_id, starts_at, ends_at, status').eq('id', id).single();
  if (error) throw error;
  if (!row || row.id !== id || row.status !== 'active') {
    throw Object.assign(new Error('Reservation is no longer active.'), { code: 'P0002' });
  }
  const { data: session, error: sessionError } = await client.auth.getSession();
  if (sessionError || session.session?.user.id !== expectedUserId) {
    throw Object.assign(new Error('Session changed.'), { code: 'AUTH_REQUIRED' });
  }
  const cancelled = await cancelReservation(id);
  if (!cancelled || cancelled.id !== id || cancelled.status !== 'cancelled' ||
    cancelled.student_id !== row.student_id || cancelled.room_id !== row.room_id ||
    Date.parse(cancelled.starts_at) !== Date.parse(row.starts_at) ||
    Date.parse(cancelled.ends_at) !== Date.parse(row.ends_at)) throw new Error('Cancellation could not be confirmed.');
  return cancelled as { id: string; room_id: string; starts_at: string; ends_at: string; status: 'cancelled' };
}

// Read-only FR-11 page. RLS is authoritative; no owner/status filter for admins.
export async function listAllReservations(expectedUserId: string, offset = 0): Promise<AdminReservation[]> {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid page.');
  const client = requireSupabase();
  const { data: identity, error: authError } = await client.auth.getUser();
  if (authError || identity.user?.id !== expectedUserId ||
    await readRole(expectedUserId) !== 'administrator') throw new Error('Administrator session required.');
  const { data, error } = await client.from('reservations')
    .select('id, student_id, starts_at, ends_at, status, rooms(name)')
    .order('starts_at').order('id').range(offset, offset + 49);
  if (error) throw error;
  const { data: current, error: sessionError } = await client.auth.getSession();
  if (sessionError || current.session?.user.id !== expectedUserId) throw new Error('Session changed.');
  if (!Array.isArray(data)) throw new Error('Invalid reservation response.');
  return data.map(record => {
    if (typeof record.id !== 'string' || typeof record.student_id !== 'string' || !record.student_id ||
      !Number.isFinite(Date.parse(record.starts_at)) || !Number.isFinite(Date.parse(record.ends_at)) ||
      Date.parse(record.ends_at) <= Date.parse(record.starts_at) ||
      !['active', 'cancelled'].includes(record.status)) throw new Error('Invalid reservation response.');
    const related = record.rooms as unknown as { name: string } | { name: string }[] | null;
    const room = Array.isArray(related) ? related[0] : related;
    return { id: record.id, studentId: record.student_id, roomName: room?.name || 'Room name unavailable',
      starts_at: record.starts_at, ends_at: record.ends_at, status: record.status };
  });
}

// Owner-scoped Student view. RLS remains authoritative; explicit owner filtering
// and response checks are defense in depth, not a substitute for database policies.
export async function listOwnReservations(expectedUserId: string): Promise<OwnReservation[]> {
  const client = requireSupabase();
  const { data: identity, error: identityError } = await client.auth.getUser();
  if (identityError || !identity.user || identity.user.id !== expectedUserId ||
    await readRole(identity.user.id) !== 'student') throw new Error('Student session required.');
  const rows: OwnReservation[] = [];
  // Fetch pages rather than silently truncating history at the API row limit.
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from('reservations')
      .select('id, student_id, starts_at, ends_at, status, rooms(name)')
      .eq('student_id', identity.user.id).order('starts_at').order('id')
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Invalid reservation response.');
    for (const record of data) {
      if (record.student_id !== identity.user.id || typeof record.id !== 'string' ||
        !Number.isFinite(Date.parse(record.starts_at)) || !Number.isFinite(Date.parse(record.ends_at)) ||
        Date.parse(record.ends_at) <= Date.parse(record.starts_at) ||
        !['active', 'cancelled'].includes(record.status)) throw new Error('Invalid reservation response.');
      // Supabase's untyped client may infer the relationship as an array.
      const related = record.rooms as unknown as { name: string } | { name: string }[] | null;
      const room = Array.isArray(related) ? related[0] : related;
      rows.push({ id: record.id, roomName: room?.name || 'Room name unavailable',
        starts_at: record.starts_at, ends_at: record.ends_at, status: record.status });
    }
    const { data: current, error: sessionError } = await client.auth.getSession();
    if (sessionError || current.session?.user.id !== expectedUserId) throw new Error('Session changed.');
    if (data.length < pageSize) break;
  }
  return rows;
}

export async function busyIntervals(roomId: string, startsAt: string, endsAt: string) {
  const { data, error } = await requireSupabase().rpc('room_busy_intervals', {
    target_room: roomId, window_start: startsAt, window_end: endsAt,
  });
  if (error) throw error;
  return data;
}
