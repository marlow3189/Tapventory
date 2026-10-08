import { StyleSheet, View } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { Icon } from './Icon';
import { Text } from './Text';
import { useColors } from '@/theme';

/** Pasek „Brak internetu" — pokazuje się sam, znika po odzyskaniu sieci. */
export function OfflineBanner() {
  const net = useNetInfo();
  const c = useColors();
  if (net.isConnected !== false) return null;
  return (
    <View style={[styles.bar, { backgroundColor: c.danger }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Icon name="cloud-offline-outline" size={16} color="#FFFFFF" />
      <Text variant="footnote" bold style={{ color: '#FFFFFF' }}>
        Brak internetu — pokazujemy ostatnio pobrane dane
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 12 },
});
