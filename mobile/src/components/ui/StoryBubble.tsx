import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { brandGradient, layout, useColors } from '@/theme';
import { CountBadge } from './Badges';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { Touchable } from './Touchable';

/**
 * Kółko „stories" z Instagrama — u nas to zadanie na dziś.
 * Gradientowy pierścień = jest coś do zrobienia; szary = wszystko załatwione.
 */
export function StoryBubble({
  label, icon, count, urgent, onPress, size = layout.storySize,
}: {
  label: string; icon: IconName; count: number; urgent: boolean; onPress: () => void; size?: number;
}) {
  const c = useColors();
  const inner = size - 10;
  return (
    <Touchable
      haptic
      onPress={onPress}
      accessibilityLabel={count > 0 ? `${label}: ${count} do zrobienia` : `${label}: nic do zrobienia`}
      style={[styles.item, { width: size + 12 }]}
    >
      <View style={{ width: size, height: size }}>
        {urgent ? (
          <LinearGradient
            colors={[...brandGradient]}
            start={{ x: 0.1, y: 1 }}
            end={{ x: 0.9, y: 0 }}
            style={[styles.ring, { width: size, height: size, borderRadius: size / 2 }]}
          />
        ) : (
          <View style={[styles.ring, { width: size, height: size, borderRadius: size / 2, backgroundColor: c.border }]} />
        )}
        <View
          style={[
            styles.core,
            { width: size - 6, height: size - 6, borderRadius: (size - 6) / 2, backgroundColor: c.bg, top: 3, left: 3 },
          ]}
        >
          <View style={[styles.face, { width: inner - 4, height: inner - 4, borderRadius: (inner - 4) / 2, backgroundColor: c.fill }]}>
            <Icon name={icon} size={26} color={urgent ? c.text : c.textSecondary} />
          </View>
        </View>
        <View style={styles.badge}>
          <CountBadge count={count} />
        </View>
      </View>
      <Text variant="footnote" color={urgent ? 'primary' : 'secondary'} numberOfLines={1} style={styles.label}>
        {label}
      </Text>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  item: { alignItems: 'center', gap: 6 },
  ring: { position: 'absolute', top: 0, left: 0 },
  core: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  face: { alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -2, right: -4 },
  label: { textAlign: 'center' },
});
