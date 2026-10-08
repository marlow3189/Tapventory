// Dodawanie i edycja produktu (tylko kierownictwo — pracownik zgłasza braki, nie edytuje katalogu).
//   /product/edit            → nowy produkt
//   /product/edit?id=…       → edycja
//   /product/edit?ean=…      → nowy produkt z gotowym kodem (po skanie nieznanego kodu)

import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { PhotoPicker, type LocalPhoto } from '@/components/PhotoPicker';
import { Button, Chips, ErrorState, ListRow, QtyStepper, RowSkeleton, Screen, Section, Text, TextField, useDialogs } from '@/components/ui';
import { invokeFunction } from '@/lib/api/functions';
import { saveProduct, useCreateSupplier, useProduct, useSuppliers, useManualMovement } from '@/lib/api/products';
import { useQueryClient } from '@tanstack/react-query';
import { normalizeBarcode } from '@/lib/ean';
import { qtyToInput, parseQty } from '@/lib/qty';
import { onScanned } from '@/lib/scanbus';
import { uploadJpeg } from '@/lib/storage';
import { useTenant } from '@/lib/tenant';
import type { ProductRow } from '@/lib/types';
import { uuidv7 } from '@/lib/uuid';

const UNITS = ['szt.', 'op.', 'kg', 'l', 'm', 'kpl.'];

export default function ProductEdit() {
  const { isManager, loading } = useTenant();
  const { id, ean } = useLocalSearchParams<{ id?: string; ean?: string }>();
  const product = useProduct(id);

  if (!loading && !isManager) return <Redirect href="/home" />;
  if (id && product.isError && !product.data) {
    return (
      <Screen title="Edycja produktu">
        <ErrorState error={product.error} onRetry={() => void product.refetch()} />
      </Screen>
    );
  }
  if (id && !product.data) {
    return (
      <Screen title="Edycja produktu">
        <RowSkeleton />
      </Screen>
    );
  }
  return <Form initial={product.data ?? null} presetEan={ean} />;
}

function Form({ initial, presetEan }: { initial: ProductRow | null; presetEan?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { tenantId } = useTenant();
  const { fail, toast, prompt, confirm } = useDialogs();
  const suppliers = useSuppliers();
  const createSupplier = useCreateSupplier();
  const movement = useManualMovement();

  const [name, setName] = useState(initial?.name ?? '');
  const [ean, setEan] = useState(initial?.ean ?? presetEan ?? '');
  const [unit, setUnit] = useState(initial?.unit ?? 'szt.');
  const [pack, setPack] = useState(initial ? qtyToInput(Number(initial.pack_size)) : '1');
  const [min, setMin] = useState(initial ? qtyToInput(Number(initial.min_stock)) : '0');
  const [startQty, setStartQty] = useState('0');
  const [supplierId, setSupplierId] = useState<string>(initial?.default_supplier_id ?? 'none');
  const [active, setActive] = useState(initial?.active ?? true);
  const [photo, setPhoto] = useState<LocalPhoto>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; ean?: string }>({});

  // kod kreskowy zeskanowany na ekranie skanera wraca tutaj
  useEffect(() => onScanned((code) => { setEan(code); setErrors((e) => ({ ...e, ean: undefined })); }), []);

  const units = UNITS.includes(unit) ? UNITS : [...UNITS, unit];
  const supplierOptions = [
    { value: 'none', label: 'Brak' },
    ...(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.name })),
    { value: '__new', label: '+ Nowy' },
  ];

  async function chooseSupplier(v: string) {
    if (v !== '__new') return setSupplierId(v);
    const typed = await prompt({ title: 'Nowy dostawca', placeholder: 'Nazwa dostawcy (np. Hurtownia XYZ)' });
    if (!typed) return;
    try {
      const s = await createSupplier.mutateAsync(typed);
      setSupplierId(s.id);
    } catch (e) {
      fail(e);
    }
  }

  async function lookup() {
    const code = normalizeBarcode(ean);
    if (!code) return setErrors((e) => ({ ...e, ean: 'Najpierw wpisz poprawny kod (8 lub 13 cyfr).' }));
    setLookupBusy(true);
    try {
      const res = await invokeFunction<{ found: boolean; name?: string }>('barcode-lookup', { ean: code });
      if (res.found && res.name) {
        setName((cur) => cur || (res.name as string));
        toast('Znaleziono w bazie produktów', 'success');
      } else {
        toast('Tego kodu nie ma w publicznej bazie — wpisz nazwę ręcznie.', 'info');
      }
    } catch (e) {
      fail(e);
    } finally {
      setLookupBusy(false);
    }
  }

  async function save() {
    const next: typeof errors = {};
    if (name.trim().length < 2) next.name = 'Podaj nazwę produktu (min. 2 znaki).';
    const code = ean.trim() ? normalizeBarcode(ean) : null;
    if (ean.trim() && !code) next.ean = 'Nieprawidłowy kod: EAN ma 8 lub 13 cyfr i poprawną sumę kontrolną.';
    setErrors(next);
    if (next.name || next.ean) return;

    const packN = parseQty(pack) ?? 1;
    const minN = parseQty(min) ?? 0;
    if (packN <= 0) return fail({ message: 'Wielkość opakowania musi być większa od zera.' });

    setBusy(true);
    try {
      let photoPath = removePhoto ? null : initial?.photo_path ?? null;
      if (photo) {
        photoPath = `${tenantId}/products/${uuidv7()}.jpg`;
        await uploadJpeg('product-photos', photoPath, photo.base64);
      }
      const savedId = await saveProduct(tenantId!, {
        id: initial?.id,
        name,
        ean: code,
        unit,
        pack_size: packN,
        min_stock: minN,
        photo_path: photoPath,
        default_supplier_id: supplierId === 'none' ? null : supplierId,
        active,
      });
      const start = parseQty(startQty) ?? 0;
      if (!initial && start > 0) {
        await movement.mutateAsync({ productId: savedId, type: 'adjustment', qty: start, note: 'Stan początkowy' });
      }
      for (const k of ['products', 'product', 'dashboard']) qc.invalidateQueries({ queryKey: [k] });
      toast(initial ? 'Zapisano zmiany' : 'Produkt dodany', 'success');
      if (initial) router.back();
      else router.replace(`/product/${savedId}`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(next: boolean) {
    if (!next) {
      const ok = await confirm({
        title: 'Zarchiwizować produkt?',
        message: 'Zniknie z listy i pickerów, ale cała historia ruchów zostaje. Możesz go później przywrócić.',
        confirmLabel: 'Archiwizuj',
        destructive: true,
      });
      if (!ok) return;
    }
    setActive(next);
  }

  return (
    <Screen
      title={initial ? 'Edytuj produkt' : 'Nowy produkt'}
      scroll
      footer={<Button title={initial ? 'Zapisz zmiany' : 'Dodaj produkt'} onPress={save} loading={busy} fullWidth />}
    >
      <PhotoPicker
        value={photo}
        existingPath={removePhoto ? null : initial?.photo_path}
        onChange={(p, removed) => {
          setPhoto(p);
          setRemovePhoto(removed);
        }}
        aspectRatio={1.6}
        label="Dodaj zdjęcie produktu"
      />

      <TextField label="Nazwa" value={name} onChangeText={setName} error={errors.name} placeholder="np. Rękawice nitrylowe L" returnKeyType="next" />

      <View style={{ gap: 8 }}>
        <TextField
          label="Kod kreskowy (EAN)"
          value={ean}
          onChangeText={(t) => setEan(t.replace(/\D/g, ''))}
          error={errors.ean}
          hint="Opcjonalny, ale dzięki niemu „Zdejmij” działa jednym skanem."
          keyboardType="number-pad"
          placeholder="5901234123457"
        />
        <View style={styles.row2}>
          <Button title="Skanuj" icon="barcode-outline" variant="secondary" size="s" onPress={() => router.push('/scan?mode=pick')} />
          <Button title="Podpowiedz nazwę" icon="search-outline" variant="secondary" size="s" loading={lookupBusy} onPress={lookup} />
        </View>
      </View>

      <View style={{ gap: 4 }}>
        <Text variant="subhead" color="secondary" bold>
          Jednostka
        </Text>
        <View style={styles.bleed}>
          <Chips options={units.map((u) => ({ value: u, label: u }))} value={unit} onChange={setUnit} />
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <Text variant="subhead" color="secondary" bold>
          Minimalny stan (poniżej — ostrzegamy)
        </Text>
        <QtyStepper value={min} onChange={setMin} unit={unit} />
      </View>

      <TextField
        label={`Ile ${unit} w jednym opakowaniu`}
        value={pack}
        onChangeText={(t) => setPack(t.replace(/[^0-9.,]/g, ''))}
        keyboardType="decimal-pad"
        hint="Zostaw 1, jeśli kupujesz na sztuki."
      />

      {!initial ? (
        <View style={{ gap: 6 }}>
          <Text variant="subhead" color="secondary" bold>
            Ile masz teraz na stanie?
          </Text>
          <QtyStepper value={startQty} onChange={setStartQty} unit={unit} />
        </View>
      ) : null}

      <View style={{ gap: 4 }}>
        <Text variant="subhead" color="secondary" bold>
          Dostawca
        </Text>
        <View style={styles.bleed}>
          <Chips options={supplierOptions} value={supplierId} onChange={(v) => void chooseSupplier(v)} />
        </View>
      </View>

      {initial ? (
        <Section footer="Archiwizacja nie kasuje historii — produkt po prostu znika z codziennej listy.">
          <ListRow title="Produkt aktywny" switchValue={active} onSwitch={(v) => void toggleActive(v)} last />
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row2: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  bleed: { marginHorizontal: -16 },
});
