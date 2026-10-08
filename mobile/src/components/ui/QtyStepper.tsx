import { StyleSheet, TextInput, View } from 'react-native';
import { stepQty } from '@/lib/qty';
import { noOutline, radius, useColors } from '@/theme';
import { Icon } from './Icon';
import { Text } from './Text';
import { Touchable } from './Touchable';

/** Pole ilości z przyciskami − / + (duże, do obsługi jedną ręką, także w rękawicach). */
export function QtyStepper({ value, onChange, unit, step = 1, autoFocus }: {
  value: string; onChange: (v: string) => void; unit?: string; step?: number; autoFocus?: boolean;
}) {
  const c = useColors();
  return (
    <View style={styles.row}>
      <Touchable haptic onPress={() => onChange(stepQty(value, -step))} accessibilityLabel="Zmniejsz ilość" style={[styles.btn, { backgroundColor: c.fill }]}>
        <Icon name="remove" size={26} />
      </Touchable>
      <View style={[styles.box, { borderColor: c.border, backgroundColor: c.bgSecondary }]}>
        <TextInput
          value={value}
          onChangeText={(t) => onChange(t.replace(/[^0-9.,]/g, ''))}
          keyboardType="decimal-pad"
          inputMode="decimal"
          selectTextOnFocus
          autoFocus={autoFocus}
          accessibilityLabel="Ilość"
          style={[styles.input, { color: c.text }, noOutline]}
        />
        {unit ? (
          <Text variant="callout" color="secondary">
            {unit}
          </Text>
        ) : null}
      </View>
      <Touchable haptic onPress={() => onChange(stepQty(value, step))} accessibilityLabel="Zwiększ ilość" style={[styles.btn, { backgroundColor: c.fill }]}>
        <Icon name="add" size={26} />
      </Touchable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, justifyContent: 'center' },
  btn: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  // Stała szerokość pola: <input> w przeglądarce ma własną domyślną szerokość (~20 znaków) i rozpychałby wiersz poza ekran.
  box: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: radius.m, paddingHorizontal: 12, paddingVertical: 8 },
  input: { fontSize: 28, fontWeight: '700', textAlign: 'center', width: 84, padding: 0 },
});
