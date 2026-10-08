// Karta zgłoszenia w feedzie — układ posta z Instagrama:
//   autor + czas + status  →  zdjęcie  →  serce („też potrzebuję") i komentarze  →  opis.

import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Avatar, Icon, PhotoPlaceholder, Pill, SignedImage, Text, Touchable } from '@/components/ui';
import { formatQty, plural, timeAgo } from '@/lib/format';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/status';
import type { RequestFeedRow } from '@/lib/types';
import { spacing, useColors } from '@/theme';

export const requestTitle = (r: Pick<RequestFeedRow, 'product_name' | 'free_name'>) => r.product_name ?? r.free_name ?? 'Zgłoszenie bez nazwy';

function RequestCardBase({ r, mine, onOpen, onVote }: {
  r: RequestFeedRow; mine: boolean; onOpen: () => void; onVote: () => void;
}) {
  const c = useColors();
  const title = requestTitle(r);
  const photo = r.photo_path ?? r.product_photo_path;
  const reporter = r.reporter_deleted ? 'Usunięty użytkownik' : r.reporter_name;
  const qty = r.qty !== null && r.qty !== undefined ? `${formatQty(r.qty)}${r.product_unit ? ` ${r.product_unit}` : ''}` : null;
  const others = r.vote_count;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Avatar name={reporter} size={34} />
        <View style={{ flex: 1 }}>
          <Text variant="bodyBold" numberOfLines={1}>
            {mine ? 'Ty' : reporter}
          </Text>
          <Text variant="footnote" color="secondary" numberOfLines={1}>
            {timeAgo(r.created_at)}
            {r.project_name ? ` · ${r.project_name}` : ''}
          </Text>
        </View>
        <Pill label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} />
      </View>

      <Touchable onPress={onOpen} accessibilityLabel={`Otwórz zgłoszenie: ${title}`} pressedOpacity={0.9}>
        <View style={[styles.media, { backgroundColor: c.fill, aspectRatio: photo ? 1 : 2.4 }]}>
          <SignedImage path={photo} style={StyleSheet.absoluteFill} fallback={<PhotoPlaceholder name={title} />} label={title} />
        </View>
      </Touchable>

      <View style={styles.actions}>
        {!mine ? (
          <Touchable
            haptic
            onPress={onVote}
            accessibilityLabel={r.voted_by_me ? 'Cofnij: też tego potrzebuję' : 'Też tego potrzebuję'}
            accessibilityState={{ selected: r.voted_by_me }}
            style={styles.iconBtn}
          >
            <Icon name={r.voted_by_me ? 'heart' : 'heart-outline'} size={28} color={r.voted_by_me ? c.danger : c.text} />
          </Touchable>
        ) : null}
        <Touchable onPress={onOpen} accessibilityLabel="Komentarze" style={styles.iconBtn}>
          <Icon name="chatbubble-outline" size={26} />
        </Touchable>
        {others > 0 ? (
          <Text variant="subhead" color="secondary" style={{ marginLeft: 'auto' }}>
            {others} {plural(others, ['osoba też potrzebuje', 'osoby też potrzebują', 'osób też potrzebuje'])}
          </Text>
        ) : null}
      </View>

      <View style={styles.caption}>
        <Text>
          <Text bold>{title}</Text>
          {qty ? <Text color="secondary">{`  ·  ${qty}`}</Text> : null}
        </Text>
        {r.note ? (
          <Text variant="callout" color="secondary" numberOfLines={3}>
            {r.note}
          </Text>
        ) : null}
        {r.message_count > 0 ? (
          <Touchable onPress={onOpen} accessibilityLabel="Zobacz komentarze">
            <Text variant="callout" color="secondary">
              Zobacz {r.message_count === 1 ? 'komentarz' : `wszystkie komentarze (${r.message_count})`}
            </Text>
          </Touchable>
        ) : null}
      </View>
    </View>
  );
}

export const RequestCard = memo(RequestCardBase);

const styles = StyleSheet.create({
  card: { paddingBottom: spacing.l, gap: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.l, paddingVertical: 10 },
  media: { width: '100%', aspectRatio: 1, overflow: 'hidden' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.m, paddingTop: 6 },
  iconBtn: { padding: 6 },
  caption: { paddingHorizontal: spacing.l, gap: 4, paddingTop: 2 },
});
