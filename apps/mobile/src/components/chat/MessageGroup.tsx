import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import type { Message, Room, User } from '@/lib/types';
import type { AttachmentRef } from '@/lib/starfish/attachments';
import { plural } from '@/lib/format';
import { useRowHover } from '@/lib/use-hover';
import { useTheme } from '@/lib/use-theme';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { LinkText } from '@/components/ui/LinkText';
import { Txt } from '@/components/ui/Txt';

import { AttachmentView } from './AttachmentView';
import { MessageActions } from './MessageActions';
import { MessageEditor } from './MessageEditor';
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
  /** Resolve a `#channel` mention in the body to a room so it links there. */
  resolveRoom?: (name: string) => Room | undefined;
  /** The viewer's pseudo — an `@mention` of it renders as a highlight chip. */
  currentUserName?: string;
  /** Emphasize as the highlighted parent in a thread view. */
  highlighted?: boolean;
  /** Render as a follow-up to the previous message from the same author within
   *  the grouping window: hide the avatar and name header, keep the body aligned. */
  continuation?: boolean;
  /** Commit an edit to this message's text. Omit to hide the edit affordance
   *  (e.g. not the author, or the message has no text to edit). */
  onEdit?: (newText: string) => void;
  /** Controlled inline-editor state. When provided, the parent owns whether this
   *  row's editor is open (e.g. the room's ArrowUp "edit last" shortcut); omit to
   *  keep it local to the row's edit button. */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  /** Delete this message. Omit to hide the delete affordance (e.g. not the author). */
  onDelete?: () => void;
  /** Open the author's profile (tapping the avatar or name). Omit to render them
   *  inert — e.g. read-only/snapshot contexts with nowhere to navigate. */
  onPressAuthor?: () => void;
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
  resolveRoom,
  currentUserName,
  onEdit,
  onDelete,
  onPressAuthor,
  editing: editingProp,
  onEditingChange,
}: MessageGroupProps) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useRowHover();
  // Controllable: the parent owns editing when it passes `editing`/`onEditingChange`
  // (room ArrowUp shortcut); otherwise the row's own edit button drives local state.
  const [editingInternal, setEditingInternal] = useState(false);
  const editing = editingProp ?? editingInternal;
  const setEditing: (v: boolean) => void = onEditingChange ?? setEditingInternal;
  const tinted = message.mention || highlighted;
  // An @-mention of you that you haven't read yet escalates the highlight: a
  // wider, stronger accent bar + deeper tint so it stands out from a read mention
  // or a thread's highlighted parent.
  const strong = !!message.mention && !!message.unread;
  // Make the avatar/name open the author's profile when a handler is wired;
  // render them inert otherwise so the component stays usable read-only.
  const authorLink = (node: ReactNode) =>
    onPressAuthor ? (
      <Pressable accessibilityRole="button" accessibilityLabel={`View ${author.name}'s profile`} onPress={onPressAuthor} hitSlop={4}>
        {node}
      </Pressable>
    ) : (
      node
    );
  // Quick actions (react / reply) live in a floating toolbar that overlays the
  // row, so revealing it never shifts surrounding content. Existing reactions and
  // the reply count stay inline as content — those always show, since they signal
  // a thread/reaction exists. Web reveals the toolbar on row hover; native (no
  // pointer) reveals it on a long-press, so it isn't pinned over every row.
  const [revealed, setRevealed] = useState(false);
  const showActions = Platform.OS === 'web' ? hovered : revealed;
  const mine = new Set((message.reactions ?? []).filter((r) => r.mine).map((r) => r.emoji));
  const rowStyle = [
    styles.row,
    continuation ? styles.continuation : null,
    strong
      ? { backgroundColor: colors.accentBgStrong }
      : tinted
        ? { backgroundColor: colors.accentBg }
        : hovered
          ? { backgroundColor: colors.hover }
          : null,
  ];
  const content = (
    <>
      {tinted ? (
        <View
          style={[
            styles.mentionBar,
            { width: strong ? 6 : 3, backgroundColor: strong ? colors.accentStrong : colors.accent },
          ]}
        />
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
        authorLink(<Avatar label={author.initials} image={author.avatar} size={AVATAR_SIZE} presence={author.presence} />)
      )}
      <View style={styles.body}>
        {continuation ? null : (
          <View style={styles.head}>
            {authorLink(
              <Txt variant="callout" weight="bold">
                {author.name}
              </Txt>,
            )}
            <Txt variant="micro" mono tone="inkMuted">
              {message.time}
            </Txt>
          </View>
        )}
        {message.deleted ? (
          <Txt variant="body" tone="inkFaint">
            Message deleted
          </Txt>
        ) : editing ? (
          <MessageEditor
            initialText={message.text ?? ''}
            onSubmit={(t) => {
              onEdit?.(t);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            {message.text ? (
              <LinkText variant="body" tone="inkSoft" resolveRoom={resolveRoom} currentUserName={currentUserName}>
                {message.text}
              </LinkText>
            ) : null}
            {message.edited ? (
              <Txt variant="micro" tone="inkFaint">
                (edited)
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
          </>
        )}
      </View>
      {!message.deleted && !editing && (onToggleReaction || onOpenThread || onEdit || onDelete) ? (
        <MessageActions
          visible={showActions}
          onReact={onToggleReaction}
          onReply={onOpenThread}
          onEdit={onEdit ? () => setEditing(true) : undefined}
          onDelete={onDelete}
          mine={mine}
        />
      ) : null}
    </>
  );

  // Web keeps a plain View — a Pressable row would force a pointer cursor and
  // block message-text selection. Native (no hover) uses a Pressable so a
  // long-press toggles the action toolbar instead of pinning it on every row.
  return Platform.OS === 'web' ? (
    <View {...hoverProps} style={rowStyle}>
      {content}
    </View>
  ) : (
    <Pressable onLongPress={() => setRevealed((v) => !v)} delayLongPress={260} style={rowStyle}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.screenX,
    // Asymmetric: a roomy top opens the gap above a new author's group, a tight
    // bottom keeps stacked messages close. A follow-up zeroes its top (below).
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  // Drop the top gap entirely so a follow-up hugs the message above it; only the
  // row's tight bottom padding remains between it and the previous message.
  continuation: { paddingTop: spacing.none },
  // Empty stand-in for the avatar so a continuation's body stays aligned; the
  // time surfaces here on hover (web) / always (native) as a quiet timestamp.
  gutter: { width: AVATAR_SIZE, alignItems: 'flex-end' },
  // Width + color set inline per row (3px accent normally; 6px accentStrong for
  // an unread @-mention of you).
  mentionBar: { position: 'absolute', left: 0, top: 0, bottom: 0 },
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
