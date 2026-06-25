import type { DmEntry } from '@/lib/use-dms';
import { ActionSheet } from '@/components/ui/ActionSheet';

interface DmActionsSheetProps {
  visible: boolean;
  /** The DM entry being acted on (null when the sheet is closed). */
  dm: DmEntry | null;
  onArchive: (dm: DmEntry) => void;
  onUnarchive: (dm: DmEntry) => void;
  onClose: () => void;
}

/**
 * Bottom-sheet action menu for a single Direct Message conversation, opened via
 * long-press on a {@link DmList} row (or the web right-click equivalent). Currently
 * offers a single action: archive or unarchive. Built on {@link ActionSheet}.
 */
export function DmActionsSheet({ visible, dm, onArchive, onUnarchive, onClose }: DmActionsSheetProps) {
  if (!dm) return null;

  return (
    <ActionSheet
      visible={visible}
      onClose={onClose}
      title={dm.name}
      actions={[
        {
          label: dm.archived ? 'Unarchive conversation' : 'Archive conversation',
          iconName: 'archive',
          onPress: () => {
            if (dm.archived) {
              onUnarchive(dm);
            } else {
              onArchive(dm);
            }
          },
        },
      ]}
    />
  );
}
