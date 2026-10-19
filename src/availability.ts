export const ROOM_TIME_ZONE = 'America/Chicago';
export type BusyInterval = { starts_at: string; ends_at: string };
export type Slot = { start: number; end: number; label: string };

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ROOM_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
function parts(time: number) {
  return Object.fromEntries(partsFormatter.formatToParts(time).map(part => [part.type, part.value]));
}
export function chicagoToday(now = Date.now()): string {
  const p = parts(now);
  return `${p.year}-${p.month}-${p.day}`;
}

// Resolve each Chicago wall-clock boundary via Intl, not the phone's zone or a fixed UTC offset.
function chicagoHour(year: number, month: number, day: number, hour: number): number {
  const wall = Date.UTC(year, month - 1, day, hour);
  let instant = wall;
  for (let attempt = 0; attempt < 4; attempt++) {
    const p = parts(instant);
    const represented = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    const difference = wall - represented;
    if (difference === 0) return instant;
    instant += difference;
  }
  throw new Error('Unable to resolve Chicago time.');
}

export function dailySlots(date: string): Slot[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Enter a calendar date as YYYY-MM-DD.');
  const [year, month, day] = date.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (year < 100 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error('Enter a valid calendar date as YYYY-MM-DD.');
  }
  const label = (hour: number) => `${hour % 12 || 12}:00 ${hour < 12 ? 'AM' : 'PM'}`;
  return Array.from({ length: 12 }, (_, i) => ({
    start: chicagoHour(year, month, day, i + 9),
    end: chicagoHour(year, month, day, i + 10),
    label: `${label(i + 9)} - ${label(i + 10)}`,
  }));
}

export function validateBusyIntervals(data: unknown): BusyInterval[] {
  if (!Array.isArray(data) || data.some(interval => !interval ||
    typeof interval.starts_at !== 'string' || typeof interval.ends_at !== 'string' ||
    !Number.isFinite(Date.parse(interval.starts_at)) || !Number.isFinite(Date.parse(interval.ends_at)) ||
    Date.parse(interval.ends_at) <= Date.parse(interval.starts_at))) {
    throw new Error('Invalid availability response.');
  }
  return data;
}

export function slotStatus(slot: Slot, busy: BusyInterval[], now: number): 'Past' | 'Occupied' | 'Available' {
  if (slot.start <= now) return 'Past';
  return busy.some(interval => Date.parse(interval.starts_at) < slot.end && Date.parse(interval.ends_at) > slot.start)
    ? 'Occupied' : 'Available';
}

export function validateBookingInterval(startsAt: string, endsAt: string, now = Date.now()): void {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= now ||
    !dailySlots(chicagoToday(start)).some(slot => slot.start === start && slot.end === end)) {
    throw Object.assign(new Error('Choose a future one-hour slot between 9 AM and 9 PM America/Chicago.'), { code: 'INVALID_SLOT' });
  }
}
