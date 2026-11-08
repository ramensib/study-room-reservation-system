import { Button } from './ui';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { searchRooms, type Room } from './services/database';
import { SUPPORTED_FEATURES } from './roomFeatures';
import RoomAvailability from './RoomAvailability';
import MyReservations from './MyReservations';

// Rendered inside the authenticated Student's existing scrollable screen.
export default function RoomSearch({ studentId }: { studentId: string }) {
  const [showReservations, setShowReservations] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [capacity, setCapacity] = useState('');
  const [features, setFeatures] = useState<string[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  useEffect(() => {
    void search('', []);
    return () => { request.current++; };
  }, []);

  function invalidate() {
    request.current++;
    setLoading(false);
    setSearched(false);
    setRooms([]);
    setError('');
  }

  async function search(capacityValue = capacity, selectedFeatures = features) {
    Keyboard.dismiss();
    invalidate();
    const text = capacityValue.trim();
    const minimum = text === '' ? 1 : Number(text);
    if (text !== '' && (!/^\d+$/.test(text) || !Number.isSafeInteger(minimum) || minimum < 1 || minimum > 2147483647)) {
      setError('Enter a positive whole-number capacity up to 2147483647, or leave it blank for any capacity.');
      return;
    }
    const current = request.current;
    setLoading(true);
    try {
      const matches = await searchRooms(minimum, selectedFeatures);
      if (current !== request.current) return;
      setRooms(matches);
      setSearched(true);
    } catch {
      if (current === request.current) setError('Rooms could not be loaded. Check your connection and tap Search rooms to retry. If this continues, sign out and sign in again.');
    } finally {
      if (current === request.current) setLoading(false);
    }
  }

  if (showReservations) return <MyReservations key={studentId} studentId={studentId} onBack={() => setShowReservations(false)} />;
  if (selectedRoom) return <RoomAvailability key={selectedRoom.id} room={selectedRoom} onBack={() => setSelectedRoom(null)} />;

  return <View style={styles.section}>
    <Button variant="secondary" title="My Reservations" onPress={() => setShowReservations(true)} />
    <Text accessibilityRole="header" style={styles.heading}>Find a study room</Text>
    <Text style={styles.text}>A quiet corner or a group session. Find your space.</Text>
    <View style={styles.filters}>
    <Text style={styles.label}>Minimum capacity (optional)</Text>
    <TextInput accessibilityLabel="Minimum capacity" keyboardType="number-pad" value={capacity}
      placeholder="Any capacity" style={styles.input} onChangeText={value => { invalidate(); setCapacity(value); }} />
    <Text style={styles.label}>Required features (optional)</Text>
    <View style={styles.features}>
    {SUPPORTED_FEATURES.map(feature => <Pressable key={feature} accessibilityRole="checkbox"
      accessibilityLabel={feature} accessibilityState={{ checked: features.includes(feature) }}
      style={[styles.feature, features.includes(feature) && styles.featureSelected]} onPress={() => {
        invalidate();
        setFeatures(current => current.includes(feature) ? current.filter(value => value !== feature) : [...current, feature]);
      }}>
      <Text style={[styles.featureText, features.includes(feature) && styles.featureTextSelected]}>{features.includes(feature) ? '✓ ' : '+ '}{feature}</Text>
    </Pressable>)}
    </View>
    <Text style={styles.hint}>Results include every selected feature.</Text>
    <Button title={loading ? 'Searching...' : 'Search rooms'} disabled={loading} onPress={() => void search()} />
    <Button variant="secondary" title="Clear filters" onPress={() => { setCapacity(''); setFeatures([]); void search('', []); }} />
    </View>
    {loading && <ActivityIndicator accessibilityLabel="Searching rooms" />}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {!loading && !error && !searched && <Text style={styles.text}>Tap Search rooms to load matching rooms.</Text>}
    {searched && <Text accessibilityLiveRegion="polite" style={styles.label}>{rooms.length} matching room(s)</Text>}
    {searched && rooms.length === 0 && <Text style={styles.text}>No rooms match these filters. Lower the minimum capacity or remove required features, then search again.</Text>}
    {rooms.map(room => <View key={room.id} style={styles.room}>
      <Text style={styles.roomEyebrow}>STUDY SPACE</Text>
      <Text style={styles.roomName}>{room.name}</Text>
      <Text style={styles.seats}>{room.capacity} seats</Text>
      <Text style={styles.text}>Features: {room.features.length ? room.features.join(', ') : 'None listed'}</Text>
      <Button title={`View availability for ${room.name}`} onPress={() => setSelectedRoom(room)} />
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  section: { marginTop: 24, gap: 10 },
  heading: { fontSize: 28, fontWeight: '700', color: '#142D43' },
  label: { fontSize: 17, fontWeight: '600', color: '#142D43' },
  text: { fontSize: 16, lineHeight: 23, color: '#465D6E' },
  input: { padding: 12, borderWidth: 1, borderColor: '#A6B7C4', borderRadius: 14, backgroundColor: '#fff', fontSize: 16, lineHeight: 23 },
  filters: { padding: 18, gap: 12, backgroundColor: '#FFFFFF', borderRadius: 20, borderWidth: 1, borderColor: '#D5E0E7', marginVertical: 8 },
  features: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  feature: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: '#D5E0E7', backgroundColor: '#F3F6F8', maxWidth: '100%' },
  featureSelected: { backgroundColor: '#E3F3F1', borderColor: '#087F83' },
  featureText: { color: '#465D6E', fontSize: 14, fontWeight: '600', flexShrink: 1 },
  featureTextSelected: { color: '#07686B' },
  hint: { color: '#465D6E', fontSize: 13, lineHeight: 19 },
  room: { padding: 20, gap: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#D5E0E7', borderRadius: 20, marginBottom: 4 },
  roomEyebrow: { fontSize: 10, letterSpacing: 1.5, color: '#087F83', fontWeight: '700' },
  roomName: { color: '#142D43', fontSize: 23, fontWeight: '700' },
  seats: { color: '#07686B', backgroundColor: '#E3F3F1', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, fontWeight: '600' },
  error: { color: '#A52B45', fontSize: 16, lineHeight: 23 },
});
