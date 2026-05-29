import { type IconName } from '@/components/ui/Icon';
import { ListRow } from '@/components/chat/ListRow';

interface SidebarLinkRowProps {
  iconName: IconName;
  label: string;
  active?: boolean;
  /** Optional unread count badge on the right. */
  unread?: number;
  /** Optional `@` mention marker (overrides `unread`). */
  mention?: boolean;
  onPress?: () => void;
}

/**
 * A destination row in the desktop room sidebar — used for non-room targets
 * (Threads, future Mentions/Drafts). A thin wrapper over the shared
 * {@link ListRow} so it reads as one cohesive list of destinations alongside
 * {@link ChannelRow}, regardless of whether a row points at a room or a view.
 */
export function SidebarLinkRow({ iconName, label, active = false, unread, mention, onPress }: SidebarLinkRowProps) {
  return (
    <ListRow
      iconName={iconName}
      label={label}
      active={active}
      unread={unread}
      mention={mention}
      onPress={onPress}
    />
  );
}
