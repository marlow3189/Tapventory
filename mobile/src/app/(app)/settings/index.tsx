// Ustawienia firmy i konta: plan i limity, mini-spisy, zlecenia, powiadomienia, zgoda AI,
// instalacja PWA oraz strefa niebezpieczna (usunięcie konta / firmy).

import { useQueryClient } from '@tanstack/react-query';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { Button, Chips, ListRow, Pill, Screen, Section, Text, useDialogs } from '@/components/ui';
import {
  deleteAccount, deleteTenant, setTenantNip, updateTenantContact, useAiQuota, useDashboard, useSettings, useUpdateSettings, type TenantSettings,
} from '@/lib/api/misc';
import { useKsefStatus } from '@/lib/api/ksef';
import { useCreateProject, useProjects, useSetProjectStatus } from '@/lib/api/products';
import { useAuth } from '@/lib/auth';
import { useAiConsent } from '@/lib/consent';
import { formatDate } from '@/lib/format';
import { KSEF_STATUS_VIEW } from '@/lib/ksef';
import { LINKS } from '@/lib/links';
import { formatNip, isValidNip, normalizeNip } from '@/lib/nip';
import { PLANS, planName, type PlanId } from '@/lib/plans';
import { enablePush } from '@/lib/push';
import { useInstallPrompt } from '@/lib/pwa';
import { useTenant } from '@/lib/tenant';
import { spacing } from '@/theme';

// Apple (wytyczna 3.1.3) zabrania, by aplikacja w sklepie iOS zachęcała do płacenia poza App Store —
// poza USA. Dlatego w wersji na iPhone'a NIE wspominamy o stronie z płatnościami (ani o cenach).
// Android i przeglądarka (PWA) mogą kierować do strony. Szczegóły: docs/12_BUDOWANIE_I_PUBLIKACJA.md, rozdział o sklepach.
const PLAN_FOOTER =
  Platform.OS === 'ios'
    ? 'Plan jest przypisany do firmy. Zarządza nim właściciel konta.'
    : 'Zmianę planu i płatności obsługujemy na stronie tapventory.com (konto → plan), poza aplikacją. Ceny netto.';

const FREQ: { value: TenantSettings['count_frequency']; label: string }[] = [
  { value: 'weekly', label: 'Co tydzień' },
  { value: 'biweekly', label: 'Co 2 tygodnie' },
  { value: 'off', label: 'Wyłączone' },
];

export default function Settings() {
  const router = useRouter();
  const qc = useQueryClient();
  const { signOut } = useAuth();
  const { tenantId, tenantName, membership, isManager, isOwner, refetch } = useTenant();
  const { confirm, prompt, fail, toast, alert } = useDialogs();
  const dashboard = useDashboard();
  const quota = useAiQuota();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const projects = useProjects(false);
  const createProject = useCreateProject();
  const setProjectStatus = useSetProjectStatus();
  const consent = useAiConsent();
  const install = useInstallPrompt();
  const ksef = useKsefStatus();

  const plan = (dashboard.data?.plan ?? membership?.tenants?.plan ?? 'solo') as PlanId;
  const trial = dashboard.data?.trial_days_left;
  const s = settings.data;
  const q = quota.data;
  const version = Constants.expoConfig?.version ?? '0.0.0';
  const env = (Constants.expoConfig?.extra?.appEnv as string | undefined) ?? 'development';

  async function patch(p: Partial<TenantSettings>) {
    try {
      await updateSettings.mutateAsync(p);
    } catch (e) {
      fail(e);
    }
  }

  async function renameCompany() {
    const name = await prompt({ title: 'Nazwa firmy', initial: tenantName, confirmLabel: 'Zapisz' });
    if (!name || !tenantId) return;
    try {
      await updateTenantContact(tenantId, { name });
      await refetch();
      toast('Zapisano', 'success');
    } catch (e) {
      fail(e);
    }
  }

  async function changeNip() {
    const typed = await prompt({ title: 'NIP firmy', message: 'Pomaga rozpoznawać faktury. Zmienia go tylko właściciel.', initial: membership?.tenants?.nip ?? '', placeholder: '000-000-00-00', keyboardType: 'numeric', required: false });
    if (typed === null || !tenantId) return;
    const digits = normalizeNip(typed);
    if (digits && !isValidNip(digits)) return fail({ message: 'NIP ma błędną sumę kontrolną — sprawdź cyfry.' });
    try {
      await setTenantNip(tenantId, digits || null);
      await refetch();
      toast('Zapisano NIP', 'success');
    } catch (e) {
      fail(e);
    }
  }

  async function newProject() {
    const name = await prompt({ title: 'Nowe zlecenie', message: 'Np. nazwisko klienta, numer rejestracyjny, nazwa wydarzenia.', placeholder: 'Nazwa zlecenia', confirmLabel: 'Dodaj' });
    if (!name) return;
    try {
      await createProject.mutateAsync({ name });
    } catch (e) {
      fail(e);
    }
  }

  async function removeAccount() {
    const ok = await confirm({
      title: 'Usunąć konto?',
      message: 'Twoje dane osobowe zostaną usunięte, a Twoje wpisy w firmie zostaną podpisane jako „Usunięty użytkownik”. Tej operacji nie można cofnąć. Jedyny właściciel firmy musi najpierw przekazać własność albo usunąć firmę.',
      confirmLabel: 'Usuń konto',
      destructive: true,
    });
    if (!ok) return;
    const typed = await prompt({ title: 'Potwierdź usunięcie', message: 'Wpisz słowo USUŃ, aby potwierdzić.', placeholder: 'USUŃ', confirmLabel: 'Usuń na stałe' });
    if (typed?.toUpperCase() !== 'USUŃ') return typed === null ? undefined : fail({ message: 'Nie wpisano słowa USUŃ — konto nie zostało usunięte.' });
    try {
      await deleteAccount();
      await signOut();
    } catch (e) {
      fail(e);
    }
  }

  async function removeCompany() {
    const typed = await prompt({
      title: `Usunąć firmę „${tenantName}”?`,
      message: 'Zniknie cała historia: produkty, ruchy, zgłoszenia i faktury. Aby potwierdzić, przepisz dokładną nazwę firmy.',
      placeholder: tenantName,
      confirmLabel: 'Usuń firmę',
    });
    if (typed === null || !tenantId) return;
    try {
      await deleteTenant(tenantId, typed);
      qc.clear();
      await refetch();
      toast('Firma usunięta', 'success');
      router.replace('/');
    } catch (e) {
      fail(e);
    }
  }

  return (
    <Screen title="Ustawienia" scroll>
      <Section title="Firma">
        <ListRow icon="business-outline" title="Nazwa firmy" value={tenantName} onPress={isManager ? renameCompany : undefined} chevron={isManager} />
        <ListRow
          icon="card-outline"
          title="NIP"
          value={membership?.tenants?.nip ? formatNip(membership.tenants.nip) : 'nie podano'}
          onPress={isOwner ? changeNip : undefined}
          chevron={isOwner}
        />
        <ListRow icon="people-outline" title="Zespół i zaproszenia" onPress={() => router.push('/team')} last />
      </Section>

      {isManager ? (
        <Section title="Integracje" footer="Faktury zakupu z państwowego KSeF trafiają do Tapventory same — bez zdjęć i przepisywania.">
          <ListRow
            icon="shield-checkmark-outline"
            title="KSeF"
            subtitle={ksef.data?.status === 'connected' ? 'Faktury zakupu pobierają się automatycznie' : 'Podłącz raz, a faktury wpadają same'}
            right={ksef.data ? <Pill label={KSEF_STATUS_VIEW[ksef.data.status].label} tone={KSEF_STATUS_VIEW[ksef.data.status].tone} /> : undefined}
            onPress={() => router.push('/settings/ksef')}
            last
          />
        </Section>
      ) : null}

      {isManager ? (
        <Section title="Dane" footer="Stany, ruchy i faktury do arkusza kalkulacyjnego — np. dla księgowej.">
          <ListRow icon="download-outline" title="Eksport do CSV (Excel)" onPress={() => router.push('/settings/export')} last />
        </Section>
      ) : null}

      <Section
        title="Plan i limity"
        footer={PLAN_FOOTER}
      >
        <ListRow
          icon="ribbon-outline"
          title={`Plan: ${planName(plan)}`}
          subtitle={`${PLANS[plan].users} os. · ${PLANS[plan].products ?? 'bez limitu'} produktów · ${PLANS[plan].scans} skanów AI/mc`}
          right={trial ? <Pill label={`Próba: ${trial} dni`} tone="info" /> : undefined}
          chevron={false}
        />
        <ListRow
          icon="sparkles-outline"
          title="Skany AI w tym miesiącu"
          subtitle={q?.resets_at ? `Licznik wyzeruje się ${formatDate(q.resets_at)}` : undefined}
          value={q ? (q.limit === null ? `${q.used} (bez limitu)` : `${q.used} z ${q.limit}`) : '…'}
          last
          chevron={false}
        />
      </Section>

      {isManager && s ? (
        <Section title="Mini-spisy" footer="Zamiast jednej wielkiej inwentaryzacji prosimy o policzenie kilku produktów naraz. Różnice zapisują się jako korekty z podpisem.">
          <View style={styles.chipsWrap}>
            <Chips options={FREQ} value={s.count_frequency} onChange={(v) => void patch({ count_frequency: v })} />
          </View>
          <ListRow
            title="Produktów w jednym spisie"
            value={String(s.count_batch_size)}
            right={
              <View style={styles.stepper}>
                <Button title="−" size="s" variant="secondary" onPress={() => void patch({ count_batch_size: Math.max(1, s.count_batch_size - 1) })} accessibilityLabel="Mniej produktów" />
                <Button title="+" size="s" variant="secondary" onPress={() => void patch({ count_batch_size: Math.min(20, s.count_batch_size + 1) })} accessibilityLabel="Więcej produktów" />
              </View>
            }
            chevron={false}
          />
          <ListRow
            title="Powiadomienia o brakach"
            subtitle="Gdy stan spadnie poniżej minimum"
            switchValue={s.low_stock_push}
            onSwitch={(v) => void patch({ low_stock_push: v })}
            last
          />
        </Section>
      ) : null}

      {isManager ? (
        <Section title="Zlecenia" footer="Do zlecenia (np. auto klienta, wydarzenie) przypisujesz zużycie i zakupy, by wiedzieć, ile kosztowało.">
          {(projects.data ?? []).map((p) => (
            <ListRow
              key={p.id}
              icon={p.status === 'open' ? 'briefcase-outline' : 'archive-outline'}
              title={p.name}
              subtitle={p.status === 'open' ? 'Otwarte' : 'Zamknięte'}
              chevron={false}
              right={
                <Button
                  title={p.status === 'open' ? 'Zamknij' : 'Otwórz'}
                  size="s"
                  variant="secondary"
                  onPress={() => setProjectStatus.mutate({ id: p.id, status: p.status === 'open' ? 'closed' : 'open' })}
                />
              }
            />
          ))}
          <ListRow icon="add-circle-outline" title="Dodaj zlecenie" onPress={newProject} last />
        </Section>
      ) : null}

      <Section title="Na tym urządzeniu">
        {Platform.OS !== 'web' ? (
          <ListRow
            icon="notifications-outline"
            title="Włącz powiadomienia"
            onPress={async () => {
              const r = await enablePush();
              if (r === 'enabled') toast('Powiadomienia włączone', 'success');
              else if (r === 'denied') await alert('Powiadomienia wyłączone', 'Zezwól na powiadomienia dla Tapventory w ustawieniach telefonu.');
              else if (r === 'unsupported') await alert('Niedostępne tutaj', 'Powiadomienia działają w zainstalowanej aplikacji na prawdziwym telefonie (nie w Expo Go ani w przeglądarce).');
              else fail({ message: 'Nie udało się włączyć powiadomień.' });
            }}
          />
        ) : null}
        {Platform.OS === 'web' && !install.installed ? (
          <ListRow
            icon="download-outline"
            title="Zainstaluj aplikację"
            subtitle={install.needsManualIos ? 'iPhone: Udostępnij → Do ekranu początkowego' : 'Ikona na ekranie głównym, pełny ekran, szybszy start'}
            onPress={async () => {
              if (install.canPrompt) await install.install();
              else if (install.needsManualIos) await alert('Dodaj do ekranu początkowego', 'W Safari dotknij ikony „Udostępnij” (kwadrat ze strzałką), przewiń listę i wybierz „Do ekranu początkowego”.');
              else await alert('Instalacja z przeglądarki', 'W Chrome/Edge: menu (⋮) → „Zainstaluj aplikację”. Jeśli opcji nie ma, aplikacja jest już zainstalowana albo przeglądarka jej nie obsługuje.');
            }}
          />
        ) : null}
        <ListRow
          icon="shield-checkmark-outline"
          title="Zgoda na odczyt faktur przez AI"
          subtitle={consent.consented ? 'Udzielona' : 'Zapytamy przed pierwszym skanem'}
          switchValue={Boolean(consent.consented)}
          onSwitch={async (v) => {
            if (v) await consent.give();
            else await consent.revoke();
          }}
          last
        />
      </Section>

      <Section title="Pomoc i prawo">
        <ListRow icon="sparkles-outline" title="Zapytaj asystenta AI" onPress={() => router.push('/assistant')} />
        <ListRow icon="mail-outline" title="Napisz do nas" onPress={() => void Linking.openURL(LINKS.support)} />
        <ListRow icon="document-text-outline" title="Regulamin" onPress={() => void Linking.openURL(LINKS.terms)} />
        <ListRow icon="lock-closed-outline" title="Polityka prywatności" onPress={() => void Linking.openURL(LINKS.privacy)} last />
      </Section>

      <Section title="Strefa niebezpieczna">
        <ListRow icon="log-out-outline" title="Wyloguj" chevron={false} onPress={async () => { if (await confirm({ title: 'Wylogować się?', confirmLabel: 'Wyloguj' })) await signOut(); }} />
        {isOwner ? <ListRow icon="trash-outline" title="Usuń firmę" danger onPress={removeCompany} /> : null}
        <ListRow icon="person-remove-outline" title="Usuń moje konto" danger onPress={removeAccount} last />
      </Section>

      <Text variant="footnote" color="tertiary" align="center">
        Tapventory {version}{env !== 'production' ? ` · ${env}` : ''}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chipsWrap: { paddingVertical: spacing.xs },
  stepper: { flexDirection: 'row', gap: 6 },
});
