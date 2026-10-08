import { type PropsWithChildren, type ReactNode } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { radius, spacing, useColors } from '@/theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { Touchable } from './Touchable';

/** Grupa wierszy z nagłówkiem (jak ustawienia w Instagramie / iOS). */
export function Section({ title, footer, children }: PropsWithChildren<{ title?: string; footer?: string }>) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      {title ? (
        <Text variant="footnote" color="secondary" bold style={styles.sectionTitle}>
          {title.toUpperCase()}
        </Text>
      ) : null}
      <View style={[styles.group, { backgroundColor: c.bgSecondary, borderColor: c.borderLight }]}>{children}</View>
      {footer ? (
        <Text variant="footnote" color="secondary" style={styles.sectionTitle}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

export function ListRow({
  icon, title, subtitle, value, onPress, right, danger, switchValue, onSwitch, last, iconColor, chevron,
}: {
  icon?: IconName; title: string; subtitle?: string; value?: string; onPress?: () => void; right?: ReactNode;
  danger?: boolean; switchValue?: boolean; onSwitch?: (v: boolean) => void; last?: boolean; iconColor?: string; chevron?: boolean;
}) {
  const c = useColors();
  const isSwitch = typeof switchValue === 'boolean';
  const content = (
    <View style={[styles.row, !last ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border } : null]}>
      {icon ? <Icon name={icon} size={22} color={danger ? c.danger : iconColor ?? c.text} /> : null}
      <View style={styles.texts}>
        <Text variant="body" style={danger ? { color: c.danger } : undefined}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" color="secondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="callout" color="secondary" numberOfLines={1} style={{ maxWidth: '40%' }}>
          {value}
        </Text>
      ) : null}
      {right}
      {isSwitch ? (
        <Switch
          value={switchValue}
          onValueChange={onSwitch}
          trackColor={{ true: c.primary, false: c.border }}
          accessibilityLabel={title}
        />
      ) : onPress && chevron !== false ? (
        <Icon name="chevron-forward" size={18} color={c.textTertiary} />
      ) : null}
    </View>
  );
  if (onPress && !isSwitch) {
    return (
      <Touchable onPress={onPress} accessibilityLabel={title} pressedOpacity={0.5}>
        {content}
      </Touchable>
    );
  }
  return content;
}

const styles = StyleSheet.create({
  sectionTitle: { marginHorizontal: spacing.s },
  group: { borderRadius: radius.m, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.m, paddingHorizontal: spacing.l, paddingVertical: 12, minHeight: 52 },
  texts: { flex: 1, gap: 2 },
});
