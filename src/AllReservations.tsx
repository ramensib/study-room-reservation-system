import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { busyIntervals, cancelAdminReservation, listAllReservations, type AdminReservation } from './services/database';
import { formatReservationTime } from './reservationHistory';

export default function AllReservations({ adminId, onBack }: { adminId: string; onBack: () => void }) {
  const [rows, setRows] = useState<AdminReservation[]>([]);
  const [offset, setOffset] = useState(0);
  const [ended, setEnded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = useRef(0);
  const lifetime = useRef(0);
  const locked = useRef(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<AdminReservation | null>(null);
  const [notice, setNotice] = useState('');
  const load = useCallback(async (pageOffset = 0) => {
    const token = ++request.current;
    setLoading(true); setError(''); setRows([]); setEnded(false); setSelected(null);
    try {
      const page = await listAllReservations(adminId, pageOffset);
      if (token !== request.current) return;
      setRows(page); setOffset(pageOffset);
      // Request until an empty page: even a server cap below 50 cannot hide records.
      setEnded(page.length === 0);
    } catch {
      if (token === request.current) setError('Reservations could not be loaded. Check your connection and Administrator access, then refresh.');
    } finally { if (token === request.current) setLoading(false); }
  }, [adminId]);
  useEffect(() => {
    ++lifetime.current;
    locked.current = false; setSaving(false); setNotice('');
    void load();
    const listener = AppState.addEventListener('change', state => { if (state === 'active' && !locked.current) void load(); });
    return () => { ++request.current; ++lifetime.current; listener.remove(); };
  }, [load]);
  async function confirmCancellation() {
    if (!selected || selected.status !== 'active' || locked.current) return;
    locked.current = true; setSaving(true); setNotice('');
    const generation = lifetime.current;
    try {
      const cancelled = await cancelAdminReservation(selected.id, adminId);
      if (generation !== lifetime.current) return;
      setSelected(null); setNotice('Reservation cancelled. The record has been preserved.');
      await load(offset);
      if (generation !== lifetime.current) return;
      if (Date.parse(cancelled.ends_at) > Date.now()) {
        try {
          await busyIntervals(cancelled.room_id, cancelled.starts_at, cancelled.ends_at);
        } catch {
          if (generation === lifetime.current) setNotice('Reservation cancelled, but availability could not be refreshed. Refresh room availability before booking; the slot is not guaranteed free.');
        }
      }
    } catch (failure) {
      if (generation !== lifetime.current) return;
      const code = (failure as { code?: string })?.code;
      setNotice(code === 'P0002' ? 'This reservation is no longer active or cancellation is not permitted. The list has been requested again.'
        : code === '42501' || code === 'AUTH_REQUIRED' ? 'Cancellation denied. Check your Administrator access.'
        : 'Cancellation could not be confirmed. It may have reached the server. Refresh and check the status before trying again.');
      setSelected(null); await load(offset);
    } finally {
      if (generation === lifetime.current) { locked.current = false; setSaving(false); }
    }
  }
  return <ScrollView contentContainerStyle={styles.container}>
    <View style={styles.content}>
      <Text accessibilityRole="header" style={styles.heading}>All Reservations</Text>
      <Text>Earliest start first, including cancelled records. All times America/Chicago. Only cancel a reservation you have determined is invalid.</Text>
      <Button title="Back to room management" disabled={saving} onPress={onBack} />
      <Button title="Refresh reservations" disabled={saving} onPress={() => { setNotice(''); void load(); }} />
      {notice ? <Text accessibilityRole="alert">{notice}</Text> : null}
      {selected ? <View style={styles.card}>
        <Text style={styles.name}>Confirm invalid reservation cancellation</Text>
        <Text>{selected.roomName}</Text>
        <Text>Student ID: {selected.studentId}</Text>
        <Text>Start: {formatReservationTime(selected.starts_at)}</Text>
        <Text>End: {formatReservationTime(selected.ends_at)}</Text>
        <Text>Status: {selected.status}</Text>
        <Button title={saving ? 'Cancelling...' : 'Confirm cancellation'} disabled={saving} onPress={() => void confirmCancellation()} />
        <Button title="Keep reservation" disabled={saving} onPress={() => setSelected(null)} />
      </View> : null}
      {loading ? <ActivityIndicator accessibilityLabel="Loading reservations" /> : error
        ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
        : <>
          {ended ? <Text>{offset === 0 ? 'No reservations found.' : 'End of reservations. Refresh to check for changes.'}</Text>
            : <Text>Showing records {offset + 1}–{offset + rows.length}. Next page continues the list.</Text>}
          {rows.map(row => <View key={row.id} style={styles.card}>
            <Text style={styles.name}>{row.roomName}</Text>
            <Text selectable>Student ID: {row.studentId}</Text>
            <Text>Start: {formatReservationTime(row.starts_at)}</Text>
            <Text>End: {formatReservationTime(row.ends_at)}</Text>
            <Text style={row.status === 'cancelled' ? styles.cancelled : styles.active}>Status: {row.status}</Text>
            {row.status === 'active' && <Button title="Cancel invalid reservation" disabled={saving} onPress={() => { setNotice(''); setSelected(row); }} />}
            {row.status === 'cancelled' ? <Text>Cancelled — not an active booking</Text> : null}
          </View>)}
          {!ended && <Button title="Next page" disabled={saving} onPress={() => void load(offset + rows.length)} />}
        </>}
    </View>
  </ScrollView>;
}
const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, backgroundColor: '#f5f7fb' },
  content: { width: '100%', maxWidth: 520, alignSelf: 'center', gap: 12 },
  heading: { fontSize: 26, fontWeight: '700', color: '#17324d' },
  card: { padding: 16, gap: 8, backgroundColor: 'white', borderRadius: 8 },
  name: { fontSize: 20, fontWeight: '600' },
  active: { color: '#166534', fontWeight: '600' },
  cancelled: { color: '#6b455b', fontWeight: '600' },
  error: { color: '#9f1239' },
});
