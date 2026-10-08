// Nazwy i wygląd ruchów magazynowych w historii produktu.

import type { MovementRow } from './types';

export const REASON_LABEL: Record<NonNullable<MovementRow['reason']>, string> = {
  use: 'Zużycie',
  damage: 'Uszkodzenie',
  expired: 'Przeterminowane',
  other: 'Inny powód',
};

export function movementTitle(m: Pick<MovementRow, 'movement_type' | 'qty' | 'reason'>): string {
  switch (m.movement_type) {
    case 'issue':
      return m.reason ? `Zdjęto · ${REASON_LABEL[m.reason].toLowerCase()}` : 'Zdjęto z magazynu';
    case 'receipt':
      return 'Przyjęcie na magazyn';
    case 'return':
      return 'Zwrot na magazyn';
    case 'adjustment':
      return Number(m.qty) >= 0 ? 'Korekta stanu (+)' : 'Korekta stanu (−)';
  }
}

export const isIncoming = (m: Pick<MovementRow, 'qty'>): boolean => Number(m.qty) > 0;
