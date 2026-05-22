import { router, useLocalSearchParams } from 'expo-router';

import { useSession } from '@/lib/session-context';
import { useRoom } from '@/lib/use-room';
import { AppBar } from '@/components/ui/AppBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { StackScreen } from '@/components/ui/StackScreen';
import { BroadcastCreator } from '@/components/chat/BroadcastCreator';

/**
 * Owner flow: turn a channel into a plaintext, cap-only share link. Thin — opens
 * the room (to snapshot its messages) and composes BroadcastCreator once ready. The
 * creator does the minting; this page only handles route params + open/error state.
 */
export default function BroadcastScreen() {
  const params = useLocalSearchParams<{ roomId: string; name?: string }>();
  const roomId = params.roomId;
  const name = params.name ?? roomId;
  const { session } = useSession();
  const { store, opening, openError } = useRoom(roomId);

  return (
    <StackScreen scroll header={<AppBar title={`Share #${name}`} onBack={() => router.back()} />}>
      {!session ? (
        <EmptyState iconName="lock" title="Sign in first" subtitle="Create an identity to share a channel." />
      ) : opening ? (
        <EmptyState iconName="globe" title="Opening channel…" subtitle="Fetching the messages to snapshot." />
      ) : openError ? (
        <EmptyState iconName="alert" title="Couldn't open channel" subtitle={openError} />
      ) : store ? (
        <BroadcastCreator store={store} channelName={name} />
      ) : (
        <EmptyState iconName="globe" title="Connecting…" />
      )}
    </StackScreen>
  );
}
