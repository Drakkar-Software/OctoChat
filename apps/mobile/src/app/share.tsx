import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { clockTime, initialsFor } from '@/lib/format';
import { useSession } from '@/lib/session-context';
import { useShareViewer } from '@/lib/use-share';
import type { BroadcastMessage } from '@/lib/starfish/broadcast';
import type { Message, User } from '@/lib/types';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { EmptyState } from '@/components/ui/EmptyState';
import { StackScreen } from '@/components/ui/StackScreen';
import { TextField } from '@/components/ui/TextField';
import { Txt } from '@/components/ui/Txt';
import { MessageGroup } from '@/components/chat/MessageGroup';

/**
 * Public viewer for a plaintext, cap-only share (`/share#<token>`). The credential
 * rides in the URL fragment; `useShareViewer` decodes it, reads the feed as the
 * link's ephemeral subject, and (for a read/write link) posts. Needs NO session —
 * a viewer arrives with just the link. Thin: all logic lives in `use-share`.
 */
const toMessage = (m: BroadcastMessage, shareId: string): Message => ({
  id: m.id,
  roomId: shareId,
  authorId: m.author,
  time: clockTime(m.ts),
  text: m.text,
});

const toAuthor = (name: string): User => ({ id: name, name, handle: name, initials: initialsFor(name) });

export default function SharePage() {
  const { state, post, posting } = useShareViewer();
  const { session } = useSession();
  const [draft, setDraft] = useState('');

  if (state.status === 'loading') {
    return (
      <StackScreen header={<AppBar title="Shared channel" />}>
        <View style={styles.center}>
          <Txt variant="callout" tone="inkMuted">
            Opening shared channel…
          </Txt>
        </View>
      </StackScreen>
    );
  }

  if (state.status === 'error') {
    return (
      <StackScreen header={<AppBar title="Shared channel" />}>
        <EmptyState iconName="alert" title="Can't open this link" subtitle={state.error} />
      </StackScreen>
    );
  }

  const { feed, token } = state;
  const author = session?.name ?? 'Guest';
  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    await post(author, text);
  };

  const footer = feed.write ? (
    <View style={styles.composer}>
      <TextField
        value={draft}
        onChangeText={setDraft}
        placeholder="Write a message…"
        returnKeyType="send"
        onSubmitEditing={send}
        containerStyle={styles.input}
      />
      <Button label="Send" variant="primary" iconName="send" onPress={send} disabled={posting || !draft.trim()} />
    </View>
  ) : undefined;

  return (
    <StackScreen
      header={
        <AppBar
          title={feed.name}
          subtitle={feed.write ? 'Shared channel · read & write' : 'Shared channel · read-only'}
        />
      }
      footer={footer}
      scroll
      contentStyle={styles.body}
    >
      <View style={styles.note}>
        <Callout tone="warning" iconName="unlock" title="Not end-to-end encrypted">
          This shared channel is plaintext — the server can read it. It isn&apos;t part of any encrypted space.
        </Callout>
      </View>
      {feed.messages.length === 0 ? (
        <EmptyState
          iconName="globe"
          title="Nothing here yet"
          subtitle={feed.write ? 'Be the first to post a message.' : 'The owner has not published anything yet.'}
        />
      ) : (
        feed.messages.map((m) => (
          <MessageGroup key={m.id} message={toMessage(m, token.shareId)} author={toAuthor(m.author)} />
        ))
      )}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  body: { paddingVertical: spacing.md },
  note: { paddingHorizontal: spacing.screenX, paddingBottom: spacing.sm },
  composer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  input: { flex: 1 },
});
