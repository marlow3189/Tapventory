import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon, Text } from '@/components/ui';
import { brandGradient } from '@/theme';

/** Znak firmowy: gradientowy kwadrat z pudełkiem + nazwa. Ten sam motyw ma ikona aplikacji. */
export function BrandMark({ size = 72, withName }: { size?: number; withName?: boolean }) {
  return (
    <View style={styles.wrap}>
      <LinearGradient
        colors={[...brandGradient]}
        start={{ x: 0, y: 1 }}
        end={{ x: 1, y: 0 }}
        style={{ width: size, height: size, borderRadius: size * 0.26, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="cube-outline" size={size * 0.56} color="#FFFFFF" />
      </LinearGradient>
      {withName ? (
        <Text variant="largeTitle" style={styles.name} accessibilityRole="header">
          Tapventory
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 12 },
  name: { fontWeight: '800', letterSpacing: -0.5 },
});
