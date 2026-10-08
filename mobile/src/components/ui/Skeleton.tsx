import { useEffect, useState } from 'react';
import { Animated, Platform, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import { radius, spacing, useColors } from '@/theme';

/** Szary, pulsujący zaślepnik na czas ładowania (zamiast kręcącego się kółka). */
export function Skeleton({ width = '100%', height = 14, round = radius.s, style }: {
  width?: DimensionValue; height?: DimensionValue; round?: number; style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const [pulse] = useState(() => new Animated.Value(0.55));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View accessible={false} style={[{ width, height, borderRadius: round, backgroundColor: c.skeleton, opacity: pulse }, style]} />;
}

/** Szkielet karty z feedu (zgłoszenie). */
export function FeedCardSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Skeleton width={34} height={34} round={17} />
        <View style={{ gap: 6, flex: 1 }}>
          <Skeleton width="45%" height={12} />
          <Skeleton width="25%" height={10} />
        </View>
      </View>
      <Skeleton height={260} round={0} />
      <View style={{ paddingHorizontal: spacing.l, gap: 8 }}>
        <Skeleton width="60%" height={14} />
        <Skeleton width="35%" height={12} />
      </View>
    </View>
  );
}

export function RowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View style={{ gap: 14, padding: spacing.l }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={44} height={44} round={22} />
          <View style={{ gap: 6, flex: 1 }}>
            <Skeleton width="55%" height={13} />
            <Skeleton width="35%" height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12, paddingVertical: spacing.m },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.l },
});
