import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Button, Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';
import { busyIntervals, reserveRoom, type Room } from './services/database';
import { chicagoToday, dailySlots, slotStatus, validateBusyIntervals, type BusyInterval, type Slot } from './availability';

export default function RoomAvailability({ room, onBack }: { room: Room; onBack: () => void }) {
  const [date, setDate] = useState(() => chicagoToday());
  const [result, setResult] = useState<{ slots: Slot[]; busy: BusyInterval[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const request = useRef(0);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [saving, setSaving] = useState(false);
  const [bookingMessage, setBookingMessage] = useState('');
  const submitting = useRef(false);
  const context = useRef(0);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') {
        setNow(Date.now());
        request.current++;
        setResult(null);
        setLoading(false);
        setSelected(null);
      }
    });
    return () => { clearInterval(timer); listener.remove(); request.current++; context.current++; };
  }, []);

  const load = useCallback(async () => {
    const current = ++request.current;
    setResult(null);
    setSelected(null);
    setError('');
    setLoading(false);
    let slots: Slot[];
    try { slots = dailySlots(date.trim()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Invalid date.'); return; }
    setLoading(true);
    try {
      const data = await busyIntervals(room.id, new Date(slots[0].start).toISOString(), new Date(slots[11].end).toISOString());
      const busy = validateBusyIntervals(data);
      if (current !== request.current) return;
      setNow(Date.now());
      setResult({ slots, busy });
    } catch {
      if (current === request.current) setError('Availability could not be loaded. Check your connection and tap Show availability to retry. You may need to sign in again.');
    } finally { if (current === request.current) setLoading(false); }
  }, [room.id, date]);

  useEffect(() => {
    // Debounce date entry, invalidating the previous request immediately.
    request.current++;
    context.current++;
    setSelected(null);
    setBookingMessage('');
    setResult(null);
    setError('');
    setLoading(true);
    const timer = setTimeout(() => void load(), 400);
    return () => { clearTimeout(timer); request.current++; };
  }, [load]);

  async function confirmReservation() {
    if (submitting.current || !selected || !result) return;
    if (slotStatus(selected, result.busy, Date.now()) !== 'Available' ||
      !result.slots.some(slot => slot.start === selected.start && slot.end === selected.end)) {
      setSelected(null);
      setBookingMessage('That slot is no longer available or has already started. Refresh and choose another time.');
      return;
    }
    submitting.current = true;
    setSaving(true);
    const currentContext = context.current;
    const slot = selected;
    setSelected(null);
    setBookingMessage('');
    // Invalidate outstanding reads; never retain selectable results after a write attempt.
    request.current++;
    setResult(null);
    try {
      await reserveRoom(room.id, new Date(slot.start).toISOString(), new Date(slot.end).toISOString());
      if (currentContext !== context.current) return;
      setBookingMessage(`Reservation saved: ${room.name}, ${date.trim()}, ${slot.label} America/Chicago.`);
      await load();
    } catch (failure) {
      if (currentContext !== context.current) return;
      const code = (failure as { code?: string } | null)?.code;
      if (code === '23P01') {
        setBookingMessage('That slot is no longer available. Another reservation overlaps it. Please choose another time.');
        await load();
      } else if (code === 'AUTH_REQUIRED' || code === '42501') {
        setBookingMessage('Reservation not permitted. Sign in as a Student and refresh availability.');
      } else if (code === 'INVALID_SLOT') {
        setBookingMessage('Choose a future one-hour slot during Chicago booking hours.');
      } else {
        setBookingMessage('We could not confirm the reservation. It may have been saved if the connection failed after submission. Refresh availability before retrying; an occupied slot alone does not confirm ownership.');
      }
    } finally {
      submitting.current = false;
      if (currentContext === context.current) setSaving(false);
    }
  }

  const available = result?.slots.filter(slot => slotStatus(slot, result.busy, now) === 'Available').length;
  return <View style={styles.container}>
    <Button title="Back to room search" disabled={saving} onPress={onBack} />
    <Text accessibilityRole="header" style={styles.heading}>{room.name}: availability</Text>
    <Text style={styles.text}>Selected date: {date.trim() || 'Choose a date'}</Text>
    <Text style={styles.text}>All dates and times are America/Chicago (Central Time). Monday through Sunday: 9 AM to 9 PM, in one-hour slots.</Text>
    <Text style={styles.text}>Calendar date (YYYY-MM-DD)</Text>
    <TextInput accessibilityLabel="Calendar date YYYY-MM-DD" value={date} placeholder="YYYY-MM-DD"
      editable={!saving} autoCorrect={false} autoCapitalize="none" style={styles.input} onChangeText={value => {
        if (submitting.current) return;
        setSelected(null); setBookingMessage(''); context.current++;
        request.current++; setDate(value); setResult(null); setError(''); setLoading(false);
      }} />
    <Button title={loading ? 'Loading availability...' : 'Show availability'} disabled={loading || saving} onPress={() => { Keyboard.dismiss(); void load(); }} />
    {saving && <Text style={styles.text}>Saving reservation. Please wait...</Text>}
    {bookingMessage ? <Text accessibilityRole="alert" style={styles.text}>{bookingMessage}</Text> : null}
    {selected && <View style={styles.slot}>
      <Text accessibilityRole="header" style={styles.heading}>Confirm reservation</Text>
      <Text style={styles.text}>{room.name} — {date.trim()}</Text>
      <Text style={styles.text}>{selected.label} America/Chicago (60 minutes)</Text>
      <Text style={styles.text}>Availability will be checked by the database when you confirm.</Text>
      <Button title="Confirm reservation" disabled={saving || selected.start <= now} onPress={() => void confirmReservation()} />
      <Button title="Dismiss confirmation" disabled={saving} onPress={() => setSelected(null)} />
    </View>}
    {loading && <ActivityIndicator accessibilityLabel="Loading availability" />}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {!result && !loading && !error && <Text style={styles.text}>Choose a date and tap Show availability.</Text>}
    {result && <>
      <Text style={styles.text}>{available ? `${available} available slot(s).` : 'No future available slots on this date. Try another date.'}</Text>
      <Text style={styles.text}>Availability is a snapshot. Refresh with Show availability. Viewing does not reserve a room.</Text>
      {result.slots.map(slot => {
        const status = slotStatus(slot, result.busy, now);
        return <View key={slot.start} style={styles.slot}>
          <Text style={styles.text}>{slot.label}</Text>
          <Text style={[styles.text, status === 'Available' ? styles.available : styles.unavailable]}>
            {status === 'Available' ? 'Available' : `${status} - unavailable`}
          </Text>
          {status === 'Available' && <Button title={`Reserve ${slot.label}`} disabled={saving || loading}
            onPress={() => { if (!submitting.current) { setSelected(slot); setBookingMessage(''); } }} />}
        </View>;
      })}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  container: { gap: 12, marginTop: 20 },
  heading: { fontSize: 22, fontWeight: '700', color: '#17324d' },
  text: { fontSize: 16, color: '#17324d' },
  input: { borderWidth: 1, borderColor: '#64748b', padding: 12, borderRadius: 6, fontSize: 16, backgroundColor: '#fff' },
  slot: { gap: 6, padding: 14, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, backgroundColor: '#fff' },
  available: { color: '#166534', fontWeight: '600' },
  unavailable: { color: '#555' },
  error: { color: '#9f1239', fontSize: 16 },
});
