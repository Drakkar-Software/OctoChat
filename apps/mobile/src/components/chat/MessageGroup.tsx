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
  /** Render as a follow-up to the previous message from the same author within
   *  the grouping window: hide the avatar and name header, keep the body aligned. */
  continuation?: boolean;
}

/** Avatar diameter; also the width of the gutter kept under continuation rows so
 *  their body stays aligned with the first message of the group. */
const AVATAR_SIZE = 36;

/** A single authored message block: avatar, header, body, media, reactions, thread. */
export function MessageGroup({
  message,
  author,
  onOpenThread,
  onToggleReaction,
  onLoadAttachment,
  nameFor,
  highlighted,
  continuation,
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
      style={[
        styles.row,
        continuation ? styles.continuation : null,
        tinted ? { backgroundColor: colors.accentBg } : hovered ? { backgroundColor: colors.hover } : null,
      ]}
    >
      {message.mention || highlighted ? (
        <View style={[styles.mentionBar, { backgroundColor: colors.accent }]} />
      ) : null}
      {continuation ? (
        <View style={styles.gutter}>
          {showActions ? (
            <Txt variant="micro" mono tone="inkMuted">
              {message.time}
            </Txt>
          ) : null}
        </View>
      ) : (
        <Avatar label={author.initials} image={author.avatar} size={AVATAR_SIZE} presence={author.presence} />
      )}
      <View style={styles.body}>
        {continuation ? null : (
          <View style={styles.head}>
            <Txt variant="callout" weight="bold">
              {author.name}
            </Txt>
            <Txt variant="micro" mono tone="inkMuted">
              {message.time}
            </Txt>
          </View>
        )}
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
  // Tighten only the top so a follow-up hugs the message above it while keeping
  // normal breathing room below before the next author's group.
  continuation: { paddingTop: spacing.xs },
  // Empty stand-in for the avatar so a continuation's body stays aligned; the
  // time surfaces here on hover (web) / always (native) as a quiet timestamp.
  gutter: { width: AVATAR_SIZE, alignItems: 'flex-end' },
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
