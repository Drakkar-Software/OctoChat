import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import type { Message, User } from '@/lib/types';
import { plural } from '@/lib/format';
import { useTheme } from '@/lib/use-theme';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

import { Attachment } from './Attachment';
import { ReactionBar } from './ReactionBar';

interface MessageGroupProps {
  message: Message;
  author: User;
  onOpenThread?: () => void;
  /** Toggle a reaction emoji on this message. */
  onToggleReaction?: (emoji: string) => void;
  /** Emphasize as the highlighted parent in a thread view. */
  highlighted?: boolean;
}

/** A single authored message block: avatar, header, body, media, reactions, thread. */
export function MessageGroup({ message, author, onOpenThread, onToggleReaction, highlighted }: MessageGroupProps) {
  const { colors } = useTheme();
  const tinted = message.mention || highlighted;
  return (
    <View style={[styles.row, tinted && { backgroundColor: colors.accentBg }]}>
      {message.mention || highlighted ? (
        <View style={[styles.mentionBar, { backgroundColor: colors.accent }]} />
      ) : null}
      <Avatar label={author.initials} size={36} presence={author.presence} />
      <View style={styles.body}>
        <View style={styles.head}>
          <Txt variant="callout" weight="bold">
            {author.name}
          </Txt>
          <Txt variant="micro" mono tone="inkMuted">
            {message.time}
          </Txt>
        </View>
        {message.text ? (
          <Txt variant="body" tone="inkSoft">
            {message.text}
          </Txt>
        ) : null}
        {message.attachment ? <Attachment data={message.attachment} /> : null}
        {message.reactions?.length || onToggleReaction ? (
          <ReactionBar reactions={message.reactions ?? []} onToggle={onToggleReaction} />
        ) : null}
        {onOpenThread ? (
          <Pressable
            accessibilityRole="button"
            onPress={onOpenThread}
            style={[styles.thread, { borderColor: colors.lineFaint, backgroundColor: colors.surface }]}
          >
            <Icon name="thread" size={13} color={colors.accent} />
            <Txt variant="footnote" weight="semibold" tone="accent">
              {message.threadCount ? plural(message.threadCount, 'reply', 'replies') : 'Reply in thread'}
            </Txt>
            <Icon name="chev" size={13} color={colors.inkMuted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.screenX,
    paddingVertical: spacing.sm,
  },
  mentionBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  body: { flex: 1, gap: 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  thread: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    borderWidth: 1,
    marginTop: 4,
  },
});
