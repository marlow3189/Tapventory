import { StyleSheet, View } from 'react-native';
import { friendlyError } from '@/lib/errors';
import { spacing, useColors } from '@/theme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/** Pusty ekran z wyjaśnieniem i jednym wyraźnym następnym krokiem. */
export function EmptyState({ icon = 'albums-outline', title, message, actionLabel, onAction }: {
  icon?: IconName; title: string; message?: string; actionLabel?: string; onAction?: () => void;
}) {
  const c = useColors();
  return (
    <View style={styles.wrap}>
      <View style={[styles.circle, { borderColor: c.text }]}>
        <Icon name={icon} size={34} />
      </View>
      <Text variant="title" align="center">
        {title}
      </Text>
      {message ? (
        <Text color="secondary" align="center" style={styles.msg}>
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? <Button title={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

/** Błąd ładowania — zawsze z przyciskiem „Spróbuj ponownie". */
export function ErrorState({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  return (
    <View style={styles.wrap}>
      <Icon name="cloud-offline-outline" size={44} />
      <Text variant="headline" align="center">
        Nie udało się wczytać danych
      </Text>
      <Text color="secondary" align="center" style={styles.msg}>
        {friendlyError(error, 'Sprawdź połączenie z internetem i spróbuj ponownie.')}
      </Text>
      {onRetry ? <Button title="Spróbuj ponownie" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', gap: spacing.m, padding: spacing.xl, paddingVertical: 48 },
  circle: { width: 76, height: 76, borderRadius: 38, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  msg: { maxWidth: 320 },
});
