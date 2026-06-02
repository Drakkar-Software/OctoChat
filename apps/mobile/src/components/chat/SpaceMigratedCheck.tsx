import { useSpaceMigrated } from '@/lib/use-space-migrated';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';

interface SpaceMigratedCheckProps {
  spaceId: string;
}

/**
 * Trailing glyph for a space row that reports whether the space's legacy rooms
 * have migrated into the unified object index (see {@link useSpaceMigrated}):
 * a success check once seeded, a faint hollow circle while still on the legacy
 * fallback, and nothing while the index is still opening.
 */
export function SpaceMigratedCheck({ spaceId }: SpaceMigratedCheckProps) {
  const { colors } = useTheme();
  const state = useSpaceMigrated(spaceId);

  if (state === 'loading') return null;
  return state === 'migrated' ? (
    <Icon name="check-circle" size={15} color={colors.success} />
  ) : (
    <Icon name="circle" size={15} color={colors.inkFaint} />
  );
}
