// Dotknięcie powiadomienia push (także tego, które uruchomiło aplikację) → właściwy ekran.
// Wersja dla przeglądarki (PWA) jest pusta: notification-taps.web.ts — moduł powiadomień Expo
// nie istnieje w sieci i samo wywołanie hooka wywaliłoby całą aplikację.

import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import { notificationHref, type NotificationData } from './notification-target';

let lastHandled: string | null = null;

export function useNotificationTaps(): void {
  const router = useRouter();
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!response) return;
    const id = response.notification.request.identifier;
    if (id === lastHandled) return;
    lastHandled = id;
    const data = (response.notification.request.content.data ?? {}) as NotificationData & { kind?: string };
    router.push(notificationHref(data.kind ?? '', data) as Href);
  }, [response, router]);
}
