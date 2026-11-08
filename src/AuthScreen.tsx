import { Button } from './ui';
import { useEffect, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
    <ScrollView contentContainerStyle={[styles.container, session && styles.signedInContainer]} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <View style={styles.brand}>
          <View style={styles.mark}><Text style={styles.markText}>SR</Text></View>
          <View style={styles.brandWords}>
            <Text accessibilityRole="header" style={styles.title}>Study Room</Text>
            <Text style={styles.team}>RESERVATION SYSTEM · TEAM DATA</Text>
          </View>
        </View>
        {!session && <View style={styles.hero}>
          <Text style={styles.eyebrow}>SPACE TO FOCUS</Text>
          <Text accessibilityRole="header" style={styles.heroTitle}>Your next study session starts here.</Text>
          <Text style={styles.heroText}>Find a room that fits your group. Choose a time. Make it yours.</Text>
          <View style={styles.heroRule} />
          <Text style={styles.heroText}>1-hour bookings · 9 AM–9 PM Central</Text>
        </View>}
        {configurationError ? <Text style={styles.message}>{configurationError}</Text>
          : initializing ? <Text style={styles.message}>Restoring session…</Text>
          : session ? <>
            <Text style={styles.account}>{session.user.email}</Text>
            {role ? <Text style={styles.roleBadge}>STUDENT WORKSPACE</Text>
              : roleError ? <>
                <Text accessibilityRole="alert" style={styles.error}>{roleError}</Text>
                <Button title="Retry account lookup" onPress={() => setRoleAttempt(value => value + 1)} />
              </> : <Text style={styles.message}>Loading account role…</Text>}
            <Button variant="secondary" title={busy ? 'Please wait…' : 'Sign out'} disabled={busy} onPress={signOut} />
          </> : <View style={styles.loginPanel}>
            <Text accessibilityRole="header" style={styles.loginTitle}>Welcome back</Text>
            <Text style={styles.message}>Sign in with your project account.</Text>
            <Text style={styles.label}>Email</Text>
            <TextInput accessibilityLabel="Email" style={styles.input} value={email} onChangeText={setEmail}
              autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" editable={!busy} />
            <Text style={styles.label}>Password</Text>
            <TextInput accessibilityLabel="Password" style={styles.input} value={password} onChangeText={setPassword}
              secureTextEntry autoCapitalize="none" autoComplete="current-password" editable={!busy} onSubmitEditing={signIn} />
            <Button title={busy ? 'Signing in…' : 'Sign in'} disabled={busy} onPress={signIn} />
          </View>}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {session && roleOwner === session.user.id && role === 'student' ? <RoomSearch key={session.user.id} studentId={session.user.id} /> : null}
      </View>
      <StatusBar style="dark" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: 20, backgroundColor: '#F3F6F8' },
  signedInContainer: { justifyContent: 'flex-start' },
  card: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingVertical: 16 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 },
  mark: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#087F83', alignItems: 'center', justifyContent: 'center' },
  markText: { color: '#FFFFFF', fontSize: 19, fontWeight: '800' },
  brandWords: { flex: 1 },
  title: { color: '#142D43', fontSize: 24, fontWeight: '700' },
  team: { color: '#465D6E', fontSize: 10, letterSpacing: 0.7, marginTop: 4 },
  hero: { backgroundColor: '#142D43', borderRadius: 24, padding: 24, marginBottom: 24 },
  eyebrow: { color: '#89D9D2', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 14 },
  heroTitle: { color: '#FFFFFF', fontSize: 29, lineHeight: 36, fontWeight: '700', marginBottom: 12 },
  heroText: { color: '#D9E7EC', fontSize: 14, lineHeight: 22 },
  heroRule: { height: 1, backgroundColor: '#365164', marginVertical: 18 },
  loginPanel: { padding: 20, borderRadius: 22, borderWidth: 1, borderColor: '#D5E0E7', backgroundColor: '#FFFFFF' },
  loginTitle: { color: '#142D43', fontSize: 23, fontWeight: '700', marginBottom: 8 },
  account: { color: '#465D6E', fontSize: 14, marginBottom: 10 },
  roleBadge: { color: '#07686B', backgroundColor: '#E3F3F1', alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, fontSize: 11, letterSpacing: 1, fontWeight: '700', marginBottom: 12 },
  label: { color: '#142D43', fontSize: 16, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#A6B7C4', borderRadius: 14, padding: 12, marginBottom: 16, backgroundColor: '#fff', fontSize: 16, lineHeight: 23 },
  message: { color: '#142D43', fontSize: 16, marginBottom: 16 },
  error: { color: '#A52B45', fontSize: 16, marginVertical: 16 },
});
