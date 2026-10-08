// Okna dialogowe i krótkie komunikaty ("toast") działające tak samo wszędzie.
//
// Dlaczego własne? Alert.alert z React Native NIE DZIAŁA w przeglądarce (PWA) —
// przycisk "Usuń" po prostu nic by nie robił. Te okna są zbudowane z Modal, więc
// działają na iOS, Androidzie i w sieci, a do tego zwracają Promise:
//
//   const ok = await confirm({ title: 'Usunąć?', destructive: true });
//   if (!ok) return;

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { Animated, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { friendlyError } from '@/lib/errors';
import { layout, radius, useColors } from '@/theme';
import { Icon } from './Icon';
import { Text } from './Text';
import { TextField } from './TextField';
import { Touchable, buzz } from './Touchable';

type ToastKind = 'success' | 'error' | 'info';

export type ConfirmOptions = {
  title: string; message?: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean;
};
export type PromptOptions = {
  title: string; message?: string; placeholder?: string; initial?: string; multiline?: boolean;
  confirmLabel?: string; required?: boolean; keyboardType?: 'default' | 'numeric' | 'email-address';
};

type DialogsApi = {
  toast: (message: string, kind?: ToastKind) => void;
  /** pokazuje czytelny komunikat z dowolnego błędu (Supabase, sieć, nasze funkcje) */
  fail: (error: unknown, fallback?: string) => void;
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  prompt: (o: PromptOptions) => Promise<string | null>;
  alert: (title: string, message?: string) => Promise<void>;
};

type Pending = { id: number } & (
  | { type: 'confirm'; o: ConfirmOptions; resolve: (v: boolean) => void }
  | { type: 'prompt'; o: PromptOptions; resolve: (v: string | null) => void }
  | { type: 'alert'; o: { title: string; message?: string }; resolve: () => void }
);
type NewPending = Pending extends infer P ? (P extends { id: number } ? Omit<P, 'id'> : never) : never;

const DialogsContext = createContext<DialogsApi | null>(null);

export function useDialogs(): DialogsApi {
  const ctx = useContext(DialogsContext);
  if (!ctx) throw new Error('useDialogs wymaga <DialogsProvider> w głównym układzie aplikacji.');
  return ctx;
}

export function DialogsProvider({ children }: PropsWithChildren) {
  const [queue, setQueue] = useState<Pending[]>([]);
  const [toast, setToast] = useState<{ id: number; message: string; kind: ToastKind } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const dialogSeq = useRef(0);

  const push = useCallback((p: NewPending) => {
    dialogSeq.current += 1;
    setQueue((q) => [...q, { ...p, id: dialogSeq.current } as Pending]);
  }, []);
  const shift = useCallback(() => setQueue((q) => q.slice(1)), []);

  const api = useMemo<DialogsApi>(() => {
    const show = (message: string, kind: ToastKind = 'info') => {
      if (timer.current) clearTimeout(timer.current);
      seq.current += 1;
      setToast({ id: seq.current, message, kind });
      if (kind !== 'info') buzz(kind === 'success' ? 'success' : 'error');
      timer.current = setTimeout(() => setToast(null), kind === 'error' ? 5000 : 2800);
    };
    return {
      toast: show,
      fail: (error, fallback) => show(friendlyError(error, fallback), 'error'),
      confirm: (o) => new Promise<boolean>((resolve) => push({ type: 'confirm', o, resolve })),
      prompt: (o) => new Promise<string | null>((resolve) => push({ type: 'prompt', o, resolve })),
      alert: (title, message) => new Promise<void>((resolve) => push({ type: 'alert', o: { title, message }, resolve })),
    };
  }, [push]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const current = queue[0];
  return (
    <DialogsContext.Provider value={api}>
      {children}
      <ToastView toast={toast} onHide={() => setToast(null)} />
      {current ? <DialogView key={current.id} pending={current} done={shift} /> : null}
    </DialogsContext.Provider>
  );
}

function ToastView({ toast, onHide }: { toast: { id: number; message: string; kind: ToastKind } | null; onHide: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, { toValue: toast ? 1 : 0, duration: 180, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [toast, anim]);

  if (!toast) return null;
  const tone = toast.kind === 'error' ? c.danger : toast.kind === 'success' ? c.success : c.text;
  const icon = toast.kind === 'error' ? 'alert-circle' : toast.kind === 'success' ? 'checkmark-circle' : 'information-circle';
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.toastHost,
        { top: insets.top + 8, opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }] },
      ]}
    >
      <Pressable
        onPress={onHide}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.toast, { backgroundColor: c.isDark ? '#262626' : '#262626', borderLeftColor: tone }]}
      >
        <Icon name={icon} size={20} color={tone === c.text ? '#FFFFFF' : tone} />
        <Text variant="callout" style={{ color: '#FFFFFF', flex: 1 }}>
          {toast.message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function DialogView({ pending, done }: { pending: Pending; done: () => void }) {
  const c = useColors();
  const [text, setText] = useState(pending.type === 'prompt' ? pending.o.initial ?? '' : '');

  const finish = (fn: () => void) => {
    done();
    fn();
  };

  let buttons: { label: string; onPress: () => void; bold?: boolean; danger?: boolean }[] = [];
  if (pending.type === 'confirm') {
    const { o, resolve } = pending;
    buttons = [
      { label: o.cancelLabel ?? 'Anuluj', onPress: () => finish(() => resolve(false)) },
      { label: o.confirmLabel ?? 'OK', onPress: () => finish(() => resolve(true)), bold: true, danger: o.destructive },
    ];
  } else if (pending.type === 'prompt') {
    const { o, resolve } = pending;
    const blocked = o.required !== false && text.trim().length === 0;
    buttons = [
      { label: 'Anuluj', onPress: () => finish(() => resolve(null)) },
      { label: o.confirmLabel ?? 'OK', onPress: () => { if (!blocked) finish(() => resolve(text.trim())); }, bold: true },
    ];
  } else {
    const { resolve } = pending;
    buttons = [{ label: 'OK', onPress: () => finish(resolve), bold: true }];
  }

  const cancel = () => {
    if (pending.type === 'confirm') finish(() => pending.resolve(false));
    else if (pending.type === 'prompt') finish(() => pending.resolve(null));
    else finish(pending.resolve);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={cancel} statusBarTranslucent>
      <View style={[styles.backdrop, { backgroundColor: c.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={cancel} accessibilityLabel="Zamknij okno" />
        <View style={[styles.card, { backgroundColor: c.surface }]} accessibilityViewIsModal>
          <View style={styles.cardBody}>
            <Text variant="headline" align="center">
              {pending.o.title}
            </Text>
            {pending.o.message ? (
              <Text variant="callout" color="secondary" align="center">
                {pending.o.message}
              </Text>
            ) : null}
            {pending.type === 'prompt' ? (
              <TextField
                autoFocus
                value={text}
                onChangeText={setText}
                placeholder={pending.o.placeholder}
                multiline={pending.o.multiline}
                keyboardType={pending.o.keyboardType}
                onSubmitEditing={pending.o.multiline ? undefined : buttons[1].onPress}
              />
            ) : null}
          </View>
          <View style={[styles.buttons, { borderTopColor: c.border }]}>
            {buttons.map((b, i) => (
              <Touchable
                key={b.label}
                onPress={b.onPress}
                accessibilityLabel={b.label}
                style={[styles.button, i > 0 ? { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: c.border } : null]}
              >
                <Text variant="bodyBold" style={{ color: b.danger ? c.danger : b.bold ? c.primary : c.text, fontWeight: b.bold ? '700' : '400' }}>
                  {b.label}
                </Text>
              </Touchable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  toastHost: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 16, zIndex: 1000 },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: layout.maxContent, width: '100%',
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.m, borderLeftWidth: 4,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  card: { width: '100%', maxWidth: 340, borderRadius: radius.l, overflow: 'hidden' },
  cardBody: { padding: 20, gap: 8 },
  buttons: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  button: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
});
