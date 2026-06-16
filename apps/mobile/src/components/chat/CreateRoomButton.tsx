import { useState } from 'react';
import { DEFAULT_CATEGORY } from '@drakkar.software/octochat-sdk';

import { useRooms } from '@/lib/use-rooms';
import { useSpaceHeader } from '@/lib/use-space-header';
import { IconButton } from '@/components/ui/IconButton';

import { CreateRoomSheet } from './CreateRoomSheet';

/**
 * Owner-gated "+" button for the stack header. Renders nothing when the DM
 * home is selected, when no space is active, or when the signed-in user is
 * not the space owner. Tapping opens {@link CreateRoomSheet}.
 *
 * Self-contained — mirrors the {@link SpaceSettingsButton} pattern so it can
 * be dropped into any header slot with no prop wiring.
 */
export function CreateRoomButton() {
  const { space, isDmHome, activeId } = useSpaceHeader();
  const { isOwner, createRoom } = useRooms(isDmHome ? null : activeId);
  const [open, setOpen] = useState(false);

  if (isDmHome || !space || !isOwner) return null;

  return (
    <>
      <IconButton
        name="plus"
        size={18}
        accessibilityLabel="New channel"
        onPress={() => setOpen(true)}
      />
      <CreateRoomSheet
        visible={open}
        onClose={() => setOpen(false)}
        defaultCategory={DEFAULT_CATEGORY}
        onSubmit={(name, category, isPublic) => createRoom(name, category, { isPublic })}
      />
    </>
  );
}
