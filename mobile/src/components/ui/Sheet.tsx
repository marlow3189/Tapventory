// Arkusz wysuwany od dołu (jak menu „+" i „Udostępnij" w Instagramie).
// Zbudowany na Modal z React Native — działa tak samo na iOS, Androidzie i w przeglądarce.

import { useEffect, useState, type PropsWithChildren } from 'react';
import { Animated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { layout, radius, useColors } from '@/theme';
import { Text } from './Text';

export function Sheet({ visible, onClose, title, children, scroll = false }: PropsWithChildren<{
  visible: boolean; onClose: () => void; title?: string; scroll?: boolean;
}>) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [slide] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (visible) {
      slide.setValue(0);
      Animated.spring(slide, { toValue: 1, useNativeDriver: Platform.OS !== 'web', damping: 22, stiffness: 240, mass: 0.9 }).start();
    }
  }, [visible, slide]);

  const body = (
    <View style={{ paddingBottom: Math.max(insets.bottom, 12) + 8 }}>
      {title ? (
        <Text variant="headline" align="center" style={styles.title}>
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay }]} onPress={onClose} accessibilityLabel="Zamknij" accessibilityRole="button" />
        <Animated.View
          style={[
            styles.panel,
            { backgroundColor: c.surface, transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }], opacity: slide },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: c.border }]} />
          {scroll ? <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>{body}</ScrollView> : body}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  panel: {
    width: '100%', maxWidth: layout.maxContent, borderTopLeftRadius: radius.l, borderTopRightRadius: radius.l,
    paddingTop: 8, maxHeight: '88%', overflow: 'hidden',
  },
  scroll: { flexGrow: 0 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 8 },
  title: { paddingVertical: 8 },
});
