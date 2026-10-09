// Pobieranie pliku w przeglądarce (PWA): tworzymy plik w pamięci i „klikamy" niewidoczny link.

export type SaveResult = 'shared' | 'unavailable';

export async function saveAndShareText(filename: string, text: string, mimeType = 'text/csv'): Promise<SaveResult> {
  const blob = new Blob([text], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'shared';
}
