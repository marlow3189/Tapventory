// Skaner kodów kreskowych (EAN-13, EAN-8, UPC-A). Działa na telefonie i w przeglądarce (PWA).
// Tryby:  find — znajdź produkt   take — znajdź i od razu „Zdejmij"   pick — oddaj kod formularzowi

import { useCallback, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, Text, TextField, Touchable, buzz, useDialogs } from '@/components/ui';
import { findProductByEan } from '@/lib/api/products';
import { normalizeBarcode } from '@/lib/ean';
import { emitScanned } from '@/lib/scanbus';
import { useTenant } from '@/lib/tenant';
import { useColors } from '@/theme';

type Mode = 'find' | 'take' | 'pick';

export default function Scan() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { toast, fail } = useDialogs();
  const { tenantId, isManager } = useTenant();
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();
  const mode: Mode = modeParam === 'take' || modeParam === 'pick' ? modeParam : 'find';

  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [manual, setManual] = useState('');
  const [unknown, setUnknown] = useState<string | null>(null);
  const busy = useRef(false);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }, [router]);

  const handle = useCallback(
    async (raw: string) => {
      if (busy.current) return;
      const ean = normalizeBarcode(raw);
      if (!ean) {
        toast('Nie rozpoznano kodu. Zeskanuj kod EAN (8 lub 13 cyfr).', 'error');
        busy.current = true;
        setTimeout(() => (busy.current = false), 1500);
        return;
      }
      busy.current = true;
      buzz('success');
      if (mode === 'pick') {
        emitScanned(ean);
        close();
        return;
      }
      try {
        const p = await findProductByEan(tenantId!, ean);
        if (p) router.replace(mode === 'take' ? `/product/${p.id}?take=1` : `/product/${p.id}`);
        else setUnknown(ean);
      } catch (e) {
        fail(e);
        busy.current = false;
      }
    },
    [mode, tenantId, router, close, toast, fail]
  );

  const title = mode === 'take' ? 'Zeskanuj produkt do zdjęcia' : mode === 'pick' ? 'Zeskanuj kod kreskowy' : 'Zeskanuj kod produktu';

  return (
    <View style={styles.root}>
      {permission?.granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a'] }}
          onBarcodeScanned={unknown ? undefined : (r) => void handle(r.data)}
        />
      ) : null}

      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Touchable onPress={close} accessibilityLabel="Zamknij skaner" style={styles.round}>
          <Icon name="close" size={26} color="#FFFFFF" />
        </Touchable>
        <Text variant="headline" style={{ color: '#FFFFFF', flex: 1, textAlign: 'center' }}>
          {title}
        </Text>
        {Platform.OS !== 'web' ? (
          <Touchable onPress={() => setTorch((t) => !t)} accessibilityLabel={torch ? 'Wyłącz latarkę' : 'Włącz latarkę'} style={styles.round}>
            <Icon name={torch ? 'flashlight' : 'flashlight-outline'} size={24} color="#FFFFFF" />
          </Touchable>
        ) : (
          <View style={styles.round} />
        )}
      </View>

      {permission?.granted ? (
        <View style={styles.frameWrap} pointerEvents="none">
          <View style={styles.frame} />
        </View>
      ) : (
        <View style={styles.center}>
          <Icon name="camera-outline" size={56} color="#FFFFFF" />
          <Text style={{ color: '#FFFFFF' }} align="center">
            {permission === null
              ? 'Sprawdzam dostęp do aparatu…'
              : permission.canAskAgain
                ? 'Aby skanować kody, Tapventory potrzebuje dostępu do aparatu.'
                : 'Dostęp do aparatu jest zablokowany. Włącz go w ustawieniach telefonu lub przeglądarki — albo wpisz kod ręcznie poniżej.'}
          </Text>
          {permission?.canAskAgain ? <Button title="Zezwól na aparat" onPress={() => void requestPermission()} /> : null}
        </View>
      )}

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]}>
        {unknown ? (
          <View style={[styles.card, { backgroundColor: c.surface }]}>
            <Text variant="headline" align="center">
              Nie znamy kodu {unknown}
            </Text>
            <Text color="secondary" align="center" variant="callout">
              Tego produktu nie ma jeszcze w magazynie.
            </Text>
            {isManager ? (
              <Button title="Dodaj ten produkt" icon="add-circle-outline" fullWidth onPress={() => router.replace(`/product/edit?ean=${unknown}`)} />
            ) : (
              <Button title="Zgłoś, że go brakuje" icon="alert-circle-outline" fullWidth onPress={() => router.replace(`/request/new?ean=${unknown}`)} />
            )}
            <Button
              title="Skanuj dalej"
              variant="secondary"
              fullWidth
              onPress={() => {
                setUnknown(null);
                busy.current = false;
              }}
            />
          </View>
        ) : (
          <View style={styles.manualRow}>
            <View style={{ flex: 1 }}>
              <TextField
                value={manual}
                onChangeText={(t) => setManual(t.replace(/\D/g, ''))}
                placeholder="…albo wpisz kod ręcznie"
                keyboardType="number-pad"
                returnKeyType="go"
                onSubmitEditing={() => void handle(manual)}
              />
            </View>
            <Button title="Szukaj" onPress={() => void handle(manual)} disabled={manual.length < 8} />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8, backgroundColor: 'rgba(0,0,0,0.35)', paddingBottom: 8 },
  round: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  frameWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  frame: { width: 280, height: 170, borderRadius: 16, borderWidth: 3, borderColor: '#FFFFFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingTop: 12, backgroundColor: 'rgba(0,0,0,0.55)' },
  manualRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  card: { gap: 12, padding: 16, borderRadius: 16 },
});
