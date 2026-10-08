// KSeF: faktury zakupu wpadają do Tapventory same. Ekran pokazuje stan połączenia, ostatnie pobrania
// oraz (gdy KSeF nie jest podłączony) kreator „krok po kroku" z polem na token.
// Token KSeF z uprawnieniem WYŁĄCZNIE do przeglądania faktur: Tapventory nie umie niczego wystawić ani wysłać.

import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { Button, Chips, EmptyState, ErrorState, Icon, ListRow, Pill, RowSkeleton, Screen, Section, Text, TextField, useDialogs } from '@/components/ui';
import { useConnectKsef, useDisconnectKsef, useKsefStatus, useSyncKsef } from '@/lib/api/ksef';
import { setTenantNip } from '@/lib/api/misc';
import { formatDate, timeAgo } from '@/lib/format';
import {
  KSEF_ENVS, KSEF_RANGES, KSEF_STATUS_VIEW, TRIGGER_LABEL, canSyncNow, cleanKsefToken, describeRun, importFromDate,
  type KsefEnv, type KsefRange,
} from '@/lib/ksef';
import { formatNip, isValidNip, normalizeNip } from '@/lib/nip';
import { useTenant } from '@/lib/tenant';
import { radius, spacing, useColors } from '@/theme';

const KSEF_PORTAL = 'https://ksef.podatki.gov.pl';

const STEPS: { title: string; text: string }[] = [
  { title: 'Wejdź do Aplikacji Podatnika KSeF', text: 'To oficjalna strona Ministerstwa Finansów (przycisk poniżej). Zaloguj się tak, jak do urzędowych e-usług: Profilem Zaufanym, podpisem kwalifikowanym lub certyfikatem KSeF.' },
  { title: 'Wybierz swoją firmę', text: 'Po zalogowaniu wybierz kontekst — firmę, której faktury chcesz pobierać (NIP musi być ten sam, co w Tapventory).' },
  { title: 'Utwórz nowy token', text: 'Znajdź sekcję „Tokeny” (w menu uprawnień i dostępu) i wybierz utworzenie tokena. Nazwy w menu mogą się różnić — szukaj słowa „token”.' },
  { title: 'Zaznacz TYLKO „Przeglądanie faktur”', text: 'To jedyne uprawnienie, jakiego potrzebujemy. Nie zaznaczaj wystawiania faktur ani zarządzania uprawnieniami — dzięki temu Tapventory technicznie nie może niczego wystawić w Twoim imieniu. W opisie wpisz „Tapventory”.' },
  { title: 'Skopiuj token', text: 'KSeF pokaże go tylko raz. Skopiuj go w całości (przycisk „Kopiuj” albo zaznacz i skopiuj) i wklej poniżej.' },
];

export default function KsefScreen() {
  const c = useColors();
  const { tenantId, membership, isManager, isOwner, loading, refetch } = useTenant();
  const { confirm, fail, toast } = useDialogs();
  const status = useKsefStatus();
  const connect = useConnectKsef();
  const sync = useSyncKsef();
  const disconnect = useDisconnectKsef();

  const tenantNip = membership?.tenants?.nip ?? null;
  const [wizard, setWizard] = useState(false);
  const [token, setToken] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [nipInput, setNipInput] = useState('');
  const [nipError, setNipError] = useState<string | null>(null);
  const [range, setRange] = useState<KsefRange>('30');
  const [env, setEnv] = useState<KsefEnv>('prod');
  const [advanced, setAdvanced] = useState(false);

  if (!loading && !isManager) return <Redirect href="/home" />;

  const s = status.data;
  const view = s ? KSEF_STATUS_VIEW[s.status] : null;
  const showForm = s ? s.status !== 'connected' || wizard : false;

  async function submit() {
    const cleaned = cleanKsefToken(token);
    setTokenError(cleaned.error);
    const nip = tenantNip ?? normalizeNip(nipInput);
    const nipBad = !isValidNip(nip);
    setNipError(nipBad ? 'Podaj poprawny NIP firmy (10 cyfr).' : null);
    if (cleaned.error || nipBad || !tenantId) return;
    try {
      await connect.mutateAsync({ token: cleaned.token, environment: env, importFrom: importFromDate(range), nip: tenantNip ? undefined : nip });
      if (!tenantNip && isOwner) {
        try {
          await setTenantNip(tenantId, nip);
          await refetch();
        } catch {
          // zapis NIP-u w ustawieniach firmy jest dodatkiem; połączenie już działa
        }
      }
      setToken('');
      setWizard(false);
      toast('Połączono z KSeF. Pobieramy faktury…', 'success');
    } catch (e) {
      fail(e);
    }
  }

  async function syncNow() {
    try {
      await sync.mutateAsync();
      toast('Pobieranie z KSeF rozpoczęte', 'success');
    } catch (e) {
      fail(e);
    }
  }

  async function doDisconnect() {
    const ok = await confirm({
      title: 'Odłączyć KSeF?',
      message: 'Tapventory przestanie pobierać nowe faktury, a zapisany token zostanie usunięty z naszej bazy. Faktury, które już pobraliśmy, zostają.\n\nPamiętaj: sam token nadal działa w KSeF, dopóki go tam nie unieważnisz (Aplikacja Podatnika KSeF → Tokeny → unieważnij).',
      confirmLabel: 'Odłącz',
      destructive: true,
    });
    if (!ok) return;
    try {
      await disconnect.mutateAsync();
      toast('KSeF odłączony', 'success');
    } catch (e) {
      fail(e);
    }
  }

  return (
    <Screen title="KSeF" scroll>
      <View style={[styles.hero, { backgroundColor: c.bgSecondary, borderColor: c.borderLight }]}>
        <View style={[styles.heroIcon, { backgroundColor: c.fill }]}>
          <Icon name="shield-checkmark-outline" size={30} color={c.primary} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={styles.heroTitle}>
            <Text variant="headline">Faktury zakupu z KSeF</Text>
            {view ? <Pill label={view.label} tone={view.tone} /> : null}
          </View>
          <Text variant="callout" color="secondary">
            Faktury od Twoich dostawców wpadają do Tapventory same — jako szkice do sprawdzenia. Bez zdjęć i przepisywania.
          </Text>
        </View>
      </View>

      {status.isPending ? <RowSkeleton count={3} /> : null}
      {status.isError ? <ErrorState error={status.error} onRetry={() => void status.refetch()} /> : null}

      {s && s.status === 'error' ? (
        <View style={[styles.alert, { backgroundColor: c.fill, borderColor: c.danger }]}>
          <Icon name="alert-circle" size={22} color={c.danger} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text bold>Połączenie z KSeF przestało działać</Text>
            <Text variant="callout" color="secondary">
              {s.last_error ?? 'KSeF odrzucił token.'} Wklej nowy token poniżej — dotychczasowe faktury zostają.
            </Text>
          </View>
        </View>
      ) : null}

      {s && s.status !== 'disconnected' ? (
        <Section title="Połączenie">
          <ListRow icon="card-outline" title="NIP" value={s.nip ? formatNip(s.nip) : '—'} chevron={false} />
          {s.environment && s.environment !== 'prod' ? <ListRow icon="flask-outline" title="Środowisko" value={s.environment === 'demo' ? 'Demo (MF)' : 'Test (MF)'} chevron={false} /> : null}
          <ListRow icon="key-outline" title="Token" value={s.token_hint ? `…${s.token_hint}` : 'zapisany'} subtitle="Zaszyfrowany; nie da się go odczytać z aplikacji" chevron={false} />
          <ListRow
            icon="time-outline"
            title="Ostatnie udane pobranie"
            value={s.last_sync_at ? timeAgo(s.last_sync_at) : 'jeszcze nie było'}
            subtitle={s.import_from ? `Pobieramy faktury od ${formatDate(s.import_from)}` : undefined}
            chevron={false}
            last
          />
        </Section>
      ) : null}

      {s && s.status === 'connected' ? (
        <View style={{ gap: spacing.s }}>
          <Button
            title={s.running ? 'Trwa pobieranie…' : 'Synchronizuj teraz'}
            icon="sync-outline"
            onPress={() => void syncNow()}
            loading={sync.isPending || s.running}
            disabled={!canSyncNow(s)}
            fullWidth
          />
          <Text variant="footnote" color="secondary" align="center">
            Automatycznie sprawdzamy KSeF co kilka godzin. Faktura pojawia się u nas zwykle w ciągu kilku minut od jej wystawienia.
          </Text>
        </View>
      ) : null}

      {s && s.status !== 'disconnected' ? (
        <Section title="Ostatnie pobrania">
          {s.runs.length === 0 ? (
            <ListRow icon="hourglass-outline" title="Jeszcze nic nie pobrano" subtitle="Pierwsze pobranie rusza zaraz po połączeniu." chevron={false} last />
          ) : (
            s.runs.slice(0, 6).map((r, i, arr) => {
              const d = describeRun(r);
              const icon = d.tone === 'danger' ? 'alert-circle-outline' : d.tone === 'warning' ? 'warning-outline' : d.tone === 'success' ? 'checkmark-circle-outline' : d.tone === 'info' ? 'sync-outline' : 'remove-circle-outline';
              return (
                <ListRow
                  key={r.id}
                  icon={icon}
                  iconColor={d.tone === 'danger' ? c.danger : d.tone === 'warning' ? c.warning : d.tone === 'success' ? c.success : undefined}
                  title={d.title}
                  subtitle={`${timeAgo(r.started_at)} · ${TRIGGER_LABEL[r.trigger]}${d.detail ? ` · ${d.detail}` : ''}`}
                  chevron={false}
                  last={i === arr.length - 1}
                />
              );
            })
          )}
        </Section>
      ) : null}

      {s && s.status === 'connected' && !wizard ? (
        <Section title="Zarządzanie">
          <ListRow icon="swap-horizontal-outline" title="Wklej nowy token" subtitle="Np. gdy stary wygasł albo został unieważniony" onPress={() => setWizard(true)} last={!isOwner} />
          {isOwner ? <ListRow icon="unlink-outline" title="Odłącz KSeF" danger onPress={() => void doDisconnect()} last /> : null}
        </Section>
      ) : null}

      {s && s.status === 'disconnected' && s.runs.length === 0 ? (
        <EmptyState
          icon="flash-outline"
          title="Podłącz KSeF raz — resztę zrobimy za Ciebie"
          message="Zajmie to około 5 minut. Potrzebujesz dostępu do konta firmy w KSeF (Profil Zaufany lub certyfikat) i telefonu albo komputera."
        />
      ) : null}

      {showForm ? (
        <>
          <Section title="Jak podłączyć — 5 prostych kroków" footer="Nazwy przycisków w Aplikacji Podatnika mogą się trochę różnić; jeśli czegoś nie widzisz, napisz do nas — pomożemy.">
            {STEPS.map((st, i) => (
              <View key={st.title} style={[styles.step, i < STEPS.length - 1 ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border } : null]}>
                <View style={[styles.stepNo, { backgroundColor: c.primary }]}>
                  <Text variant="subhead" bold color="onPrimary">
                    {i + 1}
                  </Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text bold>{st.title}</Text>
                  <Text variant="callout" color="secondary">
                    {st.text}
                  </Text>
                </View>
              </View>
            ))}
          </Section>
          <Button title="Otwórz portal KSeF (Ministerstwo Finansów)" icon="open-outline" variant="secondary" onPress={() => void Linking.openURL(KSEF_PORTAL)} fullWidth />

          <Section
            title="Wklej token"
            footer="Token zapisujemy zaszyfrowany i używamy wyłącznie do czytania Twoich faktur zakupu. W każdej chwili możesz go unieważnić w KSeF."
          >
            <View style={styles.form}>
              <TextField
                label="Token z KSeF"
                value={token}
                onChangeText={(t) => { setToken(t); setTokenError(null); }}
                error={tokenError}
                placeholder="Wklej tutaj cały token"
                multiline
                numberOfLines={3}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
              />
              {!tenantNip ? (
                <TextField
                  label="NIP firmy"
                  value={nipInput}
                  onChangeText={(t) => { setNipInput(t); setNipError(null); }}
                  error={nipError}
                  keyboardType="number-pad"
                  placeholder="000-000-00-00"
                  hint="KSeF loguje się w kontekście NIP-u firmy. Zapiszemy go też w ustawieniach firmy."
                />
              ) : (
                <Text variant="footnote" color="secondary">
                  Firma: NIP {formatNip(tenantNip)}
                </Text>
              )}
              <View style={{ gap: 6 }}>
                <Text variant="subhead" color="secondary" bold>
                  Od kiedy pobierać faktury?
                </Text>
                <Chips options={KSEF_RANGES} value={range} onChange={setRange} />
              </View>
              {advanced ? (
                <View style={{ gap: 6 }}>
                  <Text variant="subhead" color="secondary" bold>
                    Środowisko KSeF (tylko do prób)
                  </Text>
                  <Chips options={KSEF_ENVS} value={env} onChange={setEnv} />
                </View>
              ) : (
                <Button title="Zaawansowane" variant="ghost" size="s" onPress={() => setAdvanced(true)} />
              )}
              <Button title="Połącz z KSeF" icon="link-outline" onPress={() => void submit()} loading={connect.isPending} fullWidth />
              {wizard ? <Button title="Anuluj" variant="ghost" onPress={() => { setWizard(false); setToken(''); }} fullWidth /> : null}
            </View>
          </Section>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', gap: 12, padding: spacing.m, borderRadius: radius.l, borderWidth: 1, alignItems: 'flex-start' },
  heroIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  alert: { flexDirection: 'row', gap: 10, padding: spacing.m, borderRadius: radius.m, borderWidth: 1 },
  step: { flexDirection: 'row', gap: 12, padding: spacing.m, alignItems: 'flex-start' },
  stepNo: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  form: { padding: spacing.m, gap: spacing.m },
});
