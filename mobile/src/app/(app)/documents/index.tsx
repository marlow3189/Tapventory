// Lista faktur: co czeka na sprawdzenie, co jest zaksięgowane. Tylko dla kierownictwa.

import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Button, Chips, EmptyState, ErrorState, Icon, Pill, RowSkeleton, Screen, Text, Touchable } from '@/components/ui';
import { useDocuments } from '@/lib/api/documents';
import { DOC_STATUS } from '@/lib/doc-status';
import { formatDate, formatMoney, timeAgo } from '@/lib/format';
import { useTenant } from '@/lib/tenant';
import { spacing, useColors } from '@/theme';


type Filter = 'todo' | 'all' | 'posted';

export default function Documents() {
  const c = useColors();
  const router = useRouter();
  const { isManager, loading } = useTenant();
  const docs = useDocuments();
  const [filter, setFilter] = useState<Filter>('todo');

  if (!loading && !isManager) return <Redirect href="/home" />;

  const rows = (docs.data ?? []).filter((d) => (filter === 'all' ? true : filter === 'posted' ? d.status === 'posted' : d.status !== 'posted'));

  return (
    <Screen
      title="Faktury"
      padded={false}
      headerRight={<Button title="Skanuj" icon="scan-outline" size="s" onPress={() => router.push('/documents/scan')} />}
    >
      <Chips
        options={[
          { value: 'todo', label: 'Do zrobienia' },
          { value: 'posted', label: 'Zaksięgowane' },
          { value: 'all', label: 'Wszystkie' },
        ]}
        value={filter}
        onChange={setFilter}
      />
      {docs.isPending ? (
        <RowSkeleton count={5} />
      ) : docs.isError ? (
        <ErrorState error={docs.error} onRetry={() => void docs.refetch()} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(d) => d.id}
          renderItem={({ item }) => {
            const st = DOC_STATUS[item.status];
            return (
              <Touchable onPress={() => router.push(`/documents/${item.id}`)} accessibilityLabel={`Faktura ${item.supplier_name ?? ''} ${item.invoice_number ?? ''}`} style={styles.row}>
                <View style={[styles.icon, { backgroundColor: c.fill }]}>
                  <Icon name={item.source === 'ksef' ? 'shield-checkmark-outline' : 'document-text-outline'} size={22} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text bold numberOfLines={1}>
                    {item.supplier_name ?? 'Nieznany dostawca'}
                  </Text>
                  <Text variant="footnote" color="secondary" numberOfLines={1}>
                    {item.invoice_number ?? 'bez numeru'} · {item.issue_date ? formatDate(item.issue_date) : timeAgo(item.created_at)}
                    {item.status !== 'processing' && item.status !== 'failed' ? ` · ${item.line_count} poz.` : ''}
                  </Text>
                  {item.status === 'draft' && item.unmatched_count > 0 ? (
                    <Text variant="footnote" color="warning" bold>
                      Bez produktu: {item.unmatched_count}
                    </Text>
                  ) : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Pill label={st.label} tone={st.tone} />
                  {item.total_gross !== null || item.total_net !== null ? (
                    <Text variant="footnote" color="secondary">
                      {formatMoney(item.total_gross ?? item.total_net, item.currency)}
                    </Text>
                  ) : null}
                </View>
              </Touchable>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              icon="document-text-outline"
              title={filter === 'posted' ? 'Brak zaksięgowanych faktur' : 'Brak faktur do zrobienia'}
              message="Zrób zdjęcie faktury albo wrzuć PDF — AI odczyta pozycje, a Ty tylko sprawdzisz i zatwierdzisz."
              actionLabel="Skanuj fakturę"
              onAction={() => router.push('/documents/scan')}
            />
          }
          refreshControl={<RefreshControl refreshing={docs.isRefetching} onRefresh={() => void docs.refetch()} tintColor={c.textSecondary} />}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: spacing.l, paddingVertical: 12 },
  icon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
});
