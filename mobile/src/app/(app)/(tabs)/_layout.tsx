import { Tabs } from 'expo-router/js-tabs';
import { AppTabBar } from '@/components/AppTabBar';
import { CreateSheetProvider } from '@/components/CreateSheet';

export default function TabsLayout() {
  return (
    <CreateSheetProvider>
      <Tabs tabBar={(props) => <AppTabBar {...props} />} screenOptions={{ headerShown: false }}>
        <Tabs.Screen name="home" />
        <Tabs.Screen name="explore" />
        <Tabs.Screen name="create" />
        <Tabs.Screen name="activity" />
        <Tabs.Screen name="profile" />
      </Tabs>
    </CreateSheetProvider>
  );
}
