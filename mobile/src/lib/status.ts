// Cykl życia zgłoszenia — LUSTRO reguł z bazy (trigger requests_guard, migracja 0004).
// Baza i tak odrzuci niedozwoloną zmianę; ta tabela decyduje tylko o tym, jakie
// przyciski POKAZUJEMY, żeby użytkownik nie klikał w to, co się nie uda.

export type RequestStatus = 'reported' | 'accepted' | 'ordered' | 'delivered' | 'received' | 'rejected';
export type Tone = 'neutral' | 'info' | 'violet' | 'warning' | 'success' | 'danger';

export const STATUS_LABEL: Record<RequestStatus, string> = {
  reported: 'Zgłoszone',
  accepted: 'Zaakceptowane',
  ordered: 'Zamówione',
  delivered: 'Dostarczone',
  received: 'Przyjęte',
  rejected: 'Odrzucone',
};

export const STATUS_TONE: Record<RequestStatus, Tone> = {
  reported: 'neutral',
  accepted: 'info',
  ordered: 'violet',
  delivered: 'warning',
  received: 'success',
  rejected: 'danger',
};

export const OPEN_STATUSES: RequestStatus[] = ['reported', 'accepted', 'ordered', 'delivered'];
export const isClosed = (s: RequestStatus) => s === 'received' || s === 'rejected';

export type StatusAction = { to: RequestStatus; label: string; kind: 'primary' | 'danger' | 'secondary' };

export function nextActions(
  status: RequestStatus,
  who: { isManager: boolean; isReporter: boolean }
): StatusAction[] {
  const out: StatusAction[] = [];
  const { isManager, isReporter } = who;
  switch (status) {
    case 'reported':
      if (isManager) {
        out.push({ to: 'accepted', label: 'Zaakceptuj', kind: 'primary' });
        out.push({ to: 'rejected', label: 'Odrzuć', kind: 'danger' });
      } else if (isReporter) {
        out.push({ to: 'rejected', label: 'Wycofaj zgłoszenie', kind: 'danger' });
      }
      break;
    case 'accepted':
      if (isManager) {
        out.push({ to: 'ordered', label: 'Oznacz jako zamówione', kind: 'primary' });
        out.push({ to: 'rejected', label: 'Odrzuć', kind: 'danger' });
      }
      break;
    case 'ordered':
      if (isManager) {
        out.push({ to: 'delivered', label: 'Oznacz jako dostarczone', kind: 'primary' });
        out.push({ to: 'rejected', label: 'Anuluj zamówienie', kind: 'danger' });
      }
      break;
    case 'delivered':
      if (isManager || isReporter) out.push({ to: 'received', label: 'Potwierdź przyjęcie', kind: 'primary' });
      break;
    default:
  }
  return out;
}
