// ============================================================================
// Korzeń nawigacji (Expo Router)
// ============================================================================
// Dla juniora: Expo Router zamienia strukturę katalogu app/ na ekrany —
// jak strony w serwisie www. Nawiasy w nazwach folderów, np. (auth),
// to "grupy": porządkują pliki, ale nie pojawiają się w adresie ekranu.
//   app/(auth)/login.tsx  → ekran logowania
//   app/(app)/index.tsx   → pulpit po zalogowaniu
// Bramki "kto może gdzie wejść" są w _layout.tsx każdej grupy.
// ============================================================================

import { Stack } from 'expo-router';
import { AuthProvider } from '../lib/auth';

export default function RootLayout() {
  return (
    <AuthProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </AuthProvider>
  );
}
