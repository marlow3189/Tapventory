// Menu „+" (środkowy przycisk paska zakładek) — jak tworzenie posta w Instagramie.
// Zbiera w jednym miejscu najczęstsze czynności w magazynie.

import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon, Sheet, Text, Touchable, type IconName } from '@/components/ui';
import { useTenant } from '@/lib/tenant';
import { brandGradient, useColors } from '@/theme';

type CreateApi = { open: () => void; close: () => void };
const CreateContext = createContext<CreateApi>({ open: () => {}, close: () => {} });
export const useCreateSheet = () => useContext(CreateContext);

type Action = { icon: IconName; title: string; subtitle: string; href: Href; managerOnly?: boolean };

const ACTIONS: Action[] = [
  { icon: 'alert-circle-outline', title: 'Zgłoś brak', subtitle: 'Czegoś brakuje lub trzeba dokupić', href: '/request/new' },
  { icon: 'remove-circle-outline', title: 'Zdejmij z magazynu', subtitle: 'Zeskanuj kod i odpisz zużycie', href: '/scan?mode=take' },
  { icon: 'checkmark-done-outline', title: 'Mini-spis', subtitle: 'Policz kilka produktów (1–2 minuty)', href: '/count' },
  { icon: 'add-circle-outline', title: 'Dodaj produkt', subtitle: 'Nowa pozycja w magazynie', href: '/product/edit', managerOnly: true },
  { icon: 'scan-outline', title: 'Skanuj fakturę', subtitle: 'AI odczyta pozycje ze zdjęcia lub PDF', href: '/documents/scan', managerOnly: true },
];

export function CreateSheetProvider({ children }: PropsWithChildren) {
  const c = useColors();
  const router = useRouter();
  const { isManager } = useTenant();
  const [visible, setVisible] = useState(false);
  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  const api = useMemo(() => ({ open, close }), [open, close]);

  const go = (href: Href) => {
    setVisible(false);
    // krótka zwłoka, by arkusz zdążył się zamknąć przed animacją przejścia
    setTimeout(() => router.push(href), 80);
  };

  return (
    <CreateContext.Provider value={api}>
      {children}
      <Sheet visible={visible} onClose={close} title="Co chcesz zrobić?">
        <View style={styles.list}>
          {ACTIONS.filter((a) => !a.managerOnly || isManager).map((a) => (
            <Touchable key={a.title} onPress={() => go(a.href)} accessibilityLabel={a.title} style={styles.item}>
              <LinearGradient colors={[...brandGradient]} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={styles.icon}>
                <Icon name={a.icon} size={22} color="#FFFFFF" />
              </LinearGradient>
              <View style={{ flex: 1 }}>
                <Text variant="bodyBold">{a.title}</Text>
                <Text variant="footnote" color="secondary">
                  {a.subtitle}
                </Text>
              </View>
              <Icon name="chevron-forward" size={18} color={c.textTertiary} />
            </Touchable>
          ))}
        </View>
      </Sheet>
    </CreateContext.Provider>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, gap: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 },
  icon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
