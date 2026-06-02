import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { useSpaces } from '@/lib/use-spaces';
import { useObjects } from '@/lib/use-objects';
import { AppBar } from '@/components/ui/AppBar';
import { StackScreen } from '@/components/ui/StackScreen';
import { Breadcrumbs } from '@/components/objects/Breadcrumbs';
import { ObjectActions } from '@/components/objects/ObjectActions';
import { ProjectBoard } from '@/components/work/ProjectBoard';

/** Project board — live kanban folded from the append-only log + ancestor breadcrumbs. */
export default function WorkProjectScreen() {
  const router = useRouter();
  const { activeId } = useSpaces();
  const { id, spaceId: spaceParam, emoji, label } = useLocalSearchParams<{ id: string; spaceId?: string; emoji?: string; label?: string }>();
  const spaceId = spaceParam || activeId || '';
  const { breadcrumbs, get, rename, archive } = useObjects(spaceId, { enabled: !!spaceId });
  const trail = breadcrumbs(id);
  const node = get(id);
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/work'));
  const openCrumb = (nid: string, type?: string) =>
    router.push({ pathname: type === 'project' ? '/work/project/[id]' : '/work/doc/[id]', params: { id: nid, spaceId } });

  return (
    <StackScreen
      scroll
      contentStyle={styles.content}
      header={
        <AppBar
          title="Project"
          subtitle="Workspace"
          onBack={goBack}
          right={<ObjectActions node={node} onRename={(patch) => rename(id, patch)} onArchive={() => { archive(id); goBack(); }} />}
        />
      }
    >
      <Breadcrumbs trail={trail} onNavigate={(n) => openCrumb(n.id, n.type)} />
      <ProjectBoard spaceId={spaceId} objectId={id} emoji={node?.emoji || emoji} title={node?.title || label} />
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screenX, paddingTop: spacing.lg, paddingBottom: spacing.xxxl },
});
