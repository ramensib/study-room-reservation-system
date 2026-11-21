import { KeyboardAvoidingView, Platform, SafeAreaView, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AuthScreen from './src/AuthScreen';

export default function App() {
  return <SafeAreaView style={styles.screen}>
    <StatusBar style="dark" />
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <AuthScreen />
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#F3F6F8' } });
