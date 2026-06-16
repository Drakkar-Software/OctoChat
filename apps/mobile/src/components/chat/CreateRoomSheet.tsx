import { useState } from 'react';
import { View } from 'react-native';

import { spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { TextField } from '@/components/ui/TextField';

interface CreateRoomSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The category to add the room to. */
  defaultCategory: string;
  /**
   * Called with name + category + isPublic on submit.
   * Returns null on success, or an error message string on failure.
   */
  onSubmit: (name: string, category: string, isPublic: boolean) => Promise<string | null>;
}

const VISIBILITY_SEGMENTS = [
  { key: 'private' as const, label: '🔒 Private' },
  { key: 'public' as const, label: '🌐 Public' },
];

/**
 * Shared bottom-sheet form for creating a room: channel name + Private/Public
 * toggle. Surfaces any error returned by `onSubmit` inline; closes on success.
 *
 * Used by {@link CreateRoomButton} (the header "+"), the empty-space "New
 * channel" CTA, and the per-category "+" in {@link RoomCategorySection}.
 */
export function CreateRoomSheet({ visible, onClose, defaultCategory, onSubmit }: CreateRoomSheetProps) {
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName('');
    setIsPublic(false);
    setError(null);
    setSubmitting(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    const n = name.trim();
    if (!n || submitting) return;
    setSubmitting(true);
    const result = await onSubmit(n, defaultCategory, isPublic);
    if (typeof result === 'string') {
      setError(result);
      setSubmitting(false);
    } else {
      handleClose();
    }
  };

  return (
    <BottomSheet visible={visible} onClose={handleClose} title="New channel">
      <View style={{ gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
        <SegmentedControl
          segments={VISIBILITY_SEGMENTS}
          selected={isPublic ? 'public' : 'private'}
          onSelect={(k) => setIsPublic(k === 'public')}
        />
        {isPublic ? (
          <Callout tone="warning" iconName="globe">
            Not end-to-end encrypted — messages are world-readable.
          </Callout>
        ) : null}
        <TextField
          leadingIcon="hash"
          value={name}
          onChangeText={setName}
          onSubmitEditing={handleSubmit}
          placeholder="new-channel"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          containerStyle={{ backgroundColor: colors.paper }}
        />
        {error ? (
          <Callout tone="warning" iconName="alert">
            {error}
          </Callout>
        ) : null}
        <Button
          label="Create channel"
          variant="primary"
          loading={submitting}
          onPress={handleSubmit}
        />
      </View>
    </BottomSheet>
  );
}
