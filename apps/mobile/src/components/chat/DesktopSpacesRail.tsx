/**
 * OctoChat adapter for the headless `SpacesRail` component from
 * `@drakkar.software/octospaces-ui`.
 *
 * Responsibilities of this file (the integration layer):
 * - Map `Space[]` → `RailSpace[]` (including mute state from context).
 * - Inject OctoChat's Icon/Badge/expo-image into the package's render-props.
 * - Wire the account-foot widget (Avatar + AccountSwitcherPopover).
 * - Provide `useTileDnd` to restore web drag-reorder (hook injection — see below).
 *
 * `DesktopNav` and all other callers remain untouched (same props interface).
 */
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';

import type { Space } from '@drakkar.software/octochat-sdk';
import { SpacesRail } from '@drakkar.software/octospaces-ui';
import type { RailIconName, RailSpace } from '@drakkar.software/octospaces-ui';

import { DM_HOME_NAME } from '@/lib/dm-home';
import { useMutes } from '@/lib/mutes-context';
import { reorderBy, useReorderableSpace } from '@/lib/use-space-reorder';
import { AccountSwitcherPopover } from '@/components/account/AccountSwitcherPopover';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';

// ── RailIconName → OctoChat IconName mapping ──────────────────────────────────

const RAIL_ICON: Record<RailIconName, IconName> = {
  dm: 'dm',
  lock: 'lock',
  mute: 'volume-off',
  add: 'plus',
};

// ── Props (unchanged from before — DesktopNav is untouched) ───────────────────

interface DesktopSpacesRailProps {
  spaces: Space[];
  activeId: string | null;
  onSelect?: (id: string) => void;
  onAdd?: () => void;
  onSelectDms?: () => void;
  dmsActive?: boolean;
  dmUnread?: number;
  meLabel: string;
  meAvatar?: string;
  onOpenProfile?: () => void;
  /** Persist a new rail order after a drag-and-drop reorder (web only). */
  onReorder?: (orderedIds: string[]) => void;
}

// ── Adapter ───────────────────────────────────────────────────────────────────

/**
 * Vertical spaces rail pinned to the left edge of the desktop shell.
 * Renders via `SpacesRail` from `@drakkar.software/octospaces-ui`, themed
 * through the `OctoSpacesThemeProvider` already mounted at the app root.
 */
export function DesktopSpacesRail({
  spaces,
  activeId,
  onSelect,
  onAdd,
  onSelectDms,
  dmsActive,
  dmUnread,
  meLabel,
  meAvatar,
  onOpenProfile,
  onReorder,
}: DesktopSpacesRailProps) {
  const { isSpaceMuted } = useMutes();
  const [menuOpen, setMenuOpen] = useState(false);

  // Map domain Space[] → structural RailSpace[] (mute comes from context).
  const railSpaces: RailSpace[] = spaces.map((s) => ({
    id: s.id,
    short: s.short,
    image: s.image,
    unread: s.unread,
    muted: isSpaceMuted(s.id),
  }));

  // Web drag-reorder: resolve the "space dropped onto target" handler.
  const onDropSpace = onReorder
    ? (draggedId: string, targetId: string) =>
        onReorder(reorderBy(spaces.map((s) => s.id), draggedId, targetId))
    : undefined;

  // Hook injection for SpacesRail's DndTile components.
  // IMPORTANT: this function IS treated as a React hook — it is called unconditionally
  // at the top of every DndTile render, so useState + useReorderableSpace execute inside
  // DndTile's fiber, not here. Keep it always-provided or always-undefined per mount
  // (onReorder is stable in practice; SpacesRail remounts tiles on changes anyway).
  const useTileDnd = onDropSpace
    ? (spaceId: string) => {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const [over, setOver] = useState(false);
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const ref = useReorderableSpace(
          spaceId,
          (draggedId) => onDropSpace(draggedId, spaceId),
          setOver,
        );
        return { ref, over };
      }
    : undefined;

  return (
    <SpacesRail
      spaces={railSpaces}
      activeId={activeId}
      onSelect={onSelect}
      onAdd={onAdd}
      onSelectDms={onSelectDms}
      dmsActive={dmsActive}
      dmUnread={dmUnread}
      dmLabel={DM_HOME_NAME}
      showLockCorner
      renderIcon={(name, size, color) => (
        <Icon name={RAIL_ICON[name]} size={size} color={color} />
      )}
      renderTileImage={(space) => (
        // Only called when space.image is set (SpacesRail guarantees this).
        <Image
          source={{ uri: space.image! }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          accessibilityLabel={space.short}
        />
      )}
      renderBadge={(count) => <Badge count={count} />}
      useTileDnd={useTileDnd}
      renderFoot={() => (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Accounts"
            onPress={() => setMenuOpen(true)}
            style={styles.foot}
          >
            <Avatar label={meLabel} image={meAvatar} size={32} ring={menuOpen} />
          </Pressable>
          <AccountSwitcherPopover
            visible={menuOpen}
            onClose={() => setMenuOpen(false)}
            onViewProfile={onOpenProfile}
          />
        </>
      )}
    />
  );
}

const styles = StyleSheet.create({
  foot: { alignItems: 'center' },
});
