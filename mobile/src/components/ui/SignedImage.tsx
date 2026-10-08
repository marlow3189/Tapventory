import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useSignedUrl, type Bucket } from '@/lib/storage';
import { hueFromString, initials } from '@/lib/format';
import { useColors } from '@/theme';
import { Icon } from './Icon';
import { Skeleton } from './Skeleton';
import { Text } from './Text';

/**
 * Zdjęcie z prywatnego bucketu: pobiera podpisany, wygasający link i wyświetla go z cache'em
 * (klucz cache = ścieżka pliku, więc nowy link po godzinie nie powoduje ponownego pobierania).
 */
export function SignedImage({
  bucket = 'product-photos', path, style, fallback, contentFit = 'cover', label,
}: {
  bucket?: Bucket; path: string | null | undefined; style?: StyleProp<ViewStyle>; fallback?: ReactNode;
  contentFit?: 'cover' | 'contain'; label?: string;
}) {
  const url = useSignedUrl(bucket, path);
  if (!path) return <View style={style}>{fallback ?? null}</View>;
  if (url.isError) return <View style={style}>{fallback ?? null}</View>;
  if (!url.data) return <Skeleton width="100%" height="100%" round={0} style={style} />;
  return (
    <Image
      source={{ uri: url.data, cacheKey: path }}
      style={style as never}
      contentFit={contentFit}
      transition={150}
      accessibilityLabel={label}
      recyclingKey={path}
    />
  );
}

/** Kolorowy kafelek z inicjałami, gdy produkt nie ma zdjęcia (ten sam odcień dla tej samej nazwy). */
export function PhotoPlaceholder({ name, size = 'large' }: { name?: string | null; size?: 'small' | 'large' }) {
  const c = useColors();
  const hue = hueFromString(name ?? '?');
  return (
    <View style={[StyleSheet.absoluteFill, styles.placeholder, { backgroundColor: c.isDark ? `hsl(${hue}, 25%, 16%)` : `hsl(${hue}, 60%, 92%)` }]}>
      {name ? (
        <Text style={{ fontSize: size === 'large' ? 34 : 18, fontWeight: '700', color: c.isDark ? `hsl(${hue}, 45%, 70%)` : `hsl(${hue}, 45%, 38%)` }}>
          {initials(name)}
        </Text>
      ) : (
        <Icon name="image-outline" size={size === 'large' ? 40 : 22} color={c.textTertiary} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { alignItems: 'center', justifyContent: 'center' },
});
