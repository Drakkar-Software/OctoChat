import { router, useLocalSearchParams } from 'expo-router';

import { AppBar } from '@/components/ui/AppBar';
import { AutomationsView } from '@/components/chat/AutomationsView';

/**
 * Per-space Automations destination — reached from the room sidebar's
 * "Automations" link. Wraps {@link AutomationsView} (shared with the
 * `automations` bottom tab) with a back-button header.
 */
export default function AutomationsScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  return (
    <AutomationsView
      spaceId={spaceId ?? null}
      header={<AppBar title="Automations" onBack={() => router.back()} />}
    />
  );
}
