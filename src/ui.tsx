import { Pressable, StyleSheet, Text, type ButtonProps } from 'react-native';

// Shared presentation only: callers retain their existing handlers and disabled states.
export const colors = {
  navy: '#142D43', teal: '#087F83', tealSoft: '#E3F3F1', background: '#F3F6F8',
  text: '#465D6E', border: '#D5E0E7', white: '#FFFFFF', danger: '#A52B45',
};

type Props = ButtonProps & { variant?: 'primary' | 'secondary' | 'danger' };
export function Button({ title, onPress, disabled, accessibilityLabel, testID, color, variant = 'primary' }: Props) {
  const secondary = variant === 'secondary';
  const backgroundColor = secondary ? colors.white : variant === 'danger' ? colors.danger : color || colors.teal;
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || title}
    accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress} testID={testID}
    style={({ pressed }) => [styles.button, { backgroundColor }, secondary && styles.secondary,
      disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
    <Text style={[styles.label, secondary && styles.secondaryLabel]}>{title}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { minHeight: 48, paddingVertical: 13, paddingHorizontal: 18, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', marginVertical: 3 },
  secondary: { borderWidth: 1, borderColor: colors.border },
  label: { color: colors.white, fontSize: 16, lineHeight: 22, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  secondaryLabel: { color: colors.navy },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
});
