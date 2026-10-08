// Ręczne przyjęcie lub korekta stanu (tylko kierownictwo). Zwykłe przyjęcia robi faktura;
// ta ścieżka służy do drobnych poprawek — i jest w historii jak każdy inny ruch (księga nie kasuje).

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Chips, QtyStepper, Sheet, TextField, Text, useDialogs } from '@/components/ui';
import { useManualMovement } from '@/lib/api/products';
import { formatQty } from '@/lib/format';
import { parseQty } from '@/lib/qty';
import type { ProductRow } from '@/lib/types';

type Kind = 'receipt' | 'plus' | 'minus';

export function ManualMovementSheet({ product, visible, onClose }: { product: ProductRow; visible: boolean; onClose: () => void }) {
  const { toast, fail } = useDialogs();
  const mutation = useManualMovement();
  const [kind, setKind] = useState<Kind>('receipt');
  const [qty, setQty] = useState('1');
  const [note, setNote] = useState('');
  const parsed = parseQty(qty);

  async function submit() {
    if (parsed === null || parsed <= 0) return fail({ message: 'Podaj ilość większą od zera.' });
    try {
      await mutation.mutateAsync({
        productId: product.id,
        type: kind === 'receipt' ? 'receipt' : 'adjustment',
        qty: kind === 'minus' ? -parsed : parsed,
        note: note || (kind === 'receipt' ? 'Przyjęcie ręczne' : 'Korekta ręczna'),
      });
      toast('Zapisano w historii produktu', 'success');
      setQty('1');
      setNote('');
      onClose();
    } catch (e) {
      fail(e);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={`Zmień stan: ${product.name}`} scroll>
      <View style={styles.body}>
        <Text color="secondary" align="center" variant="callout">
          Teraz: {formatQty(product.stock)} {product.unit}
        </Text>
        <View style={styles.bleed}>
          <Chips
            options={[
              { value: 'receipt', label: 'Przyjęcie' },
              { value: 'plus', label: 'Korekta +' },
              { value: 'minus', label: 'Korekta −' },
            ]}
            value={kind}
            onChange={setKind}
          />
        </View>
        <QtyStepper value={qty} onChange={setQty} unit={product.unit} />
        <TextField value={note} onChangeText={setNote} placeholder="Powód / notatka (zalecane)" />
        <Button title="Zapisz" onPress={submit} loading={mutation.isPending} disabled={parsed === null || parsed <= 0} fullWidth />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14, paddingHorizontal: 16, paddingBottom: 8 },
  bleed: { marginHorizontal: -16 },
});
