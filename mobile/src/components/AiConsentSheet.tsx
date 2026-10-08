import { StyleSheet, View } from 'react-native';
import { Linking } from 'react-native';
import { Button, Icon, Sheet, Text } from '@/components/ui';
import { AI_PROVIDER_LABEL } from '@/lib/consent';
import { LINKS } from '@/lib/links';
import { useColors } from '@/theme';

/** Okno zgody przed pierwszym użyciem AI do odczytu faktury (wymóg Apple 5.1.2(i) i RODO). */
export function AiConsentSheet({ visible, onAccept, onClose }: { visible: boolean; onAccept: () => void; onClose: () => void }) {
  const c = useColors();
  return (
    <Sheet visible={visible} onClose={onClose} title="Odczyt faktury przez AI" scroll>
      <View style={styles.body}>
        <Row icon="send-outline" title="Co wysyłamy">
          Zdjęcie lub PDF faktury, które wybierzesz. Faktura może zawierać dane osobowe (np. nazwę i adres kontrahenta).
        </Row>
        <Row icon="business-outline" title="Komu">
          {`Dostawcy usługi AI: ${AI_PROVIDER_LABEL}. Tylko w celu odczytania pozycji z tej faktury.`}
        </Row>
        <Row icon="shield-checkmark-outline" title="Co dalej">
          Nie używamy faktur do reklamy ani do trenowania modeli. Dokument zostaje w Twojej firmie (prywatny magazyn plików). Zgodę możesz wycofać w Ustawieniach —
          wtedy pozycje wpisujesz ręcznie.
        </Row>
        <Text variant="footnote" color="secondary" onPress={() => void Linking.openURL(LINKS.privacy)} style={{ color: c.primary }}>
          Polityka prywatności
        </Text>
        <Button title="Zgadzam się" onPress={onAccept} fullWidth />
        <Button title="Nie teraz" variant="ghost" onPress={onClose} fullWidth />
      </View>
    </Sheet>
  );
}

function Row({ icon, title, children }: { icon: 'send-outline' | 'business-outline' | 'shield-checkmark-outline'; title: string; children: string }) {
  return (
    <View style={styles.row}>
      <Icon name={icon} size={24} />
      <View style={{ flex: 1 }}>
        <Text bold>{title}</Text>
        <Text variant="callout" color="secondary">
          {children}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14, paddingHorizontal: 16, paddingBottom: 8 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
});
