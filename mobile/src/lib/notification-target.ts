// Dokąd prowadzi dotknięcie powiadomienia (push albo wiersz na liście aktywności).

export type NotificationData = { request_id?: string; product_id?: string; document_id?: string; screen?: string } | null | undefined;

export function notificationHref(kind: string, data: NotificationData): string {
  if (data?.request_id) return `/request/${data.request_id}`;
  if (data?.document_id) return `/documents/${data.document_id}`;
  if (data?.product_id) return `/product/${data.product_id}`;
  if (data?.screen === 'ksef') return '/settings/ksef';
  if (data?.screen === 'documents') return '/documents';
  if (kind === 'count_due') return '/count';
  return '/activity';
}
