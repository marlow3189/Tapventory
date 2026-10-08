// „Stories" na ekranie głównym = zadania na dziś (styl Instagrama, treść z magazynu).
// Czysta funkcja z podsumowania pulpitu → lista kółek. Dzięki temu da się ją testować.

export type DashboardSummary = {
  role: 'owner' | 'manager' | 'employee';
  plan: 'solo' | 'start' | 'team';
  trial_days_left: number | null;
  products_total: number;
  below_min: number;
  below_min_top: { id: string; name: string; unit: string; stock: number | string; min_stock: number | string; photo_path: string | null }[];
  requests_open: number;
  requests_to_accept: number;
  requests_to_confirm: number;
  requests_mine_open: number;
  documents_to_verify: number;
  documents_processing: number;
  documents_failed: number;
  count_stale: number;
  count_batch_size: number;
  count_frequency: 'off' | 'weekly' | 'biweekly';
  unread_notifications: number;
};

export type StoryId = 'low' | 'requests' | 'invoices' | 'count';

export type StoryDef = {
  id: StoryId;
  label: string;
  /** liczba rzeczy do zrobienia (0 = szary pierścień) */
  count: number;
  icon: 'alert-circle-outline' | 'chatbubbles-outline' | 'document-text-outline' | 'checkmark-done-outline';
  /** pilne = gradientowy pierścień */
  urgent: boolean;
  hint: string;
};

export function buildStories(d: DashboardSummary | undefined | null): StoryDef[] {
  if (!d) return [];
  const isManager = d.role !== 'employee';
  const stories: StoryDef[] = [];

  stories.push({
    id: 'low', label: 'Braki', count: d.below_min, icon: 'alert-circle-outline',
    urgent: d.below_min > 0, hint: d.below_min > 0 ? 'Produkty poniżej minimum' : 'Wszystko na stanie',
  });

  const reqCount = (isManager ? d.requests_to_accept : 0) + d.requests_to_confirm;
  stories.push({
    id: 'requests', label: 'Zgłoszenia', count: reqCount, icon: 'chatbubbles-outline',
    urgent: reqCount > 0, hint: reqCount > 0 ? 'Czekają na Twoją decyzję' : 'Nic nie czeka',
  });

  if (isManager) {
    const docCount = d.documents_to_verify + d.documents_failed;
    stories.push({
      id: 'invoices', label: 'Faktury', count: docCount, icon: 'document-text-outline',
      urgent: docCount > 0, hint: d.documents_processing > 0 ? 'AI czyta dokumenty…' : 'Do sprawdzenia',
    });
  }

  if (d.count_frequency !== 'off') {
    const n = Math.min(d.count_batch_size, d.count_stale);
    stories.push({
      id: 'count', label: 'Mini-spis', count: n, icon: 'checkmark-done-outline',
      urgent: n > 0 && d.count_stale > 0, hint: n > 0 ? `Policz ${n} produktów` : 'Wszystko policzone',
    });
  }
  return stories;
}
