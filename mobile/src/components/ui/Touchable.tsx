// Podstawowy element dotykowy całej aplikacji: lekkie "przygaszenie" po dotknięciu
// (jak w Instagramie), opcjonalna wibracja na telefonie i poprawne role dostępności.

import { Platform, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';

export type TouchableProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** lekka wibracja przy dotknięciu (tylko telefon) */
  haptic?: boolean;
  pressedOpacity?: number;
};

export function buzz(kind: 'light' | 'success' | 'error' = 'light') {
  if (Platform.OS === 'web') return;
  try {
    if (kind === 'light') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    else void Haptics.notificationAsync(kind === 'success' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
  } catch {
    // brak wibracji nigdy nie może psuć działania
  }
}

export function Touchable({ haptic, pressedOpacity = 0.6, onPress, style, disabled, accessibilityRole = 'button', ...rest }: TouchableProps) {
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      disabled={disabled}
      hitSlop={6}
      onPress={(e) => {
        if (haptic) buzz('light');
        onPress?.(e);
      }}
      style={({ pressed }) => [style, pressed && !disabled ? { opacity: pressedOpacity } : null, disabled ? { opacity: 0.45 } : null]}
      {...rest}
    />
  );
}
