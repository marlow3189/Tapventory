// Wiersz listy w stylu "inset grouped" (Ustawienia iOS): białe karty
// z zaokrąglonym pierwszym i ostatnim wierszem, cienkie separatory z wcięciem.

import type { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, touchTarget, typography } from '../../theme/tokens';

type RowProps = {
  title: string;
  /** tekst po prawej stronie (np. stan magazynowy) */
  detail?: string;
  detailColor?: string;
  onPress?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
};

export function ListRow({ title, detail, detailColor, onPress, isFirst, isLast }: RowProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.row,
        isFirst && { borderTopLeftRadius: radius.s, borderTopRightRadius: radius.s },
        isLast && { borderBottomLeftRadius: radius.s, borderBottomRightRadius: radius.s },
        pressed && { backgroundColor: colors.fill },
      ]}
    >
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.right}>
        {detail ? (
          <Text style={[styles.detail, detailColor ? { color: detailColor } : null]}>
            {detail}
          </Text>
        ) : null}
        {onPress ? <Text style={styles.chevron}>›</Text> : null}
      </View>
    </Pressable>
  );
}

/** Separator między wierszami — cienka linia z wcięciem 16 pt od lewej. */
export function RowSeparator() {
  return <View style={styles.separator} />;
}

/** Nagłówek sekcji: małe wersaliki nad grupą wierszy. */
export function SectionHeader({ children }: PropsWithChildren) {
  return <Text style={styles.section}>{String(children).toUpperCase()}</Text>;
}

const styles = StyleSheet.create({
  row: {
    minHeight: touchTarget,
    backgroundColor: colors.cellBackground,
    paddingHorizontal: spacing.m,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { ...typography.body, color: colors.label, flexShrink: 1, marginRight: spacing.s },
  right: { flexDirection: 'row', alignItems: 'center' },
  detail: { ...typography.body, color: colors.secondaryLabel },
  chevron: { fontSize: 20, color: colors.chevron, marginLeft: spacing.s, marginTop: -2 },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginLeft: spacing.m,
  },
  section: {
    ...typography.footnote,
    color: colors.secondaryLabel,
    marginBottom: spacing.s,
    marginLeft: spacing.m,
    marginTop: spacing.l,
  },
});
