import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { PhotoPlaceholder, SignedImage, Text, Touchable } from '@/components/ui';
import { formatQty } from '@/lib/format';
import type { ProductRow } from '@/lib/types';
import { useColors } from '@/theme';

/** Kafelek produktu w siatce 3×N (jak zdjęcia na profilu Instagrama). Czerwona kropka = poniżej minimum. */
function ProductTileBase({ p, size, onPress }: { p: ProductRow; size: number; onPress: () => void }) {
  const c = useColors();
  return (
    <Touchable
      onPress={onPress}
      pressedOpacity={0.85}
      accessibilityLabel={`${p.name}, stan ${formatQty(p.stock)} ${p.unit}${p.below_min ? ', poniżej minimum' : ''}`}
      style={{ width: size, height: size, backgroundColor: c.fill }}
    >
      <SignedImage path={p.photo_path} style={StyleSheet.absoluteFill} fallback={<PhotoPlaceholder name={p.name} size="small" />} label={p.name} />
      <View style={styles.bar}>
        <Text variant="caption" bold numberOfLines={1} style={styles.barText}>
          {p.name}
        </Text>
        <Text variant="caption" numberOfLines={1} style={styles.barText}>
          {formatQty(p.stock)} {p.unit}
        </Text>
      </View>
      {p.below_min ? <View style={[styles.dot, { backgroundColor: c.danger, borderColor: '#FFFFFF' }]} /> : null}
    </Touchable>
  );
}

export const ProductTile = memo(ProductTileBase);

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 6, paddingVertical: 3 },
  barText: { color: '#FFFFFF' },
  dot: { position: 'absolute', top: 6, right: 6, width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
});
