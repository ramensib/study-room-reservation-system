import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// Only accept the new public key format; legacy JWT/service-role keys are not accepted.
export const configurationError = !url || !key
  ? 'Supabase is not configured. Follow the Stage 2 setup guide.'
  : !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)
    || !key.startsWith('sb_publishable_') || key.includes('REPLACE_ME')
    ? 'Configure a Supabase project URL and public publishable key.'
    : null;

export const supabase = configurationError ? null : createClient(url!, key!, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export function requireSupabase() {
  if (!supabase) throw new Error(configurationError ?? 'Supabase unavailable');
  return supabase;
}
