// Eksport danych do CSV (stany, ruchy, faktury) — dla kierownictwa. Plik otwiera się od razu w polskim Excelu.
// Na telefonie otwiera się arkusz „Udostępnij" (Pliki, poczta, Excel); w przeglądarce plik się pobiera.

import { useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { ListRow, Screen, Section, useDialogs } from '@/components/ui';
import {
  buildDocumentsExport, buildMovementsExport, buildProductsExport, MOVEMENT_EXPORT_DAYS, type ExportFile,
} from '@/lib/api/export';
import { saveAndShareText } from '@/lib/export-file';
import { countLabel } from '@/lib/format';
import { useTenant } from '@/lib/tenant';
import type { ExportKind } from '@/lib/csv';

const ROWS_FORMS = ['wiersz', 'wiersze', 'wierszy'] as const;

export default function ExportScreen() {
  const { tenantId, isManager, loading } = useTenant();
  const { fail, toast, alert } = useDialogs();
  const [busy, setBusy] = useState<ExportKind | null>(null);

  if (!loading && !isManager) return <Redirect href="/home" />;

  async function run(kind: ExportKind, build: (tenantId: string) => Promise<ExportFile>) {
    if (!tenantId || busy) return;
    setBusy(kind);
    try {
      const file = await build(tenantId);
      const result = await saveAndShareText(file.filename, file.text);
      if (result === 'unavailable') {
        await alert('Nie można otworzyć udostępniania', 'To urządzenie nie pozwala udostępniać plików. Spróbuj z wersji przeglądarkowej (PWA).');
      } else {
        toast(`Gotowe: ${countLabel(file.rowCount, ROWS_FORMS)} w pliku ${file.filename}`, 'success');
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  const spinner = (kind: ExportKind) => (busy === kind ? <ActivityIndicator accessibilityLabel="Przygotowuję plik" /> : undefined);

  return (
    <Screen title="Eksport danych" scroll>
      <Section
        title="Pliki CSV (Excel)"
        footer="Pliki mają separator „;”, przecinek dziesiętny i polskie znaki — otwierają się od razu w polskim Excelu. Zawierają dane Twojej firmy: przechowuj je ostrożnie i nie wysyłaj osobom postronnym."
      >
        <ListRow
          icon="cube-outline"
          title="Stany magazynowe"
          subtitle="Wszystkie produkty: stan, minimum, dostawca, ostatni ruch"
          right={spinner('stany')}
          onPress={() => void run('stany', buildProductsExport)}
        />
        <ListRow
          icon="swap-vertical-outline"
          title="Ruchy magazynowe"
          subtitle={`Ostatnie ${MOVEMENT_EXPORT_DAYS} dni: kto, co, ile, dlaczego`}
          right={spinner('ruchy')}
          onPress={() => void run('ruchy', (id) => buildMovementsExport(id))}
        />
        <ListRow
          icon="document-text-outline"
          title="Faktury"
          subtitle="Dostawca, NIP, numer, kwoty, status (bez zdjęć)"
          right={spinner('faktury')}
          onPress={() => void run('faktury', buildDocumentsExport)}
          last
        />
      </Section>
    </Screen>
  );
}
