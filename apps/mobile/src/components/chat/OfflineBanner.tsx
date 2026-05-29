import { Callout } from '@/components/ui/Callout';

/** "You're offline" notice shown above a conversation when the room opened without a
 *  connection (or connectivity dropped). Composes the generic {@link Callout}; the
 *  screen owns WHEN to show it (online/offline state), this owns how it looks. `subject`
 *  is the thing being queued — "messages" in a room, "replies" in a thread. */
export function OfflineBanner({ subject = 'messages' }: { subject?: string }) {
  return (
    <Callout tone="warning" iconName="clock">
      You’re offline — {subject} you send will go out when you reconnect.
    </Callout>
  );
}
