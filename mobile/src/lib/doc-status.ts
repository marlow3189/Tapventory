import type { Tone } from './status';
import type { DocumentRow } from './types';

/** Napisy i kolory statusów faktury (lista, kafelki, ekran weryfikacji). */
export const DOC_STATUS: Record<DocumentRow['status'], { label: string; tone: Tone }> = {
  processing: { label: 'AI czyta…', tone: 'info' },
  draft: { label: 'Do sprawdzenia', tone: 'warning' },
  verified: { label: 'Zweryfikowana', tone: 'violet' },
  posted: { label: 'Zaksięgowana', tone: 'success' },
  failed: { label: 'Błąd odczytu', tone: 'danger' },
};
