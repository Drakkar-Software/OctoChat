import { useSpaces } from '@/lib/use-spaces';
import { AppBar } from '@/components/ui/AppBar';
import { AutomationsView } from '@/components/chat/AutomationsView';

/**
 * Automations bottom tab — mirrors the Threads tab by listing the active
 * space's automations. Shares {@link AutomationsView} with the per-space
 * `/automations/[spaceId]` destination; here the header carries the space name
 * as a subtitle instead of a back button.
 */
export default function AutomationsTabScreen() {
  const { spaces, activeId } = useSpaces();
  const space = spaces.find((s) => s.id === activeId);
  return (
    <AutomationsView
      spaceId={activeId}
      header={<AppBar title="Automations" subtitle={space?.name} />}
      inTabs
    />
  );
}
