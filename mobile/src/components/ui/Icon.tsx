import type { ComponentProps } from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '@/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Icon({ name, size = 24, color, style }: { name: IconName; size?: number; color?: string; style?: StyleProp<TextStyle> }) {
  const c = useColors();
  return <Ionicons name={name} size={size} color={color ?? c.text} style={style} accessible={false} />;
}
