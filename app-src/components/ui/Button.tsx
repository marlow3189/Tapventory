// Przycisk wg wzorców iOS:
//  * filled — niebieskie tło, biały tekst (główna akcja ekranu; max 1 na ekran)
//  * tinted — jasnoniebieskie tło, niebieski tekst (akcja drugorzędna)
//  * plain  — sam niebieski tekst (akcje "lekkie", linki)
// Nazwa na przycisku mówi, co się stanie: "Zaloguj się", nie "OK".

import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { colors, radius, touchTarget, typography } from '../../theme/tokens';

type Props = {
  title: string;
  onPress: () => void;
  variant?: 'filled' | 'tinted' | 'plain';
  loading?: boolean;
  disabled?: boolean;
  destructive?: boolean; // czerwony wariant dla akcji niszczących
};

export function Button({
  title,
  onPress,
  variant = 'filled',
  loading = false,
  disabled = false,
  destructive = false,
}: Props) {
  const accent = destructive ? colors.red : colors.blue;
  const inactive = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        variant === 'filled' && { backgroundColor: accent },
        variant === 'tinted' && { backgroundColor: colors.tintedBlue },
        (pressed || inactive) && { opacity: pressed ? 0.75 : 0.4 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'filled' ? '#FFFFFF' : accent} />
      ) : (
        <Text
          style={[
            styles.label,
            { color: variant === 'filled' ? '#FFFFFF' : accent },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget + 6, // 50 pt — wygodny, pełnowymiarowy przycisk
    borderRadius: radius.m,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  label: { ...typography.headline },
});
