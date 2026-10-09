// Asystent AI: odpowiada na pytania „jak to zrobić w Tapventory?" (instrukcja zaszyta po stronie serwera).
// Nie widzi danych firmy — tylko treść pytania. Dzienny limit pytań pilnuje serwer.

import { useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { AiConsentSheet } from '@/components/AiConsentSheet';
import { Icon, Screen, Text, TextField, Touchable, useDialogs } from '@/components/ui';
import { invokeFunction } from '@/lib/api/functions';
import { useAiConsent } from '@/lib/consent';
import { useTenant } from '@/lib/tenant';
import { radius, useColors } from '@/theme';

type Msg = { role: 'user' | 'assistant'; text: string };

const SUGGESTIONS = [
  'Jak zdjąć towar z magazynu?',
  'Jak zeskanować fakturę?',
  'Jak zaprosić pracownika?',
  'Co to jest mini-spis?',
  'Jak cofnąć zaksięgowaną fakturę?',
];

export default function Assistant() {
  const c = useColors();
  const { tenantId } = useTenant();
  const { fail } = useDialogs();
  const consent = useAiConsent();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const scroller = useRef<ScrollView>(null);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    if (consent.consented === false) {
      setDraft(q);
      return setConsentOpen(true);
    }
    const next: Msg[] = [...messages, { role: 'user', text: q }];
    setMessages(next);
    setDraft('');
    setBusy(true);
    try {
      const res = await invokeFunction<{ reply: string }>('assistant', {
        tenant_id: tenantId,
        platform: Platform.OS, // iOS dostaje odpowiedzi bez cen i odesłań do płatności poza App Store
        messages: next.slice(-10).map((m) => ({ role: m.role, content: m.text })),
      });
      setMessages((cur) => [...cur, { role: 'assistant', text: res.reply }]);
    } catch (e) {
      fail(e);
      setMessages(next.slice(0, -1));
      setDraft(q);
    } finally {
      setBusy(false);
      setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    }
  }

  return (
    <Screen
      title="Asystent AI"
      padded={false}
      footer={
        <View style={styles.composer}>
          <View style={{ flex: 1 }}>
            <TextField value={draft} onChangeText={setDraft} placeholder="Zadaj pytanie…" returnKeyType="send" onSubmitEditing={() => void ask(draft)} editable={!busy} />
          </View>
          <Touchable onPress={() => void ask(draft)} disabled={!draft.trim() || busy} accessibilityLabel="Wyślij" style={[styles.send, { backgroundColor: c.primary }]}>
            <Icon name="arrow-up" size={22} color="#FFFFFF" />
          </Touchable>
        </View>
      }
    >
      <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <View style={[styles.bubble, styles.bot, { backgroundColor: c.fill }]}>
          <Text>Cześć! Wyjaśnię, jak coś zrobić w Tapventory. Nie widzę danych Twojej firmy — odpowiadam tylko na podstawie instrukcji aplikacji.</Text>
        </View>
        {messages.length === 0
          ? SUGGESTIONS.map((s) => (
              <Touchable key={s} onPress={() => void ask(s)} accessibilityLabel={s} style={[styles.suggest, { borderColor: c.border }]}>
                <Text color="accent">{s}</Text>
              </Touchable>
            ))
          : messages.map((m, i) => (
              <View key={i} style={[styles.bubble, m.role === 'user' ? [styles.me, { backgroundColor: c.primary }] : [styles.bot, { backgroundColor: c.fill }]]}>
                <Text selectable style={m.role === 'user' ? { color: '#FFFFFF' } : undefined}>
                  {m.text}
                </Text>
              </View>
            ))}
        {busy ? (
          <View style={[styles.bubble, styles.bot, { backgroundColor: c.fill }]}>
            <Text color="secondary">Piszę odpowiedź…</Text>
          </View>
        ) : null}
        <Text variant="footnote" color="tertiary" align="center" style={{ marginTop: 8 }}>
          Asystent AI może się mylić. Przy ważnych sprawach sprawdź w instrukcji lub napisz do nas.
        </Text>
      </ScrollView>

      <AiConsentSheet
        visible={consentOpen}
        onClose={() => setConsentOpen(false)}
        onAccept={async () => {
          await consent.give();
          setConsentOpen(false);
          void ask(draft);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10 },
  bubble: { maxWidth: '85%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.l },
  bot: { alignSelf: 'flex-start' },
  me: { alignSelf: 'flex-end' },
  suggest: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
