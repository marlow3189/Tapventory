import { StyleSheet, View } from 'react-native';
import { hueFromString, initials } from '@/lib/format';
import { Text } from './Text';

/** Kółko z inicjałami; kolor zawsze ten sam dla tej samej osoby. */
export function Avatar({ name, size = 32 }: { name: string | null | undefined; size?: number }) {
  const hue = hueFromString(name ?? '?');
  return (
    <View
      accessible
      accessibilityLabel={name ?? 'Użytkownik'}
      style={[styles.base, { width: size, height: size, borderRadius: size / 2, backgroundColor: `hsl(${hue}, 55%, 46%)` }]}
    >
      <Text style={{ color: '#FFFFFF', fontSize: Math.max(10, Math.round(size * 0.38)), fontWeight: '700' }}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
});
