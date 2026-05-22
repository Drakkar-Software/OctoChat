import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useStarfishData } from '@drakkar.software/starfish-client/zustand';

import { spacing } from '@/theme';
import { plural } from '@/lib/format';
import { useSession } from '@/lib/session-context';
import { createBroadcast, snapshotMessages, type SnapshotRow } from '@/lib/starfish/broadcast';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { CopyField } from '@/components/ui/CopyField';
import { Txt } from '@/components/ui/Txt';
import { QrCode } from '@/components/onboarding/QrCode';

/** The app's web origin for the link; empty on native (web-first viewer for now). */
function webOrigin(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.origin;
  return '';
}

interface ShareResult {
  link: string;
  write: boolean;
}

/**
 * Owner-side share creator. Reads the room's live (decrypted) messages from its
 * store, snapshots them into a plaintext share, mints a read-only or read/write
 * link, and shows it as a copyable token + QR. Mounted only when the room store is
 * ready (the page guards on it), so `useStarfishData` always has a store.
 */
export function BroadcastCreator({
  store,
  channelName,
}: {
  store: Parameters<typeof useStarfishData>[0];
  channelName: string;
}) {
  const { session } = useSession();
  const rows = (useStarfishData(store, (d) => d.messages as SnapshotRow[] | undefined) ?? []) as SnapshotRow[];
  const count = rows.filter((m) => !m.parentId).length;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ShareResult | null>(null);

  const create = async (write: boolean) => {
    if (!session || busy) return;
    setBusy(true);
    setError(null);
    try {
      const messages = await snapshotMessages(rows, session);
      const { link } = await createBroadcast(session, channelName, messages, { write, origin: webOrigin() });
      setResult({ link, write });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the share link.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Callout tone="warning" iconName="unlock" title="Not end-to-end encrypted">
        A share link publishes a plaintext copy of this channel — the server can read it, and anyone with the link
        can open it without an account. A read &amp; write link also lets anyone with the link post.
      </Callout>

      {result ? (
        <View style={styles.result}>
          <Txt variant="callout" weight="semibold" center>
            {result.write ? 'Read & write link' : 'Read-only link'} · {plural(count, 'message')} shared
          </Txt>
          <View style={styles.qr}>
            <QrCode value={result.link} size={200} />
          </View>
          <CopyField label="Share link" value={result.link} copyLabel="Copy link" lines={3} />
          <Button label="Create another link" variant="ghost" iconName="link" onPress={() => setResult(null)} />
        </View>
      ) : (
        <View style={styles.actions}>
          <Txt variant="footnote" tone="inkMuted">
            Snapshots the {plural(count, 'message')} currently in this channel into a shareable, plaintext copy.
          </Txt>
          <Button label="Create read-only link" variant="primary" full iconName="eye" disabled={busy} onPress={() => create(false)} />
          <Button
            label="Create read & write link"
            variant="secondary"
            full
            iconName="edit"
            disabled={busy}
            onPress={() => create(true)}
          />
        </View>
      )}

      {error ? (
        <Callout tone="danger" iconName="alert">
          {error}
        </Callout>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md, padding: spacing.screenX },
  actions: { gap: spacing.sm },
  result: { gap: spacing.md },
  qr: { alignItems: 'center', paddingVertical: spacing.sm },
});
