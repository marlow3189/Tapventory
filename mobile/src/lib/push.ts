// Powiadomienia push (iOS / Android). W przeglądarce (PWA) na razie wyłączone —
// Web Push to osobny etap (patrz docs/13_*). W Expo Go push zdalny nie działa;
// potrzebna jest wersja deweloperska aplikacji (eas build --profile development).

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';

export type PushResult = 'enabled' | 'denied' | 'unsupported' | 'error';

let handlerSet = false;
/** Jak pokazywać powiadomienia, gdy aplikacja jest otwarta. */
export function setupNotificationHandler() {
  if (handlerSet || Platform.OS === 'web') return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false,
    }),
  });
}

export async function enablePush(): Promise<PushResult> {
  if (Platform.OS === 'web') return 'unsupported';
  if (!Device.isDevice) return 'unsupported';
  if (Constants.executionEnvironment === 'storeClient') return 'unsupported'; // Expo Go
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Tapventory', importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return 'denied';

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return 'unsupported'; // brak `eas init` — patrz docs/12_*
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const { error } = await supabase.rpc('register_push_token', {
      p_token: token, p_platform: Platform.OS, p_device: Device.deviceName ?? Device.modelName ?? null,
    });
    if (error) throw error;
    return 'enabled';
  } catch {
    return 'error';
  }
}

export type PushStatus = 'granted' | 'denied' | 'undetermined' | 'unsupported';

/** Czy użytkownik już zdecydował o powiadomieniach (do bannera „Włącz powiadomienia"). */
export async function getPushStatus(): Promise<PushStatus> {
  if (Platform.OS === 'web' || !Device.isDevice || Constants.executionEnvironment === 'storeClient') return 'unsupported';
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
  } catch {
    return 'unsupported';
  }
}
