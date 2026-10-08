import { Redirect } from 'expo-router';

// Zakładka „+" nie jest ekranem — pasek zakładek otwiera arkusz tworzenia.
// Ten plik istnieje, by nawigacja znała pięć pozycji; wejście z linku odsyła na start.
export default function CreateTab() {
  return <Redirect href="/home" />;
}
