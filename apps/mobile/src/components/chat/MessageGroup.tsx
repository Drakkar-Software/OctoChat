import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import type { Message, Room, User } from '@drakkar.software/octochat-sdk';
import type { AttachmentRef } from '@drakkar.software/octochat-sdk';
import { plural } from '@drakkar.software/octochat-sdk';
import { useHover, useRowHover } from '@/lib/use-hover';
import { useTheme } from '@/lib/use-theme';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { Txt } from '@/components/ui/Txt';

import { AttachmentView } from './AttachmentView';
import { MessageBody } from './MessageBody';
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
  /** Resolve an `@user` mention in the body to a user id (paired with
   *  {@link onOpenMention}) so tapping it opens that user's profile. */
  resolveUser?: (name: string) => string | undefined;
  /** Open a tapped `@user` mention's profile — the mention twin of
   *  {@link onPressAuthor}. */
  onOpenMention?: (userId: string) => void;
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
  /** Pin/unpin this message. Omit to hide the pin affordance (e.g. not the space owner).
   *  The current pinned state is read from `message.pinned`. */
  onPin?: () => void;
  /** Open the author's profile (tapping the avatar or name). Omit to render them
   *  inert — e.g. read-only/snapshot contexts with nowhere to navigate. */
  onPressAuthor?: () => void;
  /** Retry sending a `failed` pending message (see {@link Message.pending}). Only
   *  meaningful for the viewer's own queued messages. */
  onRetry?: () => void;
}

/** Avatar diameter; also the width of the gutter kept under continuation rows so
 *  their body stays aligned with the first message of the group. */
const AVATAR_SIZE = 36;

/** Status line under an unsent (outbox) message: a muted "will send when online"
 *  while queued/sending, or a tappable "couldn't send · retry" once it failed. */
function PendingNote({ status, onRetry }: { status: NonNullable<Message['pending']>; onRetry?: () => void }) {
  const { colors } = useTheme();
  if (status === 'failed') {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="Retry sending message" onPress={onRetry} style={styles.pendingRow}>
        <Icon name="alert" size={12} color={colors.danger} />
        <Txt variant="micro" weight="medium" color={colors.danger}>
          Couldn’t send · Retry
        </Txt>
      </Pressable>
    );
  }
  return (
    <View style={styles.pendingRow}>
      <Icon name="clock" size={12} color={colors.inkMuted} />
      <Txt variant="micro" tone="inkMuted">
        {status === 'sending' ? 'Sending…' : 'Will send when online'}
      </Txt>
    </View>
  );
}

/** The "N replies" entry point under a message that anchors a thread. Lifts to an
 *  accent tint on hover so it reads as the tappable way in. */
function ThreadReplyChip({ count, onPress }: { count: number; onPress: () => void }) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      {...hoverProps}
      style={[
        styles.thread,
        {
          // Borderless on rest, accent-tinted background on hover — more integrated,
          // less like a standalone chip. Accent border only when hovered.
          borderColor: hovered ? colors.accentBorder : 'transparent',
          backgroundColor: hovered ? colors.accentBg : colors.accentBg,
        },
      ]}
    >
      <Icon name="thread" size={12} color={colors.accentInk} />
      <Txt variant="footnote" weight="semibold" color={colors.accentInk}>
        {plural(count, 'reply', 'replies')}
      </Txt>
      <Icon name="chev" size={11} color={hovered ? colors.accentInk : colors.accentInk} />
    </Pressable>
  );
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
  continuation,
  resolveRoom,
  resolveUser,
  onOpenMention,
  currentUserName,
  onEdit,
  onDelete,
  onPin,
  onPressAuthor,
  onRetry,
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
  // The viewer's own messages render their name in accent so "you" punches out of
  // the column at a glance (sharp accent punctuation, not spread color). `authorFor`
  // sets the name to "You" only when authorId === currentUserId, so this is reliable
  // without any new call-site wiring.
  const isSelf = author.name === 'You';
  // A failed (un-retried) send needs to be scannable against a busy stream — give
  // its row a danger-tinted left edge so "needs action" reads at a glance.
  const failed = message.pending === 'failed';
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
  const mine = new Set((message.reactions ?? []).flatMap((r) => r.mine ? [r.emoji] : []));
  // A queued/sending (not-yet-failed) message reads as muted — it's not on the
  // server yet. A failed one stays full-opacity so its retry affordance is obvious.
  const dimmed = message.pending === 'queued' || message.pending === 'sending';
  const rowStyle = [
    styles.row,
    continuation ? styles.continuation : null,
    dimmed ? styles.pendingDim : null,
    failed
      ? { backgroundColor: colors.dangerBg }
      : strong
        ? { backgroundColor: colors.accentBgStrong }
        : tinted
          ? { backgroundColor: colors.accentBg }
          : hovered
            ? { backgroundColor: colors.hover }
            : null,
  ];
  const content = (
    <>
      {failed ? (
        <View style={[styles.mentionBar, { width: 3, backgroundColor: colors.danger }]} />
      ) : tinted ? (
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
            <Txt variant="caption" mono tone="inkMuted">
              {message.time}
            </Txt>
          ) : null}
        </View>
      ) : (
        authorLink(<Avatar label={author.initials} image={author.avatar} size={AVATAR_SIZE} presence={author.presence} tint />)
      )}
      <View style={styles.body}>
        {continuation ? null : (
          <View style={styles.head}>
            {authorLink(
              <Txt variant="subhead" weight="semibold" tone={isSelf ? 'accent' : undefined}>
                {author.name}
              </Txt>,
            )}
            <Txt variant="caption" mono tone="inkMuted">
              {message.time}
            </Txt>
            {message.edited ? (
              <Txt variant="caption" mono tone="inkFaint">
                · edited
              </Txt>
            ) : null}
          </View>
        )}
        {message.deleted ? (
          <View style={[styles.tombstone, { backgroundColor: colors.surface, borderColor: colors.lineFaint }]}>
            <Icon name="trash" size={12} color={colors.inkFaint} />
            <Txt variant="footnote" tone="inkFaint">
              Message deleted
            </Txt>
          </View>
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
            {message.pinned ? <Pill label="Pinned" iconName="pin" tone="accent" /> : null}
            {message.text ? (
              <MessageBody
                body={message.text}
                tone="inkSoft"
                resolveRoom={resolveRoom}
                resolveUser={resolveUser}
                onPressUser={onOpenMention}
                currentUserName={currentUserName}
              />
            ) : null}
            {/* Non-continuation rows carry the "edited" mark in the header timestamp
                row; a continuation has no header, so surface it inline here. */}
            {message.edited && continuation ? (
              <Txt variant="micro" mono tone="inkFaint">
                edited
              </Txt>
            ) : null}
            {message.pending ? <PendingNote status={message.pending} onRetry={onRetry} /> : null}
            {message.attachmentRef ? (
              <AttachmentView attachment={message.attachmentRef} onLoad={onLoadAttachment} />
            ) : null}
            {message.reactions?.length ? (
              <ReactionBar reactions={message.reactions} onToggle={onToggleReaction} nameFor={nameFor} />
            ) : null}
            {onOpenThread && message.threadCount ? (
              <ThreadReplyChip count={message.threadCount} onPress={onOpenThread} />
            ) : null}
          </>
        )}
      </View>
      {!message.deleted && !editing && (onToggleReaction || onOpenThread || onEdit || onDelete || onPin) ? (
        <MessageActions
          visible={showActions}
          onReact={onToggleReaction}
          onReply={onOpenThread}
          onEdit={onEdit ? () => setEditing(true) : undefined}
          onDelete={onDelete}
          onPin={onPin}
          pinned={message.pinned}
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
    // Symmetric: equal top/bottom padding lets a new author group breathe above
    // AND below. A follow-up row (same author, <5 min) zeroes its top so stacked
    // messages remain tight while still honouring the group's bottom padding.
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
  // Dim a queued/sending message so it reads as not-yet-on-the-server.
  pendingDim: { opacity: 0.6 },
  // Clock/alert + status text under an unsent message.
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  // Removed-message slot: a quiet chip (trash glyph + label) so a deletion reads as
  // a tombstone, not just dimmed prose.
  tombstone: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  thread: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    marginTop: spacing.xs,
  },
});
