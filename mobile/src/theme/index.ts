import { useColorScheme } from 'react-native';
import { darkPalette, lightPalette, type Palette } from './tokens';

export * from './tokens';

/** Paleta zgodna z ustawieniem systemu (jasny / ciemny). */
export function useColors(): Palette {
  return useColorScheme() === 'dark' ? darkPalette : lightPalette;
}
