import { Callout } from '@/components/ui/Callout';

/** "You're offline" notice. Composes the generic {@link Callout}; the screen owns
 *  WHEN to show it (online/offline state), this owns how it looks.
 *  - In a conversation, `subject` is the thing being queued — "messages" in a room,
 *    "replies" in a thread — and the copy is about sends going out on reconnect.
 *  - On a list (the rooms tab / desktop sidebar) that send-copy is wrong, so pass a
 *    full `message` override (e.g. "showing your last-synced rooms"). */
export function OfflineBanner({ subject = 'messages', message }: { subject?: string; message?: string }) {
  return (
    <Callout tone="warning" iconName="clock">
      {message ?? `You’re offline — ${subject} you send will go out when you reconnect.`}
    </Callout>
  );
}
