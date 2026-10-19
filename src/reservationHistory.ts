export type OwnReservation = {
  id: string;
  roomName: string;
  starts_at: string;
  ends_at: string;
  status: 'active' | 'cancelled';
};

export function canCancelReservation(row: OwnReservation, now = Date.now()): boolean {
  return row.status === 'active' && Date.parse(row.starts_at) > now;
}

export function groupReservations(rows: OwnReservation[], now: number) {
  const upcoming = rows.filter(row => Date.parse(row.ends_at) > now)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id.localeCompare(b.id));
  const past = rows.filter(row => Date.parse(row.ends_at) <= now)
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at) || a.id.localeCompare(b.id));
  return { upcoming, past };
}

export function reservationNote(row: OwnReservation, now: number): string {
  if (row.status === 'cancelled') return 'Cancelled - not a current booking';
  if (Date.parse(row.ends_at) <= now) return 'Reservation time has ended';
  if (Date.parse(row.starts_at) <= now) return 'Ongoing';
  return 'Upcoming';
}

const chicagoDateTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago', year: 'numeric', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});
export function formatReservationTime(instant: string): string {
  return chicagoDateTime.format(new Date(instant));
}
