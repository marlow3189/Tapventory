import { ScrollView, StyleSheet, View } from 'react-native';
import { radius, spacing, useColors } from '@/theme';
import { Text } from './Text';
import { Touchable } from './Touchable';

export type ChipOption<T extends string> = { value: T; label: string };

/** Poziomy rząd filtrów-„pigułek" (Wszystkie / Otwarte / Moje). */
export function Chips<T extends string>({ options, value, onChange }: {
  options: ChipOption<T>[]; value: T; onChange: (v: T) => void;
}) {
  const c = useColors();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Touchable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.chip, { backgroundColor: active ? c.text : c.fill }]}
          >
            <Text variant="subhead" bold style={{ color: active ? c.bg : c.text }}>
              {o.label}
            </Text>
          </Touchable>
        );
      })}
      <View style={{ width: spacing.s }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.s, paddingHorizontal: spacing.l, paddingVertical: spacing.s },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, minHeight: 34, justifyContent: 'center' },
});
