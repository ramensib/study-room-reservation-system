import test from 'node:test';
import assert from 'node:assert/strict';
import { dailySlots, chicagoToday, slotStatus, validateBusyIntervals } from '../src/availability.ts';

test('12 adjacent hourly Chicago slots, winter and summer offsets', () => {
  for (const [day, utcHour] of [['2026-01-15', 15], ['2026-07-15', 14], ['2026-03-08', 14], ['2026-11-01', 15]]) {
    const slots = dailySlots(day);
    assert.equal(slots.length, 12);
    assert.equal(new Date(slots[0].start).getUTCHours(), utcHour);
    assert.equal(slots[0].label, '9:00 AM - 10:00 AM');
    assert.equal(slots[11].label, '8:00 PM - 9:00 PM');
    slots.forEach((slot, i) => {
      assert.equal(slot.end - slot.start, 3600000);
      if (i) assert.equal(slots[i - 1].end, slot.start);
    });
  }
});
test('Chicago date independent of UTC date; rejects nonexistent dates', () => {
  assert.equal(chicagoToday(Date.parse('2026-07-15T02:00:00Z')), '2026-07-14');
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '07/15/2026', '']) assert.throws(() => dailySlots(date));
  assert.equal(dailySlots('2028-02-29').length, 12);
});
test('complete overlap logic and non-overlapping adjacency', () => {
  const slot = dailySlots('2026-07-15')[0];
  const interval = (a, b) => [{ starts_at: new Date(slot.start + a * 60000).toISOString(), ends_at: new Date(slot.start + b * 60000).toISOString() }];
  for (const [a,b] of [[0,60], [-30,30], [30,90], [10,20], [-60,120]]) {
    assert.equal(slotStatus(slot, interval(a,b), 0), 'Occupied');
  }
  for (const [a,b] of [[-60,0], [60,120]]) assert.equal(slotStatus(slot, interval(a,b), 0), 'Available');
  assert.equal(slotStatus(slot, [], 0), 'Available');
  assert.equal(slotStatus(slot, [], slot.start), 'Past');
  assert.equal(slotStatus(slot, [], slot.start + 1), 'Past');
});
test('malformed RPC response fails closed instead of showing free slots', () => {
  assert.deepEqual(validateBusyIntervals([]), []);
  for (const value of [null, {}, [null], [{ starts_at: 'bad', ends_at: 'bad' }], [{ starts_at: '2026-01-01', ends_at: '2025-01-01' }]]) {
    assert.throws(() => validateBusyIntervals(value));
  }
});

test('every weekday including Saturday and Sunday has twelve slots', () => {
  for (let day = 19; day <= 25; day++) assert.equal(dailySlots(`2026-10-${day}`).length, 12);
});

test('DST transition boundaries resolve to exact instants, not fixed offsets', () => {
  for (const [date, expected] of [
    ['2027-03-13', '2027-03-13T15:00:00.000Z'],
    ['2027-03-14', '2027-03-14T14:00:00.000Z'],
    ['2027-11-06', '2027-11-06T14:00:00.000Z'],
    ['2027-11-07', '2027-11-07T15:00:00.000Z'],
  ]) assert.equal(new Date(dailySlots(date)[0].start).toISOString(), expected);
});

test('10-11 AM blocks exactly one slot; 10:30-11:30 blocks exactly two', () => {
  const slots = dailySlots('2027-07-15');
  for (const [offset, expected] of [[0, [1]], [30, [1, 2]]]) {
    const start = slots[1].start + offset * 60000;
    const busy = [{ starts_at: new Date(start).toISOString(), ends_at: new Date(start + 3600000).toISOString() }];
    assert.deepEqual(slots.flatMap((slot, i) => slotStatus(slot, busy, 0) === 'Occupied' ? [i] : []), expected);
  }
});
