// Pulpit: pierwszy ekran po zalogowaniu.
//  1) Sprawdza, czy użytkownik należy do jakiejś firmy — jeśli nie,
//     odsyła do zakładania firmy.
//  2) Pokazuje dwie liczby (produkty, otwarte zgłoszenia) i listę
//     produktów PONIŻEJ MINIMUM z widoku product_stock (migracja 0001).
// Zwróć uwagę: zapytania nie zawierają żadnego "where user...". O tym,
// co widać, decyduje RLS w bazie — aplikacja nie jest strażnikiem.

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Screen } from '../../components/ui/Screen';
import { Button } from '../../components/ui/Button';
import { ListRow, RowSeparator, SectionHeader } from '../../components/ui/ListRow';
import { colors, radius, spacing, typography } from '../../theme/tokens';

type Tenant = { id: string; name: string };
type LowStockRow = {
  product_id: string;
  name: string;
  unit: string;
  stock: number;
  min_stock: number;
};

export default function DashboardScreen() {
  const [checking, setChecking] = useState(true);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [productCount, setProductCount] = useState(0);
  const [openRequests, setOpenRequests] = useState(0);
  const [lowStock, setLowStock] = useState<LowStockRow[]>([]);

  const load = useCallback(async () => {
    // 1) Członkostwo → firma (na razie pierwsza; przełącznik firm dojdzie później).
    const { data: membership, error } = await supabase
      .from('memberships')
      .select('tenant_id, tenants(name)')
      .limit(1)
      .maybeSingle();

    if (error) {
      Alert.alert('Błąd wczytywania', error.message);
      setChecking(false);
      return;
    }
    if (!membership) {
      setTenant(null);
      setChecking(false);
      return;
    }

    const t: Tenant = {
      id: membership.tenant_id,
      name: (membership.tenants as unknown as { name: string })?.name ?? 'Firma',
    };
    setTenant(t);

    // 2) Liczniki i lista niskich stanów — trzy lekkie zapytania.
    const [products, requests, low] = await Promise.all([
      supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', t.id)
        .eq('active', true),
      supabase
        .from('requests')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', t.id)
        .in('status', ['reported', 'accepted', 'ordered', 'delivered']),
      supabase
        .from('product_stock')
        .select('product_id, name, unit, stock, min_stock')
        .eq('tenant_id', t.id)
        .eq('below_min', true)
        .eq('active', true)
        .order('stock', { ascending: true })
        .limit(20),
    ]);

    setProductCount(products.count ?? 0);
    setOpenRequests(requests.count ?? 0);
    setLowStock((low.data as LowStockRow[]) ?? []);
    setChecking(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (checking) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!tenant) {
    return <Redirect href="/(app)/company" />;
  }

  return (
    <Screen title={tenant.name} subtitle="Pulpit">
      {/* Karty statystyk */}
      <View style={styles.statsRow}>
        <StatCard value={productCount} label="Produkty" />
        <StatCard value={openRequests} label="Otwarte zgłoszenia" accent={openRequests > 0} />
      </View>

      {/* Niskie stany */}
      <SectionHeader>Poniżej minimum</SectionHeader>
      {lowStock.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.emptyText}>
            Wszystkie stany są powyżej ustawionych minimów.
          </Text>
        </View>
      ) : (
        <View style={styles.listCard}>
          {lowStock.map((row, index) => (
            <View key={row.product_id}>
              {index > 0 ? <RowSeparator /> : null}
              <ListRow
                title={row.name}
                detail={`${Number(row.stock)} ${row.unit}`}
                detailColor={colors.red}
                isFirst={index === 0}
                isLast={index === lowStock.length - 1}
              />
            </View>
          ))}
        </View>
      )}

      <View style={{ height: spacing.xl }} />
      <Button
        title="Wyloguj się"
        variant="plain"
        destructive
        onPress={() => supabase.auth.signOut()}
      />
    </Screen>
  );
}

function StatCard({
  value,
  label,
  accent = false,
}: {
  value: number;
  label: string;
  accent?: boolean;
}) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, accent && { color: colors.orange }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', backgroundColor: colors.groupedBackground },
  statsRow: { flexDirection: 'row', gap: spacing.m },
  statCard: {
    flex: 1,
    backgroundColor: colors.cellBackground,
    borderRadius: radius.m,
    padding: spacing.m,
  },
  statValue: { ...typography.largeTitle, color: colors.label },
  statLabel: { ...typography.footnote, color: colors.secondaryLabel, marginTop: spacing.xs },
  card: {
    backgroundColor: colors.cellBackground,
    borderRadius: radius.s,
    padding: spacing.m,
  },
  listCard: { borderRadius: radius.s, overflow: 'hidden' },
  emptyText: { ...typography.subhead, color: colors.secondaryLabel },
});
