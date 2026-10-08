// Ramy ekranów: nagłówek w stylu Instagrama (strzałka, wyśrodkowany tytuł, akcje po prawej),
// obszar bezpieczny (wcięcie, zaokrąglone rogi), przewijanie i unikanie klawiatury.

import { type PropsWithChildren, type ReactNode } from 'react';
import {
  KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, useColors } from '@/theme';
import { Icon, type IconName } from './Icon';
import { OfflineBanner } from './OfflineBanner';
import { Text } from './Text';
import { Touchable } from './Touchable';

export function useGoBack() {
  const router = useRouter();
  return () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
}

export function HeaderButton({ icon, onPress, label, color }: { icon: IconName; onPress: () => void; label: string; color?: string }) {
  return (
    <Touchable onPress={onPress} accessibilityLabel={label} style={styles.hbtn} haptic>
      <Icon name={icon} size={26} color={color} />
    </Touchable>
  );
}

export function ScreenHeader({ title, back = true, left, right, large }: {
  title?: string; back?: boolean; left?: ReactNode; right?: ReactNode; large?: boolean;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const goBack = useGoBack();
  return (
    <View style={[styles.header, { paddingTop: insets.top, backgroundColor: c.bg, borderBottomColor: c.borderLight }]}>
      <View style={styles.headerRow}>
        <View style={styles.side}>{left ?? (back ? <HeaderButton icon="chevron-back" onPress={goBack} label="Wstecz" /> : null)}</View>
        {title ? (
          <Text variant={large ? 'title' : 'headline'} numberOfLines={1} style={styles.headerTitle} accessibilityRole="header">
            {title}
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <View style={[styles.side, { alignItems: 'flex-end' }]}>{right}</View>
      </View>
      <OfflineBanner />
    </View>
  );
}

type ScreenProps = PropsWithChildren<{
  title?: string;
  back?: boolean;
  headerLeft?: ReactNode;
  headerRight?: ReactNode;
  /** przewijany ekran (formularze, szczegóły) */
  scroll?: boolean;
  /** brak nagłówka (np. ekrany z własnym) */
  noHeader?: boolean;
  padded?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}>;

export function Screen({
  title, back = true, headerLeft, headerRight, scroll, noHeader, padded = true, refreshing, onRefresh, footer, contentStyle, children,
}: ScreenProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const bottom = footer ? 0 : insets.bottom;
  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      {noHeader ? <View style={{ height: insets.top }} /> : <ScreenHeader title={title} back={back} left={headerLeft} right={headerRight} />}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={[padded ? { padding: spacing.l } : null, { paddingBottom: bottom + spacing.xl, gap: spacing.l }, contentStyle]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={c.textSecondary} /> : undefined}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[{ flex: 1 }, padded ? { padding: spacing.l } : null, contentStyle]}>{children}</View>
        )}
        {footer ? (
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.m), borderTopColor: c.border, backgroundColor: c.bg }]}>{footer}</View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { borderBottomWidth: StyleSheet.hairlineWidth },
  headerRow: { height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.s },
  side: { minWidth: 72, flexDirection: 'row', alignItems: 'center', gap: 2 },
  headerTitle: { flex: 1, textAlign: 'center', fontWeight: '700' },
  hbtn: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  footer: { paddingHorizontal: spacing.l, paddingTop: spacing.m, borderTopWidth: StyleSheet.hairlineWidth, gap: spacing.s },
});
