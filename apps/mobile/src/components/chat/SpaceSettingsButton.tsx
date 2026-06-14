import { router } from 'expo-router';

import { useSpaceHeader } from '@/lib/use-space-header';
import { IconButton } from '@/components/ui/IconButton';

/**
 * Context-wired gear button that opens the active space's settings screen.
 * Renders nothing when the DM home is selected (no space to configure).
 * Self-contained so the web tab header and the native nav bar both drop it
 * in with no prop wiring.
 */
export function SpaceSettingsButton() {
  const { space, isDmHome } = useSpaceHeader();
  if (isDmHome || !space) return null;
  return (
    <IconButton
      name="gear"
      size={18}
      accessibilityLabel="Space settings"
      onPress={() =>
        router.push({ pathname: '/space/[id]', params: { id: space.id, name: space.name } })
      }
    />
  );
}
