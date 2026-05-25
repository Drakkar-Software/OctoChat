import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useSession } from '@/lib/session-context';
import {
  createStreamBotCredential,
  type StreamBotCredential,
} from '@/lib/starfish/stream-bots';
import { useTheme } from '@/lib/use-theme';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { CopyField } from '@/components/ui/CopyField';
import { Txt } from '@/components/ui/Txt';

/** 30-day default TTL for a bot credential (time-boxed; the owner re-generates to rotate). */
const DEFAULT_TTL_SEC = 30 * 24 * 3600;

/**
 * Owner-only panel for a PUBLIC stream room: mints a bot write credential — a Starfish
 * `createPublicLink` audience cap (no embedded secret) — and shows the append endpoint.
 * A bot redeems the token with its OWN key (`redeemPublicLink`) and POSTs each event
 * with a single `client.append` — no pull/merge. Private (E2EE) stream rooms don't use
 * this: a bot there is invited as a keyring member instead (it must seal to post).
 */
export function StreamBotPanel({ ownerId, spaceId, roomId }: { ownerId: string; spaceId: string; roomId: string }) {
  const { colors } = useTheme();
  const { session } = useSession();
  const [cred, setCred] = useState<StreamBotCredential | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      setCred(await createStreamBotCredential(session, ownerId, spaceId, roomId, { ttlSec: DEFAULT_TTL_SEC }));
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.wrap, { borderColor: colors.lineSoft, backgroundColor: colors.paperAlt }]}>
      <View style={styles.head}>
        <Txt variant="footnote" weight="semibold">
          Connect a bot
        </Txt>
        <Txt variant="caption" tone="inkMuted">
          Let an integration append to this stream with one signed request — no sync protocol.
        </Txt>
      </View>
      {cred ? (
        <>
          <CopyField label="Bot link token" value={cred.token} lines={3} />
          <CopyField label="Append endpoint (POST)" value={cred.endpoint} lines={2} />
          <CopyField label="Path to sign" value={cred.signPath} lines={1} />
          <Callout tone="info" iconName="info">
            The bot redeems this token with its own key and appends events (see docs/stream-rooms.md).
            It carries no secret and expires in 30 days — generate again to rotate.
          </Callout>
        </>
      ) : (
        <Button label="Generate bot link" iconName="link" variant="secondary" size="sm" loading={busy} onPress={generate} />
      )}
      {error ? (
        <Callout tone="warning" iconName="alert">
          {error}
        </Callout>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
    margin: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radii.lg,
  },
  head: { gap: 2 },
});
