import type { PropsWithChildren, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Screen, Text } from '@/components/ui';
import { BrandMark } from './BrandMark';

/** Wspólna rama ekranów logowania: znak firmowy, tytuł, formularz, linki pod spodem. */
export function AuthShell({ title, subtitle, footer, children, back }: PropsWithChildren<{
  title: string; subtitle?: string; footer?: ReactNode; back?: boolean;
}>) {
  return (
    <Screen noHeader={!back} back={back} scroll contentStyle={styles.content}>
      <View style={styles.column}>
        <View style={styles.top}>
          <BrandMark size={64} />
          <Text variant="largeTitle" align="center" accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? (
            <Text color="secondary" align="center">
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={styles.form}>{children}</View>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center' },
  column: { width: '100%', maxWidth: 420, alignSelf: 'center', gap: 28 },
  top: { alignItems: 'center', gap: 10 },
  form: { gap: 16 },
  footer: { alignItems: 'center', gap: 10 },
});
