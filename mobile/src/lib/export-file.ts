// Zapis pliku eksportu i otwarcie arkusza „Udostępnij" (telefon). Wersja dla przeglądarki: export-file.web.ts.
// Plik trafia do pamięci podręcznej aplikacji; użytkownik wybiera, co z nim zrobić (zapisz w Plikach, wyślij mailem, otwórz w Excelu).

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export type SaveResult = 'shared' | 'unavailable';

export async function saveAndShareText(filename: string, text: string, mimeType = 'text/csv'): Promise<SaveResult> {
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  await Sharing.shareAsync(file.uri, { mimeType, UTI: 'public.comma-separated-values-text', dialogTitle: 'Eksport z Tapventory' });
  return 'shared';
}
