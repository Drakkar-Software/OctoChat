import { router } from 'expo-router';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Full-screen empty state shown when the user hasn't joined any space yet.
 * Mirrors OctoVault's `WorkNoSpaces` — the stack header (with the "Create a
 * space" placeholder switcher) still renders above this body.
 */
export function ChatNoSpaces() {
  return (
    <EmptyState
      hero
      iconName="globe"
      title="No spaces yet"
      subtitle="Join or create a space to start chatting with your team."
      action={
        <Button
          label="Create a space"
          variant="primary"
          iconName="plus"
          onPress={() => router.push('/join')}
        />
      }
    />
  );
}
