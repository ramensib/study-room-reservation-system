import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Button, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
        <Text accessibilityRole="header" style={styles.title}>Administrator</Text>
        <Text style={styles.subtitle}>Manage room records</Text>
        <Button title="All Reservations" disabled={busy || saving} onPress={() => setShowReservations(true)} />
        <Button title={busy ? 'Please wait…' : 'Sign out'} disabled={busy || saving} onPress={onSignOut} />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Existing rooms</Text>
          {loading ? <ActivityIndicator accessibilityLabel="Loading rooms" /> : rooms.length === 0
            ? <Text style={styles.muted}>No rooms have been added yet.</Text>
            : rooms.map(room => (
              <Pressable key={room.id} style={[styles.room, room.id === selectedId && styles.selectedRoom]} onPress={() => selectRoom(room)}>
                <Text style={styles.roomName}>{room.name}</Text>
                <Text style={styles.roomDetails}>{room.capacity} seats{room.features.length ? ` • ${room.features.join(', ')}` : ''}</Text>
              </Pressable>
            ))}
          <Button title="Add a new room" onPress={startNewRoom} disabled={saving} />
          {!loading && <Button title="Refresh rooms" onPress={() => void loadRooms()} disabled={saving} />}
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
            return <Pressable key={feature} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} style={styles.feature} onPress={() => toggleFeature(feature)}>
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
  container: { flexGrow: 1, padding: 20, backgroundColor: '#f5f7fb' },
  card: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingVertical: 20 },
  title: { color: '#17324d', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#40566b', fontSize: 20, marginTop: 6, marginBottom: 16 },
  section: { marginTop: 24, paddingTop: 20, borderTopWidth: 1, borderTopColor: '#cbd5e1' },
  sectionTitle: { color: '#17324d', fontSize: 20, fontWeight: '700', marginBottom: 12 },
  room: { padding: 14, marginBottom: 8, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1' },
  selectedRoom: { borderColor: '#17324d', borderWidth: 2 },
  roomName: { color: '#17324d', fontSize: 17, fontWeight: '600' },
  roomDetails: { color: '#40566b', marginTop: 4 },
  label: { color: '#17324d', fontSize: 16, marginTop: 12, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#64748b', borderRadius: 6, padding: 12, backgroundColor: '#fff', fontSize: 16 },
  feature: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  checkbox: { fontSize: 22, marginRight: 10, color: '#17324d' },
  muted: { color: '#40566b', marginBottom: 12 },
  success: { color: '#166534', fontSize: 16, marginTop: 16 },
  error: { color: '#9f1239', fontSize: 16, marginTop: 16 },
});
