import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { Alert } from 'react-native';
import { Menu, type OctoMenuAction } from '@octochat/ui';

import { tapFeedback } from '@/lib/haptics';
import { useQuickReactions } from '@/lib/quick-reactions-context';

interface MessageContextMenuProps {
  onReact?: (emoji: string) => void;
  onReply?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onPin?: () => void;
  pinned?: boolean;
  reactions?: Array<{ mine?: boolean; emoji: string }>;
  children: ReactNode;
}

/**
 * Native long-press context menu for a message — the on-device replacement for
 * the floating {@link MessageActions} toolbar (which stays the web affordance).
 * Reactions surface as an inline row of quick emojis; delete is destructive and
 * confirmed via a native alert. Used only on native (see {@link MessageGroup}).
 */
export function MessageContextMenu({ onReact, onReply, onEdit, onDelete, onPin, pinned, reactions, children }: MessageContextMenuProps) {
  const { emojis } = useQuickReactions();

  const actions = useMemo<OctoMenuAction[]>(() => {
    const mine = new Set((reactions ?? []).flatMap((r) => (r.mine ? [r.emoji] : [])));
    const out: OctoMenuAction[] = [];
    if (onReact) {
      out.push({
        label: 'React',
        sfSymbol: 'face.smiling',
        displayInline: true,
        subactions: emojis.map((emoji) => ({
          label: emoji,
          checked: mine.has(emoji),
          onPress: () => {
            tapFeedback();
            onReact(emoji);
          },
        })),
      });
    }
    if (onReply) out.push({ label: 'Reply in thread', sfSymbol: 'bubble.left', onPress: onReply });
    if (onPin) {
      out.push({
        label: pinned ? 'Unpin message' : 'Pin message',
        sfSymbol: pinned ? 'pin.slash' : 'pin',
        onPress: () => {
          tapFeedback();
          onPin();
        },
      });
    }
    if (onEdit) out.push({ label: 'Edit message', sfSymbol: 'pencil', onPress: onEdit });
    if (onDelete) {
      out.push({
        label: 'Delete message',
        sfSymbol: 'trash',
        destructive: true,
        onPress: () => {
          Alert.alert('Delete message?', 'This cannot be undone.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: onDelete },
          ]);
        },
      });
    }
    return out;
  }, [emojis, reactions, onReact, onReply, onPin, pinned, onEdit, onDelete]);

  return (
    <Menu actions={actions} longPress>
      {children}
    </Menu>
  );
}
