import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import type { Message, User } from '@/lib/types';
import type { AttachmentRef } from '@/lib/starfish/attachments';
import { plural } from '@/lib/format';
import { useRowHover } from '@/lib/use-hover';
import { useTheme } from '@/lib/use-theme';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

import { AttachmentView } from './AttachmentView';
import { MessageActions } from './MessageActions';
import { ReactionBar } from './ReactionBar';

interface MessageGroupProps {
  message: Message;
  author: User;
  onOpenThread?: () => void;
  /** Toggle a reaction emoji on this message. */
  onToggleReaction?: (emoji: string) => void;
  /** Resolve a reactor's user id to a display name (for the reaction tooltip). */
  nameFor?: (userId: string) => string;
  /** Fetch + decrypt an attachment's bytes (bound to the room by the hook). */
  onLoadAttachment?: (ref: AttachmentRef) => Promise<Uint8Array | null>;
  /** Emphasize as the highlighted parent in a thread view. */
  highlighted?: boolean;
}

/** A single authored message block: avatar, header, body, media, reactions, thread. */
export function MessageGroup({
  message,
  author,
  onOpenThread,
  onToggleReaction,
  onLoadAttachment,
  nameFor,
  highlighted,
}: MessageGroupProps) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useRowHover();
  const tinted = message.mention || highlighted;
  // Quick actions (react / reply) live in a floating toolbar shown on hover
  // (web) / always on native. It overlays the row, so revealing it never shifts
  // surrounding content. Existing reactions and the reply count stay inline as
  // content — those always show, since they signal a thread/reaction exists.
  const showActions = Platform.OS !== 'web' || hovered;
  const mine = new Set((message.reactions ?? []).filter((r) => r.mine).map((r) => r.emoji));
  return (
    <View
      {...hoverProps}
      style={[styles.row, tinted ? { backgroundColor: colors.accentBg } : hovered ? { backgroundColor: colors.hover } : null]}
    >
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
        {message.attachmentRef ? (
          <AttachmentView attachment={message.attachmentRef} onLoad={onLoadAttachment} />
        ) : null}
        {message.reactions?.length ? (
          <ReactionBar reactions={message.reactions} onToggle={onToggleReaction} nameFor={nameFor} />
        ) : null}
        {onOpenThread && message.threadCount ? (
          <Pressable
            accessibilityRole="button"
            onPress={onOpenThread}
            style={[styles.thread, { borderColor: colors.lineFaint, backgroundColor: colors.surface }]}
          >
            <Icon name="thread" size={13} color={colors.accent} />
            <Txt variant="footnote" weight="semibold" tone="accent">
              {plural(message.threadCount, 'reply', 'replies')}
            </Txt>
            <Icon name="chev" size={13} color={colors.inkMuted} />
          </Pressable>
        ) : null}
      </View>
      {onToggleReaction || onOpenThread ? (
        <MessageActions visible={showActions} onReact={onToggleReaction} onReply={onOpenThread} mine={mine} />
      ) : null}
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
