// „Ile zostało?" — szybkie policzenie jednego produktu (mini-spis).
// Pojawia się po „Zdejmij" (tylko gdy produkt jest zaległy) oraz w sesji mini-spisu.

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, QtyStepper, Text } from '@/components/ui';
import { formatQty } from '@/lib/format';
import { parseQty, qtyToInput } from '@/lib/qty';

export function CountPrompt({ name, unit, expected, blind, busy, onSubmit, onSkip }: {
  name: string; unit: string; expected: number | string; busy?: boolean;
  /** „liczenie w ciemno": nie podpowiadamy stanu z systemu, by nie sugerować wyniku */
  blind?: boolean;
  onSubmit: (counted: number) => void; onSkip?: () => void;
}) {
  const [value, setValue] = useState(blind ? '0' : qtyToInput(Number(expected) || 0));
  const counted = parseQty(value);
  return (
    <View style={styles.wrap}>
      <Text variant="headline" align="center">
        Ile zostało: {name}?
      </Text>
      <Text color="secondary" align="center" variant="callout">
        {blind
          ? 'Policz, ile jest na półce, i wpisz wynik. Różnicę względem systemu zapiszemy za Ciebie.'
          : `Według systemu: ${formatQty(expected)} ${unit}. Policz na półce i wpisz stan faktyczny — korektę zapiszemy za Ciebie.`}
      </Text>
      <QtyStepper value={value} onChange={setValue} unit={unit} autoFocus />
      <Button title="Zapisz stan" onPress={() => counted !== null && onSubmit(counted)} disabled={counted === null} loading={busy} fullWidth />
      {onSkip ? <Button title="Pomiń" variant="ghost" onPress={onSkip} fullWidth /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16, paddingHorizontal: 16, paddingVertical: 8 },
});
