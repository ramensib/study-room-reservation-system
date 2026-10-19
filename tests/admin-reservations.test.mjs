import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const row = (student_id, status = 'active') => ({ id: student_id, student_id, status,
  starts_at: '2026-11-01T15:00:00Z', ends_at: '2026-11-01T16:00:00Z', rooms: { name: 'Library 101' } });
function service({ role = 'administrator', user = 'admin', session = 'admin', data = [row('student-a'), row('student-b', 'cancelled')], error = null, status = 'active', rpcError = null, invalidResponse = false } = {}) {
  const calls = [];
  const record = { ...row('student-a', status), room_id: 'room-a', starts_at: '2020-07-01T14:00:00Z', ends_at: '2020-07-01T15:00:00Z' };
  const client = { rpc: async (...args) => { calls.push(['rpc', ...args]); return { data: invalidResponse ? {} : { ...record, status: 'cancelled' }, error: rpcError }; }, auth: {
    getUser: async () => ({ data: { user: { id: user } } }),
    getSession: async () => ({ data: { session: { user: { id: session } } } }),
  }, from(table) {
    if (table === 'profiles') return { select: () => ({ eq: () => ({ single: async () => ({ data: { role } }) }) }) };
    calls.push(['table', table]);
    const query = { select(fields) { calls.push(['select', fields]); return query; },
      eq(field, value) { calls.push(['eq', field, value]); return query; },
      single: async () => ({ data: record, error }),
      order(field) { calls.push(['order', field]); return query; },
      range(start, end) { calls.push(['range', start, end]); return Promise.resolve({ data, error }); } };
    return query; // No insert/update/delete/eq methods: unexpected operations fail.
  } };
  const exports = {};
  const source = readFileSync(new URL('../src/services/database.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: name => name === '../lib/supabase' ? { requireSupabase: () => client } : {} });
  return { calls, load: exports.listAllReservations, cancel: exports.cancelAdminReservation };
}
test('admin cancellation uses exact invoker RPC and permits another Students past active reservation', async () => {
  const s = service(); const result = await s.cancel('student-a', 'admin');
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(JSON.parse(JSON.stringify(s.calls.at(-1))), ['rpc', 'cancel_reservation', { reservation_id: 'student-a' }]);
  assert.deepEqual(s.calls.filter(c => c[0] === 'eq'), [['eq', 'id', 'student-a']]);
});
test('admin cancellation denies Student, wrong account, changed session and cancelled records before RPC', async () => {
  for (const options of [{ role: 'student' }, { user: null }, { session: 'student' }, { status: 'cancelled' }]) {
    const s = service(options); await assert.rejects(s.cancel('student-a', 'admin'));
    assert.ok(!s.calls.some(c => c[0] === 'rpc'));
  }
});
test('admin cancellation propagates stale status, permission and network errors and rejects unconfirmed responses', async () => {
  for (const code of ['P0002', '42501', 'NETWORK']) {
    const error = { code }; await assert.rejects(service({ rpcError: error }).cancel('student-a', 'admin'), e => e === error);
  }
  await assert.rejects(service({ invalidResponse: true }).cancel('student-a', 'admin'));
});
test('admin reads multiple Students, both stored statuses and room names without ownership filters', async () => {
  const s = service(); const rows = await s.load('admin');
  assert.deepEqual(Array.from(rows, r => r.studentId), ['student-a', 'student-b']);
  assert.deepEqual(Array.from(rows, r => r.status), ['active', 'cancelled']);
  assert.equal(rows[0].roomName, 'Library 101');
  assert.deepEqual(s.calls.filter(c => c[0] === 'order'), [['order', 'starts_at'], ['order', 'id']]);
});
test('Student and changed-account requests are rejected before reservation retrieval', async () => {
  for (const options of [{ role: 'student' }, { user: 'student-a' }]) {
    const s = service(options); await assert.rejects(s.load('admin')); assert.equal(s.calls.length, 0);
  }
});
test('admin page range is bounded and offset is validated', async () => {
  const s = service(); await s.load('admin', 50);
  assert.deepEqual(s.calls.at(-1), ['range', 50, 99]);
  await assert.rejects(s.load('admin', -1));
});
test('changed session discards fetched admin data', async () => {
  await assert.rejects(service({ session: 'student-b' }).load('admin'), /Session changed/);
});
test('database errors and malformed data are not returned as empty success', async () => {
  const error = { code: '42501' };
  await assert.rejects(service({ error }).load('admin'), e => e === error);
  await assert.rejects(service({ data: null }).load('admin'));
  await assert.rejects(service({ data: [row('a', 'completed')] }).load('admin'));
});
