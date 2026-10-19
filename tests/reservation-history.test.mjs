import test from 'node:test';
import assert from 'node:assert/strict';
import { canCancelReservation, groupReservations, reservationNote, formatReservationTime } from '../src/reservationHistory.ts';

const row = (id, start, end, status = 'active') => ({ id, roomName: 'Fixture only', starts_at: start, ends_at: end, status });
const now = Date.parse('2027-07-15T16:00:00Z');
test('cancellation eligibility ends exactly at start, irrespective of phone timezone', () => {
  const r = row('r', '2027-07-15T16:00:00Z', '2027-07-15T17:00:00Z');
  assert.equal(canCancelReservation(r, now - 1), true);
  assert.equal(canCancelReservation(r, now), false);
  assert.equal(canCancelReservation(r, now + 1), false);
  assert.equal(canCancelReservation({ ...r, status: 'cancelled' }, now - 1), false);
});
test('end-time cutoff, ongoing placement and opposite chronological sorting', () => {
  const rows = [row('future2', '2027-07-15T18:00Z', '2027-07-15T19:00Z'),
    row('old', '2027-07-14T14:00Z', '2027-07-14T15:00Z'),
    row('ongoing', '2027-07-15T15:30Z', '2027-07-15T16:30Z'),
    row('boundary', '2027-07-15T15:00Z', '2027-07-15T16:00Z'),
    row('future1', '2027-07-15T17:00Z', '2027-07-15T18:00Z')];
  const snapshot = JSON.stringify(rows);
  const grouped = groupReservations(rows, now);
  assert.deepEqual(grouped.upcoming.map(r => r.id), ['ongoing', 'future1', 'future2']);
  assert.deepEqual(grouped.past.map(r => r.id), ['boundary', 'old']);
  assert.equal(reservationNote(rows[2], now), 'Ongoing');
  assert.equal(JSON.stringify(rows), snapshot);
});
test('cancelled records retain actual status in both sections; no completed status', () => {
  const future = row('f', '2027-07-15T17:00Z', '2027-07-15T18:00Z', 'cancelled');
  const past = row('p', '2027-07-14T17:00Z', '2027-07-14T18:00Z', 'cancelled');
  const grouped = groupReservations([future, past], now);
  assert.equal(grouped.upcoming[0].status, 'cancelled');
  assert.equal(grouped.past[0].status, 'cancelled');
  assert.match(reservationNote(future, now), /not a current booking/);
  assert.match(reservationNote(past, now), /Cancelled/);
});
test('Chicago formatting covers summer, winter and UTC date rollover', () => {
  assert.match(formatReservationTime('2027-07-15T14:00:00Z'), /9:00/);
  assert.match(formatReservationTime('2027-01-15T15:00:00Z'), /9:00/);
  assert.match(formatReservationTime('2027-07-16T01:00:00Z'), /Jul 15, 2027/);
  assert.match(formatReservationTime('2027-07-16T01:00:00Z'), /8:00/);
});
test('time crossing moves an ongoing record into Past without changing its status', () => {
  const r = row('ongoing', '2027-07-15T15:00Z', '2027-07-15T16:00Z');
  assert.equal(groupReservations([r], now - 1).upcoming.length, 1);
  assert.equal(groupReservations([r], now).past[0].status, 'active');
  assert.deepEqual(groupReservations([], now), { upcoming: [], past: [] });
});
