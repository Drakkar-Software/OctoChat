import { Fragment } from 'react';

import type { Room } from '@/lib/types';
import type { ThreadSummary } from '@/lib/threads';
import type { DmEntry } from '@/lib/use-dms';
import { EmptyState } from '@/components/ui/EmptyState';

import { ChannelRow } from './ChannelRow';
import { ThreadRow } from './ThreadRow';

interface DmListProps {
  dms: DmEntry[];
  activeRoomId?: string;
  /** Recent threads of the active DM — rendered indented under its row (desktop
   *  sidebar), mirroring a channel's thread digest. Omit to show none. */
  threads?: ThreadSummary[];
  onOpen: (dm: DmEntry) => void;
  /** Open one of the active DM's threads (the reply target's message id). */
  onOpenThread?: (parentId: string) => void;
}

/**
 * The contents of the virtual DM space: one {@link ChannelRow} per conversation
 * (reusing the `kind:'dm'` person-monogram + unread path), or an empty state that
 * explains how to start a DM. Used by the mobile rooms screen AND the desktop room
 * sidebar so both surfaces stay identical. Each DM's name/initials are the PEER's
 * (viewer-correct — see `use-dms`). The active DM trails its most recent threads
 * (when supplied), exactly like a channel row in {@link RoomCategorySection}.
 */
export function DmList({ dms, activeRoomId, threads, onOpen, onOpenThread }: DmListProps) {
  if (dms.length === 0) {
    return (
      <EmptyState
        iconName="dm"
        title="No direct messages yet"
        subtitle="Open someone’s profile and tap Message to start a private, encrypted conversation. You can DM anyone you share a private space with."
      />
    );
  }
  return (
    <>
      {dms.map((dm) => {
        // Synthetic Room so the shared ChannelRow renders the DM (monogram + unread).
        const room: Room = {
          id: dm.roomId,
          spaceId: dm.spaceId,
          category: '',
          name: dm.name,
          kind: 'dm',
          avatar: dm.initials,
          unread: dm.unread,
        };
        return (
          <Fragment key={dm.spaceId}>
            <ChannelRow
              room={room}
              avatarImage={dm.image}
              active={dm.roomId === activeRoomId}
              onPress={() => onOpen(dm)}
            />
            {dm.roomId === activeRoomId && threads?.length
              ? threads.map((t) => (
                  <ThreadRow key={t.parentId} thread={t} onPress={() => onOpenThread?.(t.parentId)} />
                ))
              : null}
          </Fragment>
        );
      })}
    </>
  );
}
