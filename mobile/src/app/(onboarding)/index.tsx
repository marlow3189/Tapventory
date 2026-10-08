import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AuthShell } from '@/components/AuthShell';
import { Button, Text, Touchable, Icon, useDialogs } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { radius, useColors } from '@/theme';

export default function OnboardingChoice() {
  const c = useColors();
  const router = useRouter();
  const { signOut, user } = useAuth();
  const { confirm } = useDialogs();

  const option = (icon: 'business-outline' | 'key-outline', title: string, text: string, onPress: () => void) => (
    <Touchable onPress={onPress} accessibilityLabel={title} style={[styles.card, { borderColor: c.border, backgroundColor: c.bgSecondary }]}>
      <View style={[styles.iconBox, { backgroundColor: c.fill }]}>
        <Icon name={icon} size={26} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="headline">{title}</Text>
        <Text variant="callout" color="secondary">
          {text}
        </Text>
      </View>
      <Icon name="chevron-forward" size={18} color={c.textTertiary} />
    </Touchable>
  );

  return (
    <AuthShell
      title="Witaj w Tapventory"
      subtitle="Wybierz, jak zaczynasz. Nowa firma dostaje 14 dni pełnej wersji za darmo — bez karty."
      footer={
        <>
          <Text variant="footnote" color="secondary">
            Zalogowano jako {user?.email}
          </Text>
          <Button
            title="Wyloguj"
            variant="ghost"
            size="s"
            onPress={async () => {
              if (await confirm({ title: 'Wylogować?', confirmLabel: 'Wyloguj' })) await signOut();
            }}
          />
        </>
      }
    >
      {option('business-outline', 'Zakładam firmę', 'Szef lub właściciel — tworzysz magazyn i zapraszasz zespół.', () => router.push('/create-company'))}
      {option('key-outline', 'Mam kod zaproszenia', 'Szef zaprosił Cię do firmy — wpisz kod z wiadomości.', () => router.push('/join'))}
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: radius.l, borderWidth: 1 },
  iconBox: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
