import { Button } from './ui';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Room, RoomInput } from './services/database';
import { addRoom, editRoom, listRooms } from './services/database';

import { SUPPORTED_FEATURES } from './roomFeatures';
import AllReservations from './AllReservations';

type Props = { adminId: string; onSignOut: () => void; busy: boolean };

function emptyDraft(): RoomInput {
  return { name: '', capacity: 1, features: [] };
}

function databaseMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('row-level security') || message.includes('permission')) {
    return 'The database denied this room change. Confirm that this account is an administrator.';
  }
  return 'The room could not be saved. Check your connection and try again.';
}

export default function RoomManagementScreen({ adminId, onSignOut, busy }: Props) {
  const [showReservations, setShowReservations] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RoomInput>(emptyDraft());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadRooms = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRooms(await listRooms());
    } catch {
      setError('Rooms could not be loaded. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadRooms(); }, [loadRooms]);

  function selectRoom(room: Room) {
    setSelectedId(room.id);
    setDraft({ name: room.name, capacity: room.capacity, features: [...room.features] });
    setMessage('');
    setError('');
  }

  function startNewRoom() {
    setSelectedId(null);
    setDraft(emptyDraft());
    setMessage('');
    setError('');
  }

  function toggleFeature(feature: string) {
    setDraft(current => ({
      ...current,
      features: current.features.includes(feature)
        ? current.features.filter(value => value !== feature)
        : [...current.features, feature],
    }));
  }

  async function saveRoom() {
    const name = draft.name.trim();
    const capacityText = String(draft.capacity).trim();
    const capacity = Number(capacityText);
    if (!name) { setError('Enter a room name or number.'); return; }
    if (!/^\d+$/.test(capacityText) || !Number.isInteger(capacity) || capacity <= 0) {
      setError('Capacity must be a positive whole number.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    const input = { name, capacity, features: draft.features };
    try {
      const saved = selectedId ? await editRoom(selectedId, input) : await addRoom(input);
      setRooms(current => selectedId
        ? current.map(room => room.id === selectedId ? saved as Room : room)
        : [...current, saved as Room].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedId((saved as Room).id);
      setDraft({ name: (saved as Room).name, capacity: (saved as Room).capacity, features: [...(saved as Room).features] });
      setMessage(selectedId ? 'Room updated successfully.' : 'Room added successfully.');
    } catch (saveError) {
      setError(databaseMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  if (showReservations) return <AllReservations key={adminId} adminId={adminId} onBack={() => setShowReservations(false)} />;
  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.eyebrow}>STUDY ROOM · TEAM DATA</Text>
        <Text accessibilityRole="header" style={styles.title}>Administrator</Text>
        <Text style={styles.subtitle}>Keep every study space ready.</Text>
        <Button variant="secondary" title="All Reservations" disabled={busy || saving} onPress={() => setShowReservations(true)} />
        <Button variant="secondary" title={busy ? 'Please wait…' : 'Sign out'} disabled={busy || saving} onPress={onSignOut} />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Existing rooms</Text>
          {loading ? <ActivityIndicator accessibilityLabel="Loading rooms" /> : rooms.length === 0
            ? <Text style={styles.muted}>No rooms have been added yet.</Text>
            : rooms.map(room => (
              <Pressable key={room.id} accessibilityRole="button" accessibilityLabel={`Edit ${room.name}`} accessibilityState={{ selected: room.id === selectedId, disabled: saving }} disabled={saving} style={[styles.room, room.id === selectedId && styles.selectedRoom]} onPress={() => selectRoom(room)}>
                <Text style={styles.roomName}>{room.name}</Text>
                <Text style={styles.roomDetails}>{room.capacity} seats{room.features.length ? ` • ${room.features.join(', ')}` : ''}</Text>
              </Pressable>
            ))}
          <Button title="Add a new room" onPress={startNewRoom} disabled={saving} />
          {!loading && <Button variant="secondary" title="Refresh rooms" onPress={() => void loadRooms()} disabled={saving} />}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{selectedId ? 'Edit room' : 'New room'}</Text>
          <Text style={styles.label}>Room name or number</Text>
          <TextInput accessibilityLabel="Room name or number" style={styles.input} value={draft.name}
            onChangeText={name => setDraft(current => ({ ...current, name }))} editable={!saving} />
          <Text style={styles.label}>Capacity</Text>
          <TextInput accessibilityLabel="Capacity" style={styles.input} value={String(draft.capacity)}
            onChangeText={capacity => setDraft(current => ({ ...current, capacity: capacity as unknown as number }))}
            keyboardType="number-pad" editable={!saving} />
          <Text style={styles.label}>Supported features (optional)</Text>
          {SUPPORTED_FEATURES.map(feature => {
            const selected = draft.features.includes(feature);
            return <Pressable key={feature} accessibilityRole="checkbox" accessibilityLabel={feature} accessibilityState={{ checked: selected, disabled: saving }} disabled={saving} style={[styles.feature, selected && styles.selectedFeature]} onPress={() => toggleFeature(feature)}>
              <Text style={styles.checkbox}>{selected ? '☑' : '☐'}</Text><Text>{feature}</Text>
            </Pressable>;
          })}
          <Button title={saving ? 'Saving…' : selectedId ? 'Save room changes' : 'Add room'} disabled={saving} onPress={() => void saveRoom()} />
          {message ? <Text accessibilityRole="alert" style={styles.success}>{message}</Text> : null}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20, backgroundColor: '#F3F6F8' },
  card: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingVertical: 20 },
  title: { color: '#142D43', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#465D6E', fontSize: 20, marginTop: 6, marginBottom: 16 },
  eyebrow: { color: '#087F83', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 10 },
  section: { marginTop: 24, padding: 18, borderWidth: 1, borderColor: '#D5E0E7', borderRadius: 22, backgroundColor: '#FFFFFF' },
  sectionTitle: { color: '#142D43', fontSize: 20, fontWeight: '700', marginBottom: 12 },
  room: { padding: 14, marginBottom: 8, borderRadius: 18, backgroundColor: '#fff', borderWidth: 1, borderColor: '#D5E0E7' },
  selectedRoom: { borderColor: '#087F83', backgroundColor: '#E3F3F1' },
  roomName: { color: '#142D43', fontSize: 17, fontWeight: '600' },
  roomDetails: { color: '#465D6E', marginTop: 4 },
  label: { color: '#142D43', fontSize: 16, marginTop: 12, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#A6B7C4', borderRadius: 14, padding: 12, backgroundColor: '#fff', fontSize: 16, lineHeight: 23 },
  feature: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8, borderRadius: 12, backgroundColor: '#F3F6F8' },
  selectedFeature: { backgroundColor: '#E3F3F1' },
  checkbox: { fontSize: 22, marginRight: 10, color: '#142D43' },
  muted: { color: '#465D6E', marginBottom: 12 },
  success: { color: '#166534', fontSize: 16, marginTop: 16 },
  error: { color: '#A52B45', fontSize: 16, marginTop: 16 },
});
