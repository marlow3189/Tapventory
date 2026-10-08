// Pasek zakładek w stylu Instagrama: ikony bez podpisów, aktywna = wypełniona,
// w środku wyróżnione „+", a ostatnia zakładka to awatar użytkownika.

import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Avatar, CountBadge, Icon, Touchable, buzz, type IconName } from '@/components/ui';
import { useDashboard } from '@/lib/api/misc';
import { useAuth } from '@/lib/auth';
import { brandGradient, layout, useColors } from '@/theme';
import { useCreateSheet } from './CreateSheet';

const ICONS: Record<string, { on: IconName; off: IconName; label: string }> = {
  home: { on: 'home', off: 'home-outline', label: 'Start' },
  explore: { on: 'search', off: 'search-outline', label: 'Magazyn' },
  activity: { on: 'heart', off: 'heart-outline', label: 'Aktywność' },
};

export function AppTabBar({ state, navigation, insets }: BottomTabBarProps) {
  const c = useColors();
  const { open } = useCreateSheet();
  const { user } = useAuth();
  const dashboard = useDashboard();
  const unread = dashboard.data?.unread_notifications ?? 0;
  const name = (user?.user_metadata?.display_name as string | undefined) ?? user?.email ?? '?';

  return (
    <View style={[styles.bar, { backgroundColor: c.bg, borderTopColor: c.border, paddingBottom: insets.bottom }]} accessibilityRole="tablist">
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const press = () => {
          if (route.name === 'create') {
            buzz('light');
            open();
            return;
          }
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };

        if (route.name === 'create') {
          return (
            <Touchable key={route.key} onPress={press} accessibilityLabel="Dodaj" style={styles.item}>
              <LinearGradient colors={[...brandGradient]} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={styles.plus}>
                <Icon name="add" size={24} color="#FFFFFF" />
              </LinearGradient>
            </Touchable>
          );
        }

        const cfg = ICONS[route.name];
        return (
          <Touchable
            key={route.key}
            onPress={press}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={route.name === 'profile' ? 'Profil' : cfg?.label}
            style={styles.item}
          >
            {route.name === 'profile' ? (
              <View style={[styles.avatarRing, { borderColor: focused ? c.text : 'transparent' }]}>
                <Avatar name={name} size={26} />
              </View>
            ) : (
              <View>
                <Icon name={focused ? cfg.on : cfg.off} size={27} />
                {route.name === 'activity' && unread > 0 ? (
                  <View style={styles.badge}>
                    <CountBadge count={unread} />
                  </View>
                ) : null}
              </View>
            )}
          </Touchable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, minHeight: layout.tabBar },
  item: { flex: 1, height: layout.tabBar, alignItems: 'center', justifyContent: 'center' },
  plus: { width: 44, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  avatarRing: { padding: 1.5, borderRadius: 18, borderWidth: 1.5 },
  badge: { position: 'absolute', top: -6, right: -10 },
});
