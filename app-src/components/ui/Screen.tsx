// Szkielet ekranu: szare tło "grouped" jak w Ustawieniach iOS,
// duży tytuł (34 pt, pogrubiony) i przewijana zawartość.
// Każdy ekran aplikacji zaczyna się od <Screen title="...">.

import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, typography } from '../../theme/tokens';

type Props = PropsWithChildren<{
  title: string;
  subtitle?: string;
  /** false = ekran bez przewijania (np. formularz logowania) */
  scroll?: boolean;
}>;

export function Screen({ title, subtitle, scroll = true, children }: Props) {
  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {header}
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, { flex: 1 }]}>
          {header}
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.groupedBackground },
  content: { padding: spacing.m, paddingBottom: spacing.xl },
  header: { marginTop: spacing.s, marginBottom: spacing.l },
  title: { ...typography.largeTitle, color: colors.label },
  subtitle: { ...typography.subhead, color: colors.secondaryLabel, marginTop: spacing.xs },
});
