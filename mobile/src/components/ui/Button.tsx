import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, useColors } from '@/theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { Touchable } from './Touchable';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost';

export type ButtonProps = {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'm' | 's';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export function Button({ title, onPress, variant = 'primary', size = 'm', icon, loading, disabled, fullWidth, style, accessibilityLabel }: ButtonProps) {
  const c = useColors();
  const palette: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: c.primary, fg: c.textOnPrimary },
    secondary: { bg: c.fill, fg: c.text },
    danger: { bg: c.danger, fg: '#FFFFFF' },
    outline: { bg: 'transparent', fg: c.text, border: c.border },
    ghost: { bg: 'transparent', fg: c.primary },
  };
  const p = palette[variant];
  const off = disabled || loading;
  return (
    <Touchable
      haptic
      onPress={off ? undefined : onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(loading) }}
      style={[
        styles.base,
        size === 's' ? styles.small : styles.medium,
        { backgroundColor: p.bg, borderColor: p.border ?? 'transparent', borderWidth: p.border ? 1 : 0 },
        fullWidth ? styles.full : null,
        style,
      ]}
    >
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator size="small" color={p.fg} />
        ) : icon ? (
          <Icon name={icon} size={size === 's' ? 16 : 20} color={p.fg} />
        ) : null}
        <Text variant={size === 's' ? 'subhead' : 'bodyBold'} bold style={{ color: p.fg }} numberOfLines={1}>
          {title}
        </Text>
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.m, alignItems: 'center', justifyContent: 'center' },
  medium: { minHeight: 44, paddingHorizontal: 18 },
  small: { minHeight: 34, paddingHorizontal: 14, borderRadius: radius.s },
  full: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
