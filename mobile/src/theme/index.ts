import { Platform, useColorScheme } from 'react-native';
import { darkPalette, lightPalette, type Palette } from './tokens';

export * from './tokens';

/** Paleta zgodna z ustawieniem systemu (jasny / ciemny). */
export function useColors(): Palette {
  return useColorScheme() === 'dark' ? darkPalette : lightPalette;
}

/** Przeglądarka rysuje niebieską ramkę wokół aktywnego pola — mamy własny styl fokusu. Na telefonie: nic. */
export const noOutline = (Platform.OS === 'web' ? { outlineStyle: 'none' } : null) as object | null;
