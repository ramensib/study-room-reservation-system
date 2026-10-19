import { useEffect, useState } from 'react';
import { AppState, Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { Session } from '@supabase/supabase-js';
import { configurationError, supabase } from './lib/supabase';
import { readRole, type Role } from './services/database';
import RoomManagementScreen from './RoomManagementScreen';
import RoomSearch from './RoomSearch';

export default function AuthScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(Boolean(supabase));
  const [role, setRole] = useState<Role | null>(null);
  const [roleOwner, setRoleOwner] = useState<string | null>(null);
  const [roleError, setRoleError] = useState('');
  const [roleAttempt, setRoleAttempt] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let mounted = true;
    let authEventReceived = false;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, next) => {
      authEventReceived = true;
      if (mounted) { setSession(next); setInitializing(false); }
    });
    client.auth.getSession().then(({ data, error: sessionError }) => {
      if (!mounted || authEventReceived) return;
      setSession(data.session);
      if (sessionError) setError('Unable to restore your session. Please sign in again.');
      setInitializing(false);
    }).catch(() => {
      if (mounted) { setError('Unable to restore your session.'); setInitializing(false); }
    });
    function refreshForState(state: string) {
      if (state === 'active') client!.auth.startAutoRefresh();
      else client!.auth.stopAutoRefresh();
    }
    refreshForState(AppState.currentState);
    const listener = AppState.addEventListener('change', refreshForState);
    return () => {
      mounted = false;
      subscription.unsubscribe();
      listener.remove();
      client.auth.stopAutoRefresh();
    };
  }, []);

  useEffect(() => {
    let active = true;
    setRole(null);
    setRoleError('');
    if (session) {
      readRole(session.user.id).then(value => { if (active) { setRole(value); setRoleOwner(session.user.id); } }).catch(() => {
        if (active) setRoleError('Your account role could not be loaded. Retry or contact the project administrator.');
      });
    }
    return () => { active = false; };
  }, [session?.user.id, roleAttempt]);

  async function signIn() {
    if (!supabase || busy) return;
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    setBusy(true);
    setError('');
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) setError('Sign-in failed. Check your credentials and connection.');
      else setPassword('');
    } catch { setError('Sign-in failed. Check your connection.'); }
    finally { setBusy(false); }
  }

  async function signOut() {
    if (!supabase || busy) return;
    setBusy(true);
    setError('');
    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
      if (signOutError) setError('Sign-out failed. Please retry.');
      else { setSession(null); setRole(null); setPassword(''); }
    } catch { setError('Sign-out failed. Check your connection.'); }
    finally { setBusy(false); }
  }

  if (session && roleOwner === session.user.id && role === 'administrator') {
    return <RoomManagementScreen key={session.user.id} adminId={session.user.id} onSignOut={() => void signOut()} busy={busy} />;
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.title}>Study Room Reservation System</Text>
        <Text style={styles.team}>Team Data</Text>
        {configurationError ? <Text style={styles.message}>{configurationError}</Text>
          : initializing ? <Text style={styles.message}>Restoring session…</Text>
          : session ? <>
            <Text style={styles.message}>Signed in as {session.user.email}</Text>
            {role ? <Text style={styles.message}>Role: Student</Text>
              : roleError ? <>
                <Text accessibilityRole="alert" style={styles.error}>{roleError}</Text>
                <Button title="Retry account lookup" onPress={() => setRoleAttempt(value => value + 1)} />
              </> : <Text style={styles.message}>Loading account role…</Text>}
            <Button title={busy ? 'Please wait…' : 'Sign out'} disabled={busy} onPress={signOut} />
          </> : <>
            <Text style={styles.label}>Email</Text>
            <TextInput accessibilityLabel="Email" style={styles.input} value={email} onChangeText={setEmail}
              autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" editable={!busy} />
            <Text style={styles.label}>Password</Text>
            <TextInput accessibilityLabel="Password" style={styles.input} value={password} onChangeText={setPassword}
              secureTextEntry autoCapitalize="none" autoComplete="current-password" editable={!busy} onSubmitEditing={signIn} />
            <Button title={busy ? 'Signing in…' : 'Sign in'} disabled={busy} onPress={signIn} />
          </>}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {session && roleOwner === session.user.id && role === 'student' ? <RoomSearch key={session.user.id} studentId={session.user.id} /> : null}
      </View>
      <StatusBar style="dark" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: 24, backgroundColor: '#f5f7fb' },
  card: { width: '100%', maxWidth: 480, alignSelf: 'center', paddingVertical: 32 },
  title: { color: '#17324d', fontSize: 28, fontWeight: '700', textAlign: 'center' },
  team: { color: '#40566b', fontSize: 20, marginTop: 12, marginBottom: 24, textAlign: 'center' },
  label: { color: '#17324d', fontSize: 16, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#64748b', borderRadius: 6, padding: 12, marginBottom: 16, backgroundColor: '#fff', fontSize: 16 },
  message: { color: '#17324d', fontSize: 16, marginBottom: 16 },
  error: { color: '#9f1239', fontSize: 16, marginVertical: 16 },
});
