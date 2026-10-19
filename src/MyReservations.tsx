import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Button, StyleSheet, Text, View } from 'react-native';
import { busyIntervals, cancelOwnReservation, listOwnReservations } from './services/database';
import { validateBusyIntervals } from './availability';
import { canCancelReservation, formatReservationTime, groupReservations, reservationNote, type OwnReservation } from './reservationHistory';

export default function MyReservations({ studentId, onBack }: { studentId: string; onBack: () => void }) {
  const [rows, setRows] = useState<OwnReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const request = useRef(0);
  const [selected, setSelected] = useState<OwnReservation | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [message, setMessage] = useState('');
  const locked = useRef(false);
  const lifecycle = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    setRows([]); setLoading(true); setError('');
    setSelected(null);
    try {
      const data = await listOwnReservations(studentId);
      if (current === request.current) { setRows(data); setNow(Date.now()); }
    } catch {
      if (current === request.current) setError('Your reservations could not be loaded. Check your connection and tap Refresh reservations. If this continues, sign out and sign in again.');
    } finally { if (current === request.current) setLoading(false); }
  }, [studentId]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const listener = AppState.addEventListener('change', state => { if (state === 'active' && !locked.current) void load(); });
    return () => { lifecycle.current++; request.current++; clearInterval(timer); listener.remove(); };
  }, [load]);

  async function confirmCancellation() {
    if (locked.current || !selected) return;
    if (!canCancelReservation(selected, Date.now())) {
      setSelected(null);
      setMessage('This reservation has started or is no longer active. Refresh your reservations.');
      return;
    }
    locked.current = true;
    setCancelling(true);
    const row = selected;
    const version = lifecycle.current;
    setSelected(null); setMessage('');
    request.current++; setRows([]); setLoading(true); setError('');
    try {
      const cancelled = await cancelOwnReservation(row.id, studentId);
      if (version !== lifecycle.current) return;
      setMessage('Reservation cancelled successfully. Refreshing availability...');
      await load();
      if (version !== lifecycle.current) return;
      try {
        const busy = validateBusyIntervals(await busyIntervals(cancelled.room_id, cancelled.starts_at, cancelled.ends_at));
        if (version !== lifecycle.current) return;
        const occupied = busy.some(interval => Date.parse(interval.starts_at) < Date.parse(cancelled.ends_at) &&
          Date.parse(interval.ends_at) > Date.parse(cancelled.starts_at));
        setMessage(occupied ? 'Reservation cancelled successfully. Another active reservation now occupies this interval.'
          : Date.parse(cancelled.starts_at) <= Date.now() ? 'Reservation cancelled successfully. The interval has now started.'
          : 'Reservation cancelled successfully. The interval is available again as of this refresh.');
      } catch {
        if (version === lifecycle.current) setMessage('Reservation cancelled successfully, but availability could not be refreshed. Open room availability and retry.');
      }
    } catch (failure) {
      if (version !== lifecycle.current) return;
      const code = (failure as { code?: string } | null)?.code;
      setMessage(code === 'P0002' || code === 'PGRST116'
        ? 'Cancellation was not accepted. The reservation may have started, already been cancelled, or no longer be accessible.'
        : code === '42501' || code === 'AUTH_REQUIRED'
          ? 'Cancellation not permitted. Sign in as the Student who owns this reservation.'
          : 'Cancellation could not be confirmed. If the connection failed after submission, it may have succeeded. Refresh and check the stored status before retrying.');
      await load();
    } finally {
      locked.current = false;
      if (version === lifecycle.current) setCancelling(false);
    }
  }

  const { upcoming, past } = groupReservations(rows, now);
  function section(title: string, items: OwnReservation[], empty: string) {
    return <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>{title} ({items.length})</Text>
      {items.length === 0 && <Text style={styles.text}>{empty}</Text>}
      {items.map(row => <View key={row.id} style={styles.card}>
        <Text style={styles.room}>{row.roomName}</Text>
        <Text style={styles.text}>Start: {formatReservationTime(row.starts_at)}</Text>
        <Text style={styles.text}>End: {formatReservationTime(row.ends_at)}</Text>
        <Text style={styles.text}>Stored status: {row.status}</Text>
        <Text style={styles.text}>{reservationNote(row, now)}</Text>
        {canCancelReservation(row, now) && <Button title="Cancel Reservation" disabled={cancelling}
          onPress={() => { if (!locked.current) { setSelected(row); setMessage(''); } }} />}
      </View>)}
    </View>;
  }
  return <View style={styles.section}>
    <Button title="Back to room search" disabled={cancelling} onPress={onBack} />
    <Text accessibilityRole="header" style={styles.heading}>My Reservations</Text>
    <Text style={styles.text}>All times are America/Chicago. Upcoming includes ongoing reservations and future cancelled entries. Past means the reservation time has ended; stored status is unchanged.</Text>
    <Button title="Refresh reservations" disabled={loading || cancelling} onPress={() => void load()} />
    {cancelling && <Text style={styles.text}>Processing cancellation. Please wait...</Text>}
    {message ? <Text accessibilityRole="alert" style={styles.text}>{message}</Text> : null}
    {selected && <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>Cancel this reservation?</Text>
      <Text style={styles.room}>{selected.roomName}</Text>
      <Text style={styles.text}>Start: {formatReservationTime(selected.starts_at)}</Text>
      <Text style={styles.text}>End: {formatReservationTime(selected.ends_at)}</Text>
      <Text style={styles.text}>Times are America/Chicago. Confirming changes the stored status to cancelled.</Text>
      {!canCancelReservation(selected, now) && <Text style={styles.error}>This reservation is no longer eligible for cancellation.</Text>}
      <Button title="Confirm cancellation" disabled={cancelling || !canCancelReservation(selected, now)} onPress={() => void confirmCancellation()} />
      <Button title="Keep reservation" disabled={cancelling} onPress={() => setSelected(null)} />
    </View>}
    {loading ? <ActivityIndicator accessibilityLabel="Loading your reservations" /> : error
      ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      : <>
        {section('Upcoming', upcoming, 'No upcoming or ongoing reservations.')}
        {section('Past', past, 'No past reservations yet.')}
      </>}
  </View>;
}

const styles = StyleSheet.create({
  section: { marginTop: 18, gap: 12 },
  heading: { color: '#17324d', fontSize: 22, fontWeight: '700' },
  room: { color: '#17324d', fontSize: 18, fontWeight: '600' },
  text: { color: '#40566b', fontSize: 16 },
  card: { gap: 8, padding: 16, borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#fff' },
  error: { color: '#9f1239', fontSize: 16 },
});
