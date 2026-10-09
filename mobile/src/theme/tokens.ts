// ============================================================================
// Tapventory — system projektowy w stylu Instagrama
// ============================================================================
// Zasada: ŻADEN ekran nie wymyśla własnych kolorów ani rozmiarów. Wszystko bierze
// się z tego pliku — dzięki temu aplikacja wygląda spójnie, a tryb ciemny jest
// zmianą jednego miejsca.
//
// Co z Instagrama jest "wzorem", a co naszą własną tożsamością:
//  * układ i rytm: białe tło, cienkie linie 1px, duże zdjęcia, ikony outline,
//    pasek zakładek na dole ze środkowym "+", okrągłe "stories", karty feedu;
//  * kolor akcji #0095F6 (niebieski jak w IG), czerwień serca/błędów #ED4956;
//  * gradient pierścienia stories jest NASZ (bursztyn → koral → fiolet).
// ============================================================================

export type Palette = {
  bg: string; bgSecondary: string; surface: string;
  border: string; borderLight: string; fill: string;
  text: string; textSecondary: string; textTertiary: string; textOnPrimary: string;
  primary: string; link: string;
  danger: string; success: string; warning: string; info: string; violet: string;
  overlay: string; skeleton: string; isDark: boolean;
};

export const lightPalette: Palette = {
  bg: '#FFFFFF', bgSecondary: '#FAFAFA', surface: '#FFFFFF',
  border: '#DBDBDB', borderLight: '#EFEFEF', fill: '#EFEFEF',
  text: '#262626', textSecondary: '#737373', textTertiary: '#A8A8A8', textOnPrimary: '#FFFFFF',
  primary: '#0095F6', link: '#00376B',
  // Kolory semantyczne w jasnym motywie przyciemnione tak, by tekst i biały napis na nich miały kontrast ≥ 4,5:1 (WCAG AA):
  // danger #ED4956 (3,7:1) → #D32F3C, success #2EA44F (3,2:1) → #1A7F37, warning #F59E0B (2,2:1) → #B45309, violet #8B5CF6 (4,2:1) → #7C3AED.
  danger: '#D32F3C', success: '#1A7F37', warning: '#B45309', info: '#0095F6', violet: '#7C3AED',
  overlay: 'rgba(0,0,0,0.55)', skeleton: '#EFEFEF', isDark: false,
};

export const darkPalette: Palette = {
  bg: '#000000', bgSecondary: '#121212', surface: '#121212',
  border: '#262626', borderLight: '#1C1C1C', fill: '#262626',
  text: '#F5F5F5', textSecondary: '#A8A8A8', textTertiary: '#737373', textOnPrimary: '#FFFFFF',
  primary: '#0095F6', link: '#E0F1FF',
  danger: '#FF4D5A', success: '#3DD16F', warning: '#FBBF24', info: '#4DB5FF', violet: '#A78BFA',
  overlay: 'rgba(0,0,0,0.7)', skeleton: '#262626', isDark: true,
};

/** Gradient pierścienia „stories" i akcentów marki. */
export const brandGradient = ['#FEC053', '#F5576C', '#8B3FD9'] as const;

export const typography = {
  largeTitle: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' as const },
  bodyBold: { fontSize: 15, lineHeight: 21, fontWeight: '600' as const },
  callout: { fontSize: 14, lineHeight: 19, fontWeight: '400' as const },
  subhead: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  footnote: { fontSize: 12, lineHeight: 16, fontWeight: '400' as const },
  caption: { fontSize: 11, lineHeight: 14, fontWeight: '500' as const },
} as const;
export type TextVariant = keyof typeof typography;

/** Siatka co 4 pt. */
export const spacing = { xxs: 2, xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;
export const radius = { s: 8, m: 12, l: 16, pill: 999 } as const;

export const layout = {
  /** Minimalny rozmiar elementu dotykowego (Apple HIG 44 pt, Material 48 dp). */
  touch: 44,
  tabBar: 52,
  storySize: 66,
  /** Maksymalna szerokość treści na dużych ekranach (PWA na komputerze). */
  maxContent: 640,
} as const;

export type Tone = 'neutral' | 'info' | 'violet' | 'warning' | 'success' | 'danger';

/** Kolor tekstu kapsułek w jasnym motywie: ciemniejszy niż kolor „graficzny", żeby napis na jasnym tle miał kontrast ≥ 4,5:1. */
const LIGHT_PILL_TEXT: Record<Tone, string> = {
  neutral: '#666666', info: '#0069B8', violet: '#7C3AED', warning: '#9A4A07', success: '#177A33', danger: '#C0222F',
};

export function toneColors(p: Palette, tone: Tone): { fg: string; bg: string } {
  const map: Record<Tone, string> = {
    neutral: p.textSecondary, info: p.info, violet: p.violet,
    warning: p.warning, success: p.success, danger: p.danger,
  };
  const base = map[tone];                       // tło kapsułki wyliczamy z koloru podstawowego
  return { fg: p.isDark ? base : LIGHT_PILL_TEXT[tone], bg: p.isDark ? `${base}33` : `${base}1F` };
}
