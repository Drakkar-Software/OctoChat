import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useUpdateCheck, type UpdateStatus } from '@/lib/use-update-check';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { Txt } from '@/components/ui/Txt';

/**
 * The APP section of the profile screen: the running version plus a manual
 * "check for updates". A found update downloads in the background and surfaces
 * the global update banner (with its Restart) at the top of the app; this card
 * only reports the result of the check.
 */
export function UpdateSettingsCard() {
  const { version, updatedAt, status, checking, pending, check } = useUpdateCheck();

  return (
    <Card title="APP">
      <View style={styles.action}>
        <View style={styles.head}>
          <View style={styles.info}>
            <Txt variant="callout" mono>
              {version}
            </Txt>
            {updatedAt ? (
              <Txt variant="micro" mono tone="inkMuted" numberOfLines={1}>
                Updated {updatedAt}
              </Txt>
            ) : null}
          </View>
          <Button
            label={checking ? 'Checking…' : 'Check for updates'}
            variant="secondary"
            size="md"
            iconName="refresh"
            loading={checking}
            disabled={checking}
            onPress={() => void check()}
          />
        </View>
        {/* A staged update (banner already up) always wins the note, so the card
            never reads "latest version" while the banner says "Update ready". */}
        <UpdateStatusNote status={pending ? 'downloaded' : status} />
      </View>
    </Card>
  );
}

/** The line under the button reporting the last check's outcome. */
function UpdateStatusNote({ status }: { status: UpdateStatus }) {
  switch (status) {
    case 'downloaded':
      return (
        <Callout tone="accent" iconName="chevron-up" title="Update ready">
          Downloaded — restart from the banner above to apply.
        </Callout>
      );
    case 'error':
      return (
        <Callout tone="danger" iconName="alert">
          Couldn&apos;t check for updates. Try again.
        </Callout>
      );
    case 'current':
      return (
        <Txt variant="micro" tone="inkMuted">
          You&apos;re on the latest version.
        </Txt>
      );
    case 'unavailable':
      return (
        <Txt variant="micro" tone="inkMuted">
          OctoChat keeps itself up to date.
        </Txt>
      );
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  action: { gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  info: { flex: 1, gap: 2 },
});
