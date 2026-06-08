import type { Ref } from 'react';
import type { View } from 'react-native';

import type { Room } from '@drakkar.software/octochat-sdk';
import { useMutes } from '@/lib/mutes-context';
import { ListRow } from '@/components/chat/ListRow';

interface ChannelRowProps {
  room: Room;
  active?: boolean;
  onPress?: () => void;
  /** Long-press (native) — used to offer "Move to category…". */
  onLongPress?: () => void;
  /** Ref to the row's outer element — the web drag handle (see useDraggableRoom). */
  rowRef?: Ref<View>;
  /** Peer's avatar image for DM rows (monogram fallback when absent). */
  avatarImage?: string;
}

/** A single room/DM entry in the channel list — a thin mapping of {@link Room}
 *  (incl. mute state) onto the shared {@link ListRow}. */
export function ChannelRow({ room, active = false, onPress, onLongPress, rowRef, avatarImage }: ChannelRowProps) {
  const { isRoomMuted, isSpaceMuted } = useMutes();
  const muted = isRoomMuted(room.id) || isSpaceMuted(room.spaceId);
  return (
    <ListRow
      label={room.name}
      avatarLabel={room.kind === 'dm' ? (room.avatar ?? '??') : undefined}
      avatarImage={room.kind === 'dm' ? avatarImage : undefined}
      iconName={
        room.kind === 'automated'
          ? 'zap'
          : room.kind === 'private'
          ? 'lock'
          : 'hash'
      }
      active={active}
      unread={room.unread}
      mention={room.mention}
      muted={muted}
      onPress={onPress}
      onLongPress={onLongPress}
      rowRef={rowRef}
    />
  );
}
