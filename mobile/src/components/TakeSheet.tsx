// „Zdejmij" — najczęstsza czynność w całej aplikacji, więc maksymalnie krótka:
// ilość (domyślnie 1) → powód (domyślnie „zużycie") → jeden przycisk. Projekt i notatka są opcjonalne.

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Chips, QtyStepper, Sheet, Text, TextField, useDialogs } from '@/components/ui';
import { useProjects, useTakeStock } from '@/lib/api/products';
import { shouldAskCount, useRecordCount } from '@/lib/api/misc';
import { formatQty } from '@/lib/format';
import { REASON_LABEL } from '@/lib/movements';
import { parseQty } from '@/lib/qty';
import type { ProductRow } from '@/lib/types';
import { CountPrompt } from './CountPrompt';

type Reason = 'use' | 'damage' | 'expired' | 'other';

export function TakeSheet({ product, visible, onClose }: { product: ProductRow; visible: boolean; onClose: () => void }) {
  const { toast, fail } = useDialogs();
  const take = useTakeStock();
  const record = useRecordCount();
  const projects = useProjects(true);

  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState<Reason>('use');
  const [projectId, setProjectId] = useState<string>('none');
  const [note, setNote] = useState('');
  const [ask, setAsk] = useState<number | null>(null);   // po zdjęciu: oczekiwany stan do przeliczenia

  const parsed = parseQty(qty);
  const stock = Number(product.stock);
  const tooMuch = parsed !== null && parsed > stock;

  function reset() {
    setQty('1');
    setReason('use');
    setProjectId('none');
    setNote('');
  }

  async function submit() {
    if (parsed === null || parsed <= 0) return fail({ message: 'Podaj ilość większą od zera.' });
    try {
      await take.mutateAsync({
        productId: product.id,
        qty: parsed,
        reason,
        note,
        projectId: projectId === 'none' ? null : projectId,
      });
      toast(`Zdjęto ${formatQty(parsed)} ${product.unit}: ${product.name}`, 'success');
      const remaining = stock - parsed;
      reset();
      if (await shouldAskCount(product.id)) setAsk(remaining);
      else onClose();
    } catch (e) {
      fail(e);
    }
  }

  if (ask !== null) {
    return (
      <Sheet visible={visible} onClose={() => { setAsk(null); onClose(); }}>
        <CountPrompt
          name={product.name}
          unit={product.unit}
          expected={ask}
          busy={record.isPending}
          onSkip={() => { setAsk(null); onClose(); }}
          onSubmit={async (counted) => {
            try {
              const res = await record.mutateAsync({ productId: product.id, counted, source: 'on_take' });
              const diff = Number(res.diff);
              toast(diff === 0 ? 'Stan się zgadza. Dzięki!' : `Zapisano korektę: ${diff > 0 ? '+' : ''}${formatQty(diff)} ${product.unit}`, 'success');
            } catch (e) {
              fail(e);
            }
            setAsk(null);
            onClose();
          }}
        />
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={`Zdejmij: ${product.name}`} scroll>
      <View style={styles.body}>
        <Text color="secondary" align="center" variant="callout">
          Na magazynie: {formatQty(product.stock)} {product.unit}
        </Text>
        <QtyStepper value={qty} onChange={setQty} unit={product.unit} autoFocus />
        {tooMuch ? (
          <Text variant="footnote" color="warning" align="center">
            Zdejmujesz więcej, niż jest w systemie — stan zejdzie poniżej zera. Zrób mini-spis, gdy będzie okazja.
          </Text>
        ) : null}

        <View style={styles.bleed}>
          <Chips
            options={(Object.keys(REASON_LABEL) as Reason[]).map((r) => ({ value: r, label: REASON_LABEL[r] }))}
            value={reason}
            onChange={setReason}
          />
        </View>

        {projects.data && projects.data.length > 0 ? (
          <View style={{ gap: 2 }}>
            <Text variant="footnote" color="secondary" bold>
              Na które zlecenie? (opcjonalnie)
            </Text>
            <View style={styles.bleed}>
              <Chips
                options={[{ value: 'none', label: 'Bez zlecenia' }, ...projects.data.map((p) => ({ value: p.id, label: p.name }))]}
                value={projectId}
                onChange={setProjectId}
              />
            </View>
          </View>
        ) : null}

        <TextField value={note} onChangeText={setNote} placeholder="Notatka (opcjonalnie)" />
        <Button title={`Zdejmij ${parsed !== null ? formatQty(parsed) : ''} ${product.unit}`.trim()} onPress={submit} loading={take.isPending} disabled={parsed === null || parsed <= 0} fullWidth />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14, paddingHorizontal: 16, paddingBottom: 8 },
  bleed: { marginHorizontal: -16 },
});
