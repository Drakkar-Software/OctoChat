import { useState } from 'react';

import { useStarfishData } from '@drakkar.software/starfish-client/zustand';

import { useSession } from '@/lib/session-context';
import {
  createStreamBotCredential,
  type StreamBotCredential,
} from '@drakkar.software/octochat-sdk';
import type { ConversationStore } from '@/lib/use-conversation-data';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { CopyField } from '@/components/ui/CopyField';

import { OwnerConfigPanel } from './OwnerConfigPanel';

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
    <OwnerConfigPanel
      title="Connect a bot"
      subtitle="Let an integration append to this stream with one signed request — no sync protocol."
    >
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
    </OwnerConfigPanel>
  );
}

/**
 * Same panel, gated to render ONLY while the room has no messages yet. Once the
 * first message arrives the panel disappears from the room view — an active
 * conversation shouldn't carry owner-only admin UI above it. Owners reach the
 * panel from the room's info button instead (it shows on the space screen when
 * navigated from a stream room).
 */
export function StreamBotPanelWhenEmpty({
  store,
  ownerId,
  spaceId,
  roomId,
}: {
  store: ConversationStore;
  ownerId: string;
  spaceId: string;
  roomId: string;
}) {
  const isEmpty = useStarfishData(store, (d) => {
    const msgs = (d as { messages?: unknown[] } | undefined)?.messages;
    return !msgs || msgs.length === 0;
  });
  if (!isEmpty) return null;
  return <StreamBotPanel ownerId={ownerId} spaceId={spaceId} roomId={roomId} />;
}
