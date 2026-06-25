import type { Room } from '@drakkar.software/octochat-sdk';

import { ActionSheet } from '@/components/ui/ActionSheet';

interface MoveToCategorySheetProps {
  visible: boolean;
  /** The room being moved (null when closed). Its current category is excluded. */
  room: Room | null;
  /** All category names in the space. */
  categories: string[];
  onSelect: (category: string) => void;
  onClose: () => void;
}

/** Bottom-sheet picker that re-homes a channel to another category — the native
 *  equivalent of dragging the row onto a category header (also the web fallback if
 *  element drag is unavailable). Built on {@link ActionSheet}. */
export function MoveToCategorySheet({ visible, room, categories, onSelect, onClose }: MoveToCategorySheetProps) {
  const options = categories.filter((c) => c !== room?.category);

  return (
    <ActionSheet
      visible={visible}
      onClose={onClose}
      title={`Move ${room ? `#${room.name}` : 'channel'} to…`}
      emptyLabel="No other categories yet. Create one in space settings."
      actions={options.map((c) => ({
        label: c,
        iconName: 'folder' as const,
        onPress: () => onSelect(c),
      }))}
    />
  );
}
