import { ScrollView, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Skeleton, StoryBubble } from '@/components/ui';
import { useDashboard } from '@/lib/api/misc';
import { buildStories } from '@/lib/stories';
import { spacing } from '@/theme';

/** Rząd kółek na górze ekranu głównego: zadania na dziś (Braki, Zgłoszenia, Faktury, Mini-spis). */
export function StoriesRow() {
  const router = useRouter();
  const { data, isPending } = useDashboard();
  const stories = buildStories(data);

  if (isPending) {
    return (
      <ScrollView horizontal scrollEnabled={false} contentContainerStyle={styles.row}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} width={66} height={66} round={33} />
        ))}
      </ScrollView>
    );
  }
  if (stories.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {stories.map((s) => (
        <StoryBubble
          key={s.id}
          label={s.label}
          icon={s.icon}
          count={s.count}
          urgent={s.urgent}
          onPress={() => router.push(`/story/${s.id}` as Href)}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: spacing.l, paddingVertical: spacing.m, gap: spacing.s, alignItems: 'flex-start' },
});
