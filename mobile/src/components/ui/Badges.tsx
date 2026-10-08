import { StyleSheet, View } from 'react-native';
import { radius, toneColors, useColors, type Tone } from '@/theme';
import { Text } from './Text';

/** Kapsułka ze statusem (np. „Zamówione"). */
export function Pill({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const c = useColors();
  const { fg, bg } = toneColors(c, tone);
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text variant="caption" bold style={{ color: fg }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Czerwona kropka z liczbą (powiadomienia, kółka stories). */
export function CountBadge({ count, max = 99 }: { count: number; max?: number }) {
  const c = useColors();
  if (count <= 0) return null;
  return (
    <View style={[styles.count, { backgroundColor: c.danger, borderColor: c.bg }]} accessible accessibilityLabel={`${count} nowych`}>
      <Text variant="caption" bold style={{ color: '#FFFFFF', fontSize: 10, lineHeight: 12 }}>
        {count > max ? `${max}+` : String(count)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill },
  count: {
    minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
});
