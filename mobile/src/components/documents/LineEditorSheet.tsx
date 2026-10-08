// Edycja jednej pozycji faktury: nazwa, ilość, jednostka, cena, produkt, „pomiń".

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, ListRow, Section, Sheet, Text, TextField, useDialogs } from '@/components/ui';
import { convertToStockUnits, isPackUnit, lineNet } from '@/lib/document-math';
import { formatQty } from '@/lib/format';
import { parseMoney, parseSigned } from '@/lib/qty';
import type { DocumentLineRow, ProductRow } from '@/lib/types';

export type LinePatch = {
  raw_name: string; qty: number; unit: string | null; unit_price_net: number | null; total_net: number | null; skip: boolean;
};

const toText = (n: number | string | null | undefined) => (n === null || n === undefined || n === '' ? '' : String(Number(n)).replace('.', ','));

export function LineEditorSheet({ line, product, visible, readOnly, onClose, onSave, onDelete, onPickProduct }: {
  line: DocumentLineRow;
  product: ProductRow | null;
  visible: boolean;
  readOnly?: boolean;
  onClose: () => void;
  onSave: (patch: LinePatch) => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onPickProduct: () => void;
}) {
  const { fail } = useDialogs();
  const [name, setName] = useState(line.raw_name);
  const [qty, setQty] = useState(toText(line.qty));
  const [unit, setUnit] = useState(line.unit ?? '');
  const [price, setPrice] = useState(toText(line.unit_price_net));
  const [total, setTotal] = useState(toText(lineNet(line)));
  const [totalTouched, setTotalTouched] = useState(false);
  const [skip, setSkip] = useState(line.skip);
  const [busy, setBusy] = useState(false);

  const qtyN = parseSigned(qty);
  const priceN = parseMoney(price);
  const showPackHint = product && Number(product.pack_size) > 1 && isPackUnit(unit) && qtyN !== null;

  function recompute(nextQty: string, nextPrice: string) {
    if (totalTouched) return;
    const q = parseSigned(nextQty), p = parseMoney(nextPrice);
    setTotal(q !== null && p !== null ? String(Math.round(q * p * 100) / 100).replace('.', ',') : '');
  }

  async function save() {
    if (name.trim().length < 1) return fail({ message: 'Nazwa pozycji nie może być pusta.' });
    if (qtyN === null || qtyN === 0) return fail({ message: 'Ilość musi być liczbą różną od zera (ujemna tylko na korektach).' });
    if (price.trim() && priceN === null) return fail({ message: 'Cena musi być liczbą (np. 12,50).' });
    const totalN = total.trim() ? parseSigned(total) : null;
    if (total.trim() && totalN === null) return fail({ message: 'Wartość musi być liczbą (np. 120,00).' });
    setBusy(true);
    try {
      await onSave({ raw_name: name.trim(), qty: qtyN, unit: unit.trim() || null, unit_price_net: price.trim() ? priceN : null, total_net: totalN, skip });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={readOnly ? 'Pozycja' : 'Edytuj pozycję'} scroll>
      <View style={styles.body}>
        <TextField label="Nazwa z faktury" value={name} onChangeText={setName} editable={!readOnly} multiline />

        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <TextField
              label="Ilość"
              value={qty}
              onChangeText={(t) => {
                setQty(t.replace(/[^0-9.,-]/g, ''));
                recompute(t, price);
              }}
              keyboardType="numbers-and-punctuation"
              editable={!readOnly}
            />
          </View>
          <View style={{ flex: 1 }}>
            <TextField label="Jednostka" value={unit} onChangeText={setUnit} placeholder="szt." editable={!readOnly} autoCapitalize="none" />
          </View>
        </View>

        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <TextField
              label="Cena netto / jedn."
              value={price}
              onChangeText={(t) => {
                setPrice(t.replace(/[^0-9.,]/g, ''));
                recompute(qty, t);
              }}
              keyboardType="decimal-pad"
              editable={!readOnly}
            />
          </View>
          <View style={{ flex: 1 }}>
            <TextField
              label="Wartość netto"
              value={total}
              onChangeText={(t) => {
                setTotal(t.replace(/[^0-9.,-]/g, ''));
                setTotalTouched(true);
              }}
              keyboardType="numbers-and-punctuation"
              editable={!readOnly}
            />
          </View>
        </View>

        <Section title="Produkt w magazynie">
          <ListRow
            icon="cube-outline"
            title={product ? product.name : 'Nie przypisano'}
            subtitle={product ? `Stan: ${formatQty(product.stock)} ${product.unit}${line.match_confidence ? ` · pewność dopasowania ${line.match_confidence}%` : ''}` : 'Wybierz produkt albo oznacz pozycję jako pomijaną'}
            onPress={readOnly ? undefined : onPickProduct}
            last
          />
        </Section>

        {showPackHint && !readOnly ? (
          <View style={styles.hint}>
            <Text variant="callout" style={{ flex: 1 }}>
              „{unit}” to opakowanie: 1 {unit} = {formatQty(product.pack_size)} {product.unit}. Przeliczyć pozycję na {product.unit}?
            </Text>
            <Button
              title="Przelicz"
              size="s"
              variant="secondary"
              onPress={() => {
                const r = convertToStockUnits({ qty: qtyN, unit_price_net: priceN }, Number(product.pack_size));
                setQty(toText(r.qty));
                setPrice(toText(r.unit_price_net));
                setUnit(product.unit);
              }}
            />
          </View>
        ) : null}

        {!readOnly ? (
          <>
            <Section footer="Pomijaj pozycje, które nie są towarem na stanie: transport, usługi, rabaty.">
              <ListRow title="Pomiń tę pozycję (bez wpływu na magazyn)" switchValue={skip} onSwitch={setSkip} last />
            </Section>
            <Button title="Zapisz pozycję" onPress={save} loading={busy} fullWidth />
            <Button title="Usuń pozycję" variant="ghost" onPress={() => void onDelete()} fullWidth />
          </>
        ) : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14, paddingHorizontal: 16, paddingBottom: 8 },
  row: { flexDirection: 'row', gap: 10 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: 'rgba(0,149,246,0.10)' },
});
