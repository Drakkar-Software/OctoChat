import { Pressable, StyleSheet, View } from 'react-native';

import { glowShadow, radii, spacing } from '@/theme';
import { authorFor, dayLabel } from '@/lib/message-view';
import type { ThreadSummary } from '@/lib/threads';
import type { Room, RoomKind } from '@/lib/types';
import { useHover } from '@/lib/use-hover';
import { useAvatars, usePseudos } from '@/lib/use-pseudos';
import { useTheme } from '@/lib/use-theme';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

/** Room-kind glyph, matching {@link DesktopChatTopbar}. */
const ROOM_ICON: Record<RoomKind, IconName> = {
  channel: 'hash',
  private: 'lock',
  dm: 'people',
  stream: 'stream',
  automated: 'refresh',
};

/** Avatars shown before the conversation collapses to a "+N" disc. */
const STACK_LIMIT = 3;
/** Small avatar diameter for the participant deck. */
const FACE = 22;

/**
 * Overlapping deck of a thread's participants — newest-active face in front,
 * each ringed in `paper` so the deck reads as stacked. Resolves names/avatars
 * from the shared profile cache like {@link MessageResult}.
 */
function ParticipantDeck({ ids, currentUserId }: { ids: string[]; currentUserId: string }) {
  'use no memo'; // ids are stable per row, so opt into profile-cache ticks (see use-pseudos)
  const { colors } = useTheme();
  const pseudo = usePseudos(ids);
  const avatar = useAvatars(ids);
  const shown = ids.slice(0, STACK_LIMIT);
  const extra = ids.length - shown.length;
  return (
    <View style={styles.deck}>
      {shown.map((id, i) => {
        const a = authorFor(id, currentUserId, pseudo(id), avatar(id));
        return (
          <View
            key={id}
            // Newest face overlaps the next; ring in `paper` separates the deck.
            style={[styles.face, { marginLeft: i ? -FACE / 3 : 0, borderColor: colors.paper, zIndex: shown.length - i }]}
          >
            <Avatar label={a.initials} image={a.avatar} size={FACE} />
          </View>
        );
      })}
      {extra > 0 ? (
        <View style={[styles.face, styles.more, { marginLeft: -FACE / 3, backgroundColor: colors.fill, borderColor: colors.paper }]}>
          <Txt variant="micro" weight="semibold" mono tone="inkMuted">
            +{extra}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

/**
 * A thread preview card for the Threads tab: the room it lives in, the anchor
 * message's label, a deck of its participants, the reply count and latest-activity
 * day, plus an unread badge. Unread threads light an accent left-rail and lift
 * their ink — calm when read, surfacing when active. {@link ThreadRow} stays the
 * sidebar-nested variant.
 */
export function ThreadResult({ room, thread, currentUserId, onPress }: { room: Room; thread: ThreadSummary; currentUserId: string; onPress: () => void }) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useHover();
  const unread = thread.unread > 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Thread in ${room.name}: ${thread.label}`}
      onPress={onPress}
      {...hoverProps}
      style={[
        styles.card,
        {
          backgroundColor: hovered ? colors.paperAlt : colors.paper,
          borderColor: hovered || unread ? colors.accentBorder : colors.lineFaint,
          borderTopColor: colors.hairlineHi, // "lit from above" edge
        },
        hovered ? glowShadow(colors.glow, 0.16, 12) : null,
      ]}
    >
      {unread ? <View style={[styles.rail, { backgroundColor: colors.accent }]} /> : null}

      <View style={styles.head}>
        <Icon name={ROOM_ICON[room.kind]} size={11} color={unread ? colors.accent : colors.inkMuted} />
        <Txt variant="caption" weight="semibold" tone={unread ? 'accentInk' : 'inkSoft'} numberOfLines={1} style={styles.room}>
          {room.name}
        </Txt>
        <Txt variant="micro" mono color={unread ? colors.accent : colors.inkMuted}>
          {dayLabel(thread.lastActivityTs)}
        </Txt>
      </View>

      <Txt variant="subhead" weight={unread ? 'semibold' : 'regular'} tone={unread ? 'ink' : 'inkSoft'} numberOfLines={2}>
        {thread.label}
      </Txt>

      <View style={styles.foot}>
        <ParticipantDeck ids={thread.participantIds} currentUserId={currentUserId} />
        <Icon name="reply" size={13} color={colors.inkMuted} />
        <Txt variant="caption" mono tone="inkMuted">
          {thread.replyCount} {thread.replyCount === 1 ? 'reply' : 'replies'}
        </Txt>
        <View style={styles.spacer} />
        <Badge count={thread.unread} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg, // clears the accent rail
    paddingRight: spacing.md,
    borderRadius: radii.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  rail: { position: 'absolute', left: 0, top: spacing.md, bottom: spacing.md, width: 3, borderTopRightRadius: radii.xs, borderBottomRightRadius: radii.xs },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  room: { flex: 1 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  spacer: { flex: 1 },
  deck: { flexDirection: 'row', alignItems: 'center' },
  // FACE + 2px ring all round → outer radius is half of (FACE + 4) (mirrors Avatar's size/2).
  face: { borderRadius: (FACE + 4) / 2, borderWidth: 2, overflow: 'hidden' },
  more: { width: FACE, height: FACE, alignItems: 'center', justifyContent: 'center' },
})
