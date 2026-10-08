import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { typography, useColors, type TextVariant } from '@/theme';

export type TextColor =
  | 'primary' | 'secondary' | 'tertiary' | 'accent' | 'link'
  | 'danger' | 'success' | 'warning' | 'onPrimary';

export type TextProps = RNTextProps & {
  variant?: TextVariant;
  color?: TextColor;
  align?: TextStyle['textAlign'];
  bold?: boolean;
};

export function Text({ variant = 'body', color = 'primary', align, bold, style, ...rest }: TextProps) {
  const c = useColors();
  const colors: Record<TextColor, string> = {
    primary: c.text, secondary: c.textSecondary, tertiary: c.textTertiary, accent: c.primary, link: c.link,
    danger: c.danger, success: c.success, warning: c.warning, onPrimary: c.textOnPrimary,
  };
  return (
    <RNText
      {...rest}
      style={[typography[variant], { color: colors[color] }, bold ? { fontWeight: '700' } : null, align ? { textAlign: align } : null, style]}
    />
  );
}
