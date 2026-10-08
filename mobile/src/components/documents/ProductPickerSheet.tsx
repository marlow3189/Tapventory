// Wybór produktu z magazynu dla pozycji faktury (z wyszukiwarką i skrótem „utwórz nowy").

import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Sheet, Text, TextField, Touchable } from '@/components/ui';
import { useProducts } from '@/lib/api/products';
import { formatQty } from '@/lib/format';
import { matchesQuery } from '@/lib/search';
import { useColors } from '@/theme';

export function ProductPickerSheet({ visible, onClose, onPick, selectedId, suggestion, onCreate, creating }: {
  visible: boolean;
  onClose: () => void;
  onPick: (productId: string) => void;
  selectedId?: string | null;
  /** nazwa z faktury — podpowiedź do wyszukiwania i do „utwórz nowy" */
  suggestion?: string;
  onCreate?: () => void;
  creating?: boolean;
}) {
  const c = useColors();
  const products = useProducts();
  const [query, setQuery] = useState('');

  const rows = useMemo(
    () => (products.data ?? []).filter((p) => p.active && matchesQuery(`${p.name} ${p.ean ?? ''}`, query)).slice(0, 40),
    [products.data, query]
  );

  return (
    <Sheet visible={visible} onClose={onClose} title="Przypisz produkt" scroll>
      <View style={styles.body}>
        {suggestion ? (
          <Text variant="footnote" color="secondary">
            Pozycja na fakturze: „{suggestion}”
          </Text>
        ) : null}
        <TextField value={query} onChangeText={setQuery} placeholder="Szukaj w magazynie…" autoFocus autoCorrect={false} />
        {rows.map((p) => (
          <Touchable key={p.id} onPress={() => onPick(p.id)} accessibilityLabel={`Wybierz ${p.name}`} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text bold numberOfLines={1}>
                {p.name}
              </Text>
              <Text variant="footnote" color="secondary">
                Stan: {formatQty(p.stock)} {p.unit}
                {p.ean ? ` · ${p.ean}` : ''}
              </Text>
            </View>
            {selectedId === p.id ? <Icon name="checkmark-circle" size={22} color={c.primary} /> : null}
          </Touchable>
        ))}
        {rows.length === 0 ? (
          <Text color="secondary" align="center">
            {products.isPending ? 'Ładowanie…' : 'Nic nie pasuje. Możesz utworzyć nowy produkt z tej pozycji.'}
          </Text>
        ) : null}
        {onCreate ? <Button title="Utwórz nowy produkt z tej pozycji" icon="add-circle-outline" variant="secondary" onPress={onCreate} loading={creating} fullWidth /> : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 10, paddingHorizontal: 16, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
});
