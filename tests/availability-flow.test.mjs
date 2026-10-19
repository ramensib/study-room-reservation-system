// Isolated execution of actual TS/TSX with mocked React hooks/native elements and RPC.
// This is a state-flow test, not a React renderer or live PostgreSQL integration test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as availability from '../src/availability.ts';
import * as history from '../src/reservationHistory.ts';

function compile(path, dependencies, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require: name => {
    if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`);
    return dependencies[name];
  }, ...globals });
  return exports;
}

function screen(historyMode = false) {
  const hooks = [], effects = [], timers = new Map(), calls = [], bookings = [];
  let cursor = 0, timerId = 0, tree;
  let room = { id: 'room-a', name: 'Room A' };
  const changed = (a, b) => !a || b.some((value, i) => value !== a[i]);
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
      return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; }];
    },
    useRef(value) { const i = cursor++; return hooks[i] ??= { current: value }; },
    useCallback(fn, deps) {
      const i = cursor++;
      if (changed(hooks[i]?.deps, deps)) hooks[i] = { fn, deps };
      return hooks[i].fn;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (changed(hooks[i]?.deps, deps)) effects.push(() => {
        hooks[i]?.cleanup?.(); hooks[i] = { deps, cleanup: fn() };
      });
    },
  };
  const jsx = (type, props) => ({ type, props });
  const Screen = compile(historyMode === 'admin' ? '../src/AllReservations.tsx' : historyMode ? '../src/MyReservations.tsx' : '../src/RoomAvailability.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { ScrollView: 'ScrollView', ActivityIndicator: 'Spinner', Button: 'Button', Text: 'Text', TextInput: 'Input', View: 'View',
      AppState: { addEventListener: () => ({ remove() {} }) }, Keyboard: { dismiss() {} }, StyleSheet: { create: x => x } },
    './availability': availability,
    './reservationHistory': history,
    './services/database': {
      busyIntervals: (...args) => new Promise((resolve, reject) => calls.push({ args, resolve, reject })),
      reserveRoom: (...args) => new Promise((resolve, reject) => bookings.push({ args, resolve, reject })),
      listOwnReservations: (...args) => new Promise((resolve, reject) => calls.push({ args, resolve, reject })),
      listAllReservations: (...args) => new Promise((resolve, reject) => calls.push({ args, resolve, reject })),
      cancelOwnReservation: (...args) => new Promise((resolve, reject) => bookings.push({ args, resolve, reject })),
      cancelAdminReservation: (...args) => new Promise((resolve, reject) => bookings.push({ args, resolve, reject })),
    },
  }, { Date, setInterval: () => 1, clearInterval() {},
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id) }).default;
  const render = () => { cursor = 0; tree = Screen({ room, adminId: room.id, studentId: room.id, onBack() {} }); effects.splice(0).forEach(fn => fn()); return tree; };
  const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node)
    ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  render();
  return {
    calls, bookings, render, nodes: () => nodes(tree),
    press(title) { const button = nodes(tree).find(n => n.type === 'Button' && n.props.title === title); assert.ok(button); assert.ok(!button.props.disabled); button.props.onPress(); render(); },
    flush() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); render(); },
    date(value) { nodes(tree).find(n => n.type === 'Input').props.onChangeText(value); render(); },
    room(id) { room = { id, name: id }; render(); },
    async settle() { await new Promise(resolve => setImmediate(resolve)); render(); },
    text() { return JSON.stringify(tree); },
  };
}

const adminRow = { id: 'reservation-a', studentId: 'student-a', roomName: 'Library 101', status: 'active', starts_at: '2099-07-01T14:00:00Z', ends_at: '2099-07-01T15:00:00Z' };
async function adminReady() {
  const s = screen('admin');
  s.calls[0].resolve([adminRow, { ...adminRow, id: 'cancelled', status: 'cancelled' }]); await s.settle();
  return s;
}
test('admin cancellation confirms details, prevents duplicate taps and refreshes list and availability only after success', async () => {
  const s = await adminReady();
  assert.equal(s.nodes().filter(n => n.props.title === 'Cancel invalid reservation').length, 1);
  s.press('Cancel invalid reservation'); assert.match(s.text(), /Confirm invalid reservation/);
  assert.match(s.text(), /student-a/); assert.match(s.text(), /Library 101/);
  s.press('Keep reservation'); assert.equal(s.bookings.length, 0);
  s.press('Cancel invalid reservation');
  const confirm = s.nodes().find(n => n.props.title === 'Confirm cancellation').props.onPress;
  confirm(); confirm(); s.render(); assert.equal(s.bookings.length, 1);
  assert.doesNotMatch(s.text(), /record has been preserved/);
  s.bookings[0].resolve({ ...adminRow, room_id: 'room-a', status: 'cancelled' }); await s.settle();
  assert.match(s.text(), /record has been preserved/);
  s.calls[1].resolve([{ ...adminRow, status: 'cancelled' }]); await s.settle();
  assert.equal(s.calls[2].args[0], 'room-a');
  s.calls[2].reject(new Error('offline')); await s.settle();
  assert.match(s.text(), /availability could not be refreshed/);
  assert.ok(!s.nodes().some(n => n.props.title === 'Cancel invalid reservation'));
});
for (const code of ['P0002', '42501', 'NETWORK']) test(`admin cancellation ${code} fails safely and refreshes status`, async () => {
  const s = await adminReady(); s.press('Cancel invalid reservation'); s.press('Confirm cancellation');
  s.bookings[0].reject({ code }); await s.settle();
  assert.equal(s.calls.length, 2);
  assert.doesNotMatch(s.text(), /record has been preserved/);
  assert.match(s.text(), code === 'NETWORK' ? /may have reached the server/ : code === '42501' ? /Cancellation denied/ : /no longer active/);
  s.calls[1].resolve([{ ...adminRow, status: 'cancelled' }]); await s.settle();
});
test('old-account admin cancellation cannot refresh or publish success in a new account', async () => {
  const s = await adminReady(); s.press('Cancel invalid reservation'); s.press('Confirm cancellation');
  s.room('new-admin'); s.calls[1].resolve([]); await s.settle();
  s.bookings[0].resolve({ ...adminRow, status: 'cancelled' }); await s.settle();
  assert.equal(s.calls.length, 2); assert.doesNotMatch(s.text(), /record has been preserved/);
});

test('admin screen displays both statuses, pages by returned count and refreshes from the start', async () => {
  const s = screen('admin');
  const row = { id: 'a', studentId: 'student-a', roomName: 'Library 101', status: 'active', starts_at: '2026-07-01T14:00:00Z', ends_at: '2026-07-01T15:00:00Z' };
  s.calls[0].resolve([row, { ...row, id: 'b', studentId: 'student-b', status: 'cancelled' }]); await s.settle();
  assert.match(s.text(), /student-a/); assert.match(s.text(), /student-b/);
  assert.match(s.text(), /cancelled/); assert.match(s.text(), /active/);
  assert.match(s.text(), /9:00 AM/);
  s.press('Next page'); assert.deepEqual(s.calls[1].args, ['room-a', 2]);
  s.calls[1].resolve([]); await s.settle(); assert.match(s.text(), /End of reservations/);
  s.press('Refresh reservations'); assert.deepEqual(s.calls[2].args, ['room-a', 0]);
  s.calls[2].resolve([]); await s.settle(); assert.match(s.text(), /No reservations found/);
});

test('admin late account and refresh responses cannot overwrite newer results or errors', async () => {
  const s = screen('admin'); s.room('new-admin');
  s.calls[1].resolve([]); await s.settle();
  s.calls[0].resolve([{ id: 'secret', roomName: 'OLD ACCOUNT DATA' }]); await s.settle();
  assert.doesNotMatch(s.text(), /OLD ACCOUNT DATA/);
  s.press('Refresh reservations'); s.press('Refresh reservations');
  s.calls[3].reject(new Error('network')); await s.settle();
  s.calls[2].resolve([]); await s.settle();
  assert.match(s.text(), /Reservations could not be loaded/);
  assert.doesNotMatch(s.text(), /No reservations found/);
});

test('RPC rejection clears results and never displays Available rows', async () => {
  const s = screen(); s.date('2099-07-15'); s.flush();
  s.calls[0].resolve([]); await s.settle();
  assert.match(s.text(), /12 available slot/);
  s.date('2099-07-16'); s.flush();
  assert.doesNotMatch(s.text(), /12 available slot/);
  s.calls[1].reject(new Error('network')); await s.settle();
  assert.match(s.text(), /Availability could not be loaded/);
  assert.doesNotMatch(s.text(), /available slot\(s\)/);
});

for (const change of ['date', 'room']) test(`late ${change} success cannot replace newer failure`, async () => {
  const s = screen(); s.date('2099-07-15'); s.flush();
  if (change === 'date') s.date('2099-07-16'); else s.room('room-b');
  s.flush();
  assert.equal(s.calls.length, 2);
  s.calls[1].reject(new Error('new request failed')); await s.settle();
  s.calls[0].resolve([]); await s.settle();
  assert.match(s.text(), /Availability could not be loaded/);
  assert.doesNotMatch(s.text(), /available slot\(s\)/);
});

test('late failure cannot hide newest successful result; past slots have no action', async () => {
  const s = screen(); s.date('2099-07-15'); s.flush();
  s.date('2020-07-15'); s.flush();
  s.calls[1].resolve([]); await s.settle();
  s.calls[0].reject(new Error('stale')); await s.settle();
  assert.doesNotMatch(s.text(), /Availability could not be loaded/);
  const past = s.nodes().filter(n => n.type === 'Text' && n.props.children === 'Past - unavailable');
  assert.equal(past.length, 12);
  assert.ok(s.nodes().filter(n => n.props.onPress).every(n => ['Back to room search', 'Show availability'].includes(n.props.title)));
});

test('service uses exact RPC parameters and propagates database errors', async () => {
  let captured;
  const denied = { message: 'denied' };
  const service = compile('../src/services/database.ts', { '../availability': availability, '../lib/supabase': { requireSupabase: () => ({
    rpc: async (...args) => { captured = args; return { data: null, error: denied }; },
  }) } });
  await assert.rejects(service.busyIntervals('room-a', 'start', 'end'), error => error === denied);
  assert.equal(captured[0], 'room_busy_intervals');
  assert.deepEqual(JSON.parse(JSON.stringify(captured[1])), { target_room: 'room-a', window_start: 'start', window_end: 'end' });
});

async function readyToBook() {
  const s = screen(); s.date('2099-07-15'); s.flush();
  s.calls[0].resolve([]); await s.settle();
  s.press('Reserve 9:00 AM - 10:00 AM');
  assert.match(s.text(), /Confirm reservation/);
  assert.match(s.text(), /2099-07-15/);
  assert.equal(s.bookings.length, 0);
  return s;
}

test('confirmation sends one request despite repeated taps; success waits for save and refreshes', async () => {
  const s = await readyToBook();
  const confirm = s.nodes().find(n => n.props.title === 'Confirm reservation').props.onPress;
  confirm(); confirm(); s.render();
  assert.equal(s.bookings.length, 1);
  assert.deepEqual(s.bookings[0].args, ['room-a', '2099-07-15T14:00:00.000Z', '2099-07-15T15:00:00.000Z']);
  assert.doesNotMatch(s.text(), /Reservation saved/);
  s.bookings[0].resolve({ id: 'confirmed' }); await s.settle();
  assert.match(s.text(), /Reservation saved/);
  assert.equal(s.calls.length, 2);
  s.calls[1].resolve([{ starts_at: s.bookings[0].args[1], ends_at: s.bookings[0].args[2] }]); await s.settle();
  assert.match(s.text(), /Occupied - unavailable/);
  assert.ok(!s.nodes().some(n => n.props.title === 'Reserve 9:00 AM - 10:00 AM'));
});

test('23P01 displays conflict, refreshes, and never claims success', async () => {
  const s = await readyToBook(); s.press('Confirm reservation');
  s.bookings[0].reject({ code: '23P01' }); await s.settle();
  assert.match(s.text(), /Another reservation overlaps/);
  assert.doesNotMatch(s.text(), /Reservation saved/);
  assert.equal(s.calls.length, 2);
  s.calls[1].resolve([{ starts_at: s.bookings[0].args[1], ends_at: s.bookings[0].args[2] }]); await s.settle();
  assert.match(s.text(), /Occupied - unavailable/);
});

test('network failure reports uncertain outcome without success or automatic retry', async () => {
  const s = await readyToBook(); s.press('Confirm reservation');
  s.bookings[0].reject(new Error('network')); await s.settle();
  assert.match(s.text(), /could not confirm/);
  assert.doesNotMatch(s.text(), /Reservation saved/);
  assert.equal(s.bookings.length, 1);
  assert.ok(!s.nodes().some(n => n.props.title?.startsWith('Reserve ')));
});

test('date changes discard confirmation; dismiss does not insert', async () => {
  const s = await readyToBook(); s.press('Dismiss confirmation');
  assert.equal(s.bookings.length, 0);
  s.press('Reserve 9:00 AM - 10:00 AM'); s.date('2099-07-16');
  assert.ok(!s.nodes().some(n => n.props.title === 'Confirm reservation'));
  assert.equal(s.bookings.length, 0);
});

function reservationService({ role = 'student', user = 'student-a', sessionUser = user, responseError = null, empty = false } = {}) {
  const inserts = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: user ? { id: user } : null }, error: null }),
      getSession: async () => ({ data: { session: { user: { id: sessionUser } } }, error: null }) },
    from(table) {
      if (table === 'profiles') return { select: () => ({ eq: () => ({ single: async () => ({ data: { role }, error: null }) }) }) };
      assert.equal(table, 'reservations');
      return { insert: payload => {
        inserts.push(payload);
        return { select: () => ({ single: async () => ({ data: empty ? null : { ...payload, id: 'saved-id', student_id: user, status: 'active' }, error: responseError }) }) };
      } };
    },
  };
  return { inserts, service: compile('../src/services/database.ts', {
    '../availability': availability, '../lib/supabase': { requireSupabase: () => client },
  }) };
}

test('reservation insert uses only room and timestamps, checks saved response, preserves conflict code', async () => {
  const args = ['room-b', '2099-07-15T14:00:00Z', '2099-07-15T15:00:00Z'];
  const s = reservationService();
  assert.equal((await s.service.reserveRoom(...args)).id, 'saved-id');
  assert.deepEqual(Object.keys(s.inserts[0]).sort(), ['ends_at', 'room_id', 'starts_at']);
  assert.equal(s.inserts[0].room_id, 'room-b');
  const conflict = reservationService({ responseError: { code: '23P01' } });
  await assert.rejects(conflict.service.reserveRoom(...args), e => e.code === '23P01');
  const missing = reservationService({ empty: true });
  await assert.rejects(missing.service.reserveRoom(...args));
});

test('unauthenticated, administrator and changed-session requests cannot insert', async () => {
  for (const options of [{ user: null }, { role: 'administrator' }, { sessionUser: 'other-student' }]) {
    const s = reservationService(options);
    await assert.rejects(s.service.reserveRoom('room-a', '2099-07-15T14:00:00Z', '2099-07-15T15:00:00Z'), e => e.code === 'AUTH_REQUIRED');
    assert.equal(s.inserts.length, 0);
  }
});

test('invalid reservation intervals fail before inserts', async () => {
  const s = reservationService();
  for (const [start, end] of [
    ['2020-07-15T14:00:00Z', '2020-07-15T15:00:00Z'],
    ['2099-07-15T14:30:00Z', '2099-07-15T15:30:00Z'],
    ['2099-07-15T14:00:00Z', '2099-07-15T16:00:00Z'],
    ['2099-07-15T13:00:00Z', '2099-07-15T14:00:00Z'],
    ['2099-07-16T02:00:00Z', '2099-07-16T03:00:00Z'],
    ['bad', 'bad'],
  ]) await assert.rejects(s.service.reserveRoom('room-a', start, end), e => e.code === 'INVALID_SLOT');
  assert.equal(s.inserts.length, 0);
});

test('room/cancellation fixture contract matches predicates in existing RPC SQL', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261018000100_stage2.sql', import.meta.url), 'utf8');
  assert.match(sql, /where r\.room_id = target_room and r\.status = 'active'\s+and r\.starts_at < window_end and r\.ends_at > window_start/);
  // Explicit model of the inspected SQL, not execution of PostgreSQL or deployed RPC.
  const slots = availability.dailySlots('2027-07-15');
  const base = { starts_at: new Date(slots[1].start).toISOString(), ends_at: new Date(slots[1].end).toISOString() };
  const rows = [{ ...base, room: 'a', status: 'active' }, { ...base, room: 'b', status: 'active' },
    { ...base, room: 'c', status: 'cancelled' }];
  const model = room => rows.filter(r => r.room === room && r.status === 'active' && Date.parse(r.starts_at) < slots[11].end && Date.parse(r.ends_at) > slots[0].start)
    .map(({ starts_at, ends_at }) => ({ starts_at, ends_at }));
  assert.equal(model('a').length, 1);
  assert.equal(model('b').length, 1);
  assert.equal(model('c').length, 0);
  assert.equal(availability.slotStatus(slots[1], model('c'), 0), 'Available');
});

test('My Reservations loading, empty sections and failed refresh never show false empty state', async () => {
  const s = screen(true); s.render();
  assert.match(s.text(), /Loading your reservations/);
  s.calls[0].resolve([]); await s.settle();
  assert.match(s.text(), /No upcoming or ongoing reservations/);
  assert.match(s.text(), /No past reservations yet/);
  s.press('Refresh reservations');
  s.calls[1].reject(new Error('network')); await s.settle();
  assert.match(s.text(), /could not be loaded/);
  assert.doesNotMatch(s.text(), /No past reservations yet/);
});

test('My Reservations ignores old-account response and refresh retrieves new bookings', async () => {
  const s = screen(true); s.room('student-b');
  const r = { id: 'b', roomName: 'B room', starts_at: '2099-07-15T14:00Z', ends_at: '2099-07-15T15:00Z', status: 'active' };
  s.calls[1].resolve([]); await s.settle();
  s.calls[0].resolve([{ ...r, roomName: 'PRIVATE OLD ACCOUNT' }]); await s.settle();
  assert.doesNotMatch(s.text(), /PRIVATE OLD ACCOUNT/);
  s.press('Refresh reservations'); s.calls[2].resolve([r]); await s.settle();
  assert.match(s.text(), /B room/);
  assert.ok(s.nodes().filter(n => n.props.onPress).every(n => ['Refresh reservations', 'Back to room search', 'Cancel Reservation'].includes(n.props.title)));
});

function historyService({ user = 'student-a', role = 'student', sessionUser = user, pages = [[]], error = null } = {}) {
  const filters = [], ranges = [];
  let page = 0, reads = 0;
  const client = {
    auth: { getUser: async () => ({ data: { user: user ? { id: user } : null }, error: null }),
      getSession: async () => ({ data: { session: { user: { id: sessionUser } } }, error: null }) },
    from(table) {
      if (table === 'profiles') return { select: () => ({ eq: () => ({ single: async () => ({ data: { role }, error: null }) }) }) };
      assert.equal(table, 'reservations'); reads++;
      const query = { select: fields => { assert.match(fields, /rooms\(name\)/); return query; },
        eq: (...args) => { filters.push(args); return query; }, order: () => query,
        range: async (...args) => { ranges.push(args); return { data: pages[page++] ?? [], error }; } };
      return query;
    },
  };
  return { filters, ranges, reads: () => reads, service: compile('../src/services/database.ts', {
    '../availability': availability, '../lib/supabase': { requireSupabase: () => client },
  }) };
}
const historyRow = { id: 'r', student_id: 'student-a', starts_at: '2027-07-15T14:00Z', ends_at: '2027-07-15T15:00Z', status: 'active', rooms: { name: 'Library 101' } };
test('own-history query scopes every page to current Student and joins room names', async () => {
  const first = Array.from({ length: 100 }, (_, i) => ({ ...historyRow, id: String(i) }));
  const s = historyService({ pages: [first, [{ ...historyRow, id: 'last', rooms: null }]] });
  const rows = await s.service.listOwnReservations('student-a');
  assert.equal(rows.length, 101);
  assert.equal(rows[0].roomName, 'Library 101');
  assert.equal(rows[100].roomName, 'Room name unavailable');
  assert.deepEqual(s.filters, [['student_id', 'student-a'], ['student_id', 'student-a']]);
  assert.deepEqual(s.ranges, [[0, 99], [100, 199]]);
});
test('own-history denies anonymous, administrator, wrong expected account and changed sessions', async () => {
  for (const options of [{ user: null }, { role: 'administrator' }, { user: 'other' }]) {
    const s = historyService(options);
    await assert.rejects(s.service.listOwnReservations('student-a'));
    assert.equal(s.reads(), 0);
  }
  await assert.rejects(historyService({ sessionUser: 'other' }).service.listOwnReservations('student-a'));
});
test('own-history rejects foreign records, malformed data and database errors', async () => {
  for (const options of [
    { pages: [[{ ...historyRow, student_id: 'other' }]] },
    { pages: [[{ ...historyRow, status: 'completed' }]] },
    { pages: [[{ ...historyRow, ends_at: 'bad' }]] },
    { error: new Error('network') },
  ]) await assert.rejects(historyService(options).service.listOwnReservations('student-a'));
});

const cancellable = { id: 'reservation-a', roomName: 'Library 101', starts_at: '2099-07-15T14:00:00Z', ends_at: '2099-07-15T15:00:00Z', status: 'active' };
async function cancellationScreen() {
  const s = screen(true); s.calls[0].resolve([cancellable]); await s.settle();
  s.press('Cancel Reservation');
  assert.match(s.text(), /Library 101/);
  assert.match(s.text(), /2099/);
  assert.equal(s.bookings.length, 0);
  return s;
}
test('cancellation requires confirmation, locks repeated taps, refreshes status and actual availability', async () => {
  const s = await cancellationScreen();
  const confirm = s.nodes().find(n => n.props.title === 'Confirm cancellation').props.onPress;
  confirm(); confirm(); s.render();
  assert.equal(s.bookings.length, 1);
  assert.deepEqual(s.bookings[0].args, ['reservation-a', 'room-a']);
  assert.doesNotMatch(s.text(), /cancelled successfully/);
  s.bookings[0].resolve({ ...cancellable, status: 'cancelled', room_id: 'real-room' }); await s.settle();
  s.calls[1].resolve([{ ...cancellable, status: 'cancelled' }]); await s.settle();
  assert.deepEqual(s.calls[2].args, ['real-room', cancellable.starts_at, cancellable.ends_at]);
  s.calls[2].resolve([]); await s.settle();
  assert.match(s.text(), /interval is available again/);
  assert.match(s.text(), /Cancelled - not a current booking/);
  assert.ok(!s.nodes().some(n => n.props.title === 'Cancel Reservation'));
});
test('keep reservation performs no cancellation; past, ongoing and cancelled have no action', async () => {
  const s = await cancellationScreen(); s.press('Keep reservation');
  assert.equal(s.bookings.length, 0);
  s.press('Refresh reservations');
  s.calls[1].resolve([
    { ...cancellable, id: 'cancelled', status: 'cancelled' },
    { ...cancellable, id: 'past', starts_at: '2000-01-01T00:00Z', ends_at: '2000-01-01T01:00Z' },
    { ...cancellable, id: 'ongoing', starts_at: new Date(Date.now() - 1000).toISOString() },
  ]); await s.settle();
  assert.ok(!s.nodes().some(n => n.props.title === 'Cancel Reservation'));
});
for (const code of ['P0002', '42501', 'NETWORK']) test(`cancellation ${code} failure does not falsely succeed and refreshes list`, async () => {
  const s = await cancellationScreen(); s.press('Confirm cancellation');
  s.bookings[0].reject({ code }); await s.settle();
  assert.doesNotMatch(s.text(), /cancelled successfully/);
  assert.equal(s.calls.length, 2);
  s.calls[1].resolve([]); await s.settle();
  assert.doesNotMatch(s.text(), /cancelled successfully/);
  assert.equal(s.bookings.length, 1);
});
test('confirmed cancellation survives availability-refresh failure without claiming a free slot', async () => {
  const s = await cancellationScreen(); s.press('Confirm cancellation');
  s.bookings[0].resolve({ ...cancellable, room_id: 'real-room', status: 'cancelled' }); await s.settle();
  s.calls[1].resolve([{ ...cancellable, status: 'cancelled' }]); await s.settle();
  s.calls[2].reject(new Error('offline')); await s.settle();
  assert.match(s.text(), /cancelled successfully, but availability could not be refreshed/);
  assert.doesNotMatch(s.text(), /interval is available again/);
});

function cancellationService({ user = 'student-a', role = 'student', sessionUser = user, owner = user,
  status = 'active', starts_at = cancellable.starts_at, rpcError = null, returnedStatus = 'cancelled' } = {}) {
  const calls = [], filters = [];
  const row = { ...cancellable, student_id: owner, room_id: 'room-x', status, starts_at };
  const client = {
    auth: { getUser: async () => ({ data: { user: user ? { id: user } : null }, error: null }),
      getSession: async () => ({ data: { session: { user: { id: sessionUser } } }, error: null }) },
    from(table) {
      if (table === 'profiles') return { select: () => ({ eq: () => ({ single: async () => ({ data: { role }, error: null }) }) }) };
      assert.equal(table, 'reservations');
      const q = { select: () => q, eq: (...args) => { filters.push(args); return q; }, single: async () => ({ data: row, error: null }) };
      return q;
    },
    rpc: async (...args) => { calls.push(args); return { data: { ...row, status: returnedStatus }, error: rpcError }; },
  };
  return { calls, filters, service: compile('../src/services/database.ts', {
    '../availability': availability, '../lib/supabase': { requireSupabase: () => client },
  }) };
}
test('Student cancellation uses approved RPC signature and verified cancelled response', async () => {
  const s = cancellationService();
  assert.equal((await s.service.cancelOwnReservation('reservation-a', 'student-a')).status, 'cancelled');
  assert.equal(s.calls[0][0], 'cancel_reservation');
  assert.deepEqual(JSON.parse(JSON.stringify(s.calls[0][1])), { reservation_id: 'reservation-a' });
  assert.deepEqual(s.filters, [['id', 'reservation-a'], ['student_id', 'student-a']]);
});
test('Student cancellation rejects wrong owner, anonymous, admin, changed session, past and cancelled before RPC', async () => {
  for (const options of [{ user: null }, { role: 'administrator' }, { user: 'other' }, { owner: 'other' },
    { sessionUser: 'other' }, { status: 'cancelled' }, { starts_at: '2000-01-01T00:00Z' }]) {
    const s = cancellationService(options);
    await assert.rejects(s.service.cancelOwnReservation('reservation-a', 'student-a'));
    assert.equal(s.calls.length, 0);
  }
});
test('RPC race denial and invalid cancellation response never become service success', async () => {
  const race = cancellationService({ rpcError: { code: 'P0002' } });
  await assert.rejects(race.service.cancelOwnReservation('reservation-a', 'student-a'), e => e.code === 'P0002');
  const invalid = cancellationService({ returnedStatus: 'active' });
  await assert.rejects(invalid.service.cancelOwnReservation('reservation-a', 'student-a'));
});

test('cancellation refresh does not claim availability when another booking occupies the interval', async () => {
  const s = await cancellationScreen(); s.press('Confirm cancellation');
  assert.doesNotMatch(s.text(), /No upcoming or ongoing reservations/);
  s.bookings[0].resolve({ ...cancellable, room_id: 'real-room', status: 'cancelled' }); await s.settle();
  s.calls[1].resolve([{ ...cancellable, status: 'cancelled' }]); await s.settle();
  s.calls[2].resolve([{ starts_at: cancellable.starts_at, ends_at: cancellable.ends_at }]); await s.settle();
  assert.match(s.text(), /Another active reservation now occupies/);
  assert.doesNotMatch(s.text(), /interval is available again/);
});

test('old-account cancellation completion cannot show success or refresh private details for new account', async () => {
  const s = await cancellationScreen(); s.press('Confirm cancellation');
  s.room('other-student');
  s.calls[1].resolve([]); await s.settle();
  s.bookings[0].resolve({ ...cancellable, room_id: 'private-room', status: 'cancelled' }); await s.settle();
  assert.doesNotMatch(s.text(), /cancelled successfully|private-room/);
  assert.equal(s.calls.length, 2);
});
