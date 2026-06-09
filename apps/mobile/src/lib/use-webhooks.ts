import { useCallback, useEffect, useState } from 'react';

import {
  listWebhooks,
  createWebhook,
  removeWebhook,
  webhookUrl,
  type WebhookSummary,
} from '@drakkar.software/octochat-sdk';

import { SYNC_BASE } from '@/lib/octochat-config';
import { useSession } from '@/lib/session-context';

/** The one-time secret surfaced after creating a webhook (the token is unrecoverable). */
export interface WebhookReveal {
  url: string;
  token: string;
  header: string;
}

/**
 * Owner-side state for a room's self-service webhooks: lists the room's webhooks,
 * creates one (surfacing the token ONCE via {@link WebhookReveal}), and revokes one.
 * All data access goes through the SDK provisioning helpers (`src/lib` owns the logic;
 * the panel only renders it).
 */
export function useWebhooks(ownerId: string, spaceId: string, roomId: string) {
  const { session } = useSession();
  const client = session?.accountClient ?? null;

  const [items, setItems] = useState<WebhookSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<WebhookReveal | null>(null);

  const refresh = useCallback(async () => {
    if (!client) return;
    setError(null);
    try {
      const all = await listWebhooks(client, ownerId, spaceId);
      setItems(all.filter((w) => w.roomId === roomId));
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }, [client, ownerId, spaceId, roomId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (label: string) => {
      if (!client) return;
      setBusy(true);
      setError(null);
      try {
        const created = await createWebhook(client, ownerId, spaceId, { roomId, label: label.trim() || 'Webhook' });
        setReveal({ url: webhookUrl(SYNC_BASE, ownerId, spaceId, created.id), token: created.token, header: created.tokenHeader });
        await refresh();
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      } finally {
        setBusy(false);
      }
    },
    [client, ownerId, spaceId, roomId, refresh],
  );

  const remove = useCallback(
    async (webhookId: string) => {
      if (!client) return;
      setBusy(true);
      setError(null);
      try {
        await removeWebhook(client, ownerId, spaceId, webhookId);
        await refresh();
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      } finally {
        setBusy(false);
      }
    },
    [client, ownerId, spaceId, refresh],
  );

  const dismissReveal = useCallback(() => setReveal(null), []);

  return { items, busy, error, reveal, create, remove, dismissReveal };
}
