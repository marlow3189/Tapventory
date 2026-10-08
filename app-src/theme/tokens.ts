// ============================================================================
// Tapventory — system projektowy (design tokens)
// ============================================================================
// Zasada: ŻADEN ekran nie wymyśla własnych kolorów ani rozmiarów pisma.
// Wszystko bierze się z tego pliku. Dzięki temu aplikacja wygląda spójnie,
// a przyszły tryb ciemny to zmiana wartości w jednym miejscu.
//
// Wartości pochodzą z wytycznych Apple (Human Interface Guidelines):
// systemowe kolory iOS i oficjalna skala typograficzna. Na Androidzie
// używamy tych samych wartości — świadoma decyzja: "styl iOS na obu".
// ============================================================================

export const colors = {
  // Kolory akcji (systemowe kolory iOS)
  blue: '#007AFF',      // główny kolor akcji (przyciski, linki)
  red: '#FF3B30',       // błędy, stany krytyczne, akcje niszczące
  green: '#34C759',     // sukces, stany dodatnie
  orange: '#FF9500',    // ostrzeżenia, stany "uwaga"

  // Tekst
  label: '#000000',                       // tekst główny
  secondaryLabel: 'rgba(60,60,67,0.60)',  // tekst drugorzędny
  tertiaryLabel: 'rgba(60,60,67,0.30)',   // podpowiedzi, placeholdery

  // Tła (styl "inset grouped" znany z Ustawień iOS)
  groupedBackground: '#F2F2F7',  // tło ekranu
  cellBackground: '#FFFFFF',     // tło kart i wierszy list

  // Linie i wypełnienia
  separator: '#C6C6C8',              // cienkie linie oddzielające
  fill: 'rgba(120,120,128,0.12)',    // delikatne wypełnienia (np. pola)
  tintedBlue: 'rgba(0,122,255,0.12)', // tło przycisku "tinted"
  chevron: '#C7C7CC',                 // strzałka ">" w wierszach
} as const;

// Skala typograficzna Apple (rozmiar / grubość).
// Uwaga: nie dodajemy własnych czcionek — systemowa czcionka to na iPhonie
// San Francisco, czyli dokładnie ten "wygląd iOS", o który nam chodzi.
export const typography = {
  largeTitle: { fontSize: 34, fontWeight: '700' as const, letterSpacing: 0.37 },
  title2:     { fontSize: 22, fontWeight: '700' as const },
  title3:     { fontSize: 20, fontWeight: '600' as const },
  headline:   { fontSize: 17, fontWeight: '600' as const },
  body:       { fontSize: 17, fontWeight: '400' as const },
  callout:    { fontSize: 16, fontWeight: '400' as const },
  subhead:    { fontSize: 15, fontWeight: '400' as const },
  footnote:   { fontSize: 13, fontWeight: '400' as const },
  caption:    { fontSize: 12, fontWeight: '400' as const },
} as const;

// Odstępy — siatka co 4 punkty (standard w projektowaniu mobilnym).
export const spacing = { xs: 4, s: 8, m: 16, l: 24, xl: 32 } as const;

// Promienie zaokrągleń.
export const radius = { s: 10, m: 12, l: 16 } as const;

// Minimalny rozmiar elementu dotykowego wg Apple: 44 pt.
export const touchTarget = 44;
