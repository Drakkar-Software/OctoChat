import { useTheme } from '@/lib/use-theme';
import { useWebhooks } from '@/lib/use-webhooks';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { CopyField } from '@/components/ui/CopyField';
import { IconButton } from '@/components/ui/IconButton';
import { Row } from '@/components/ui/Row';

import { OwnerConfigPanel } from './OwnerConfigPanel';

const shortDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Owner-only panel for a PUBLIC room: SELF-SERVICE inbound webhooks. The owner mints
 * a webhook (a paste-able URL + a one-time token) that any external tool can POST to;
 * only the token's hash is stored (in the owner-written `_webhooks` registry), so the
 * server never holds the raw secret and the owner needs no operator. Complements
 * {@link StreamBotPanel} (the audience-cap bot link, for integrations that sign each
 * request) with the simpler "send a header" model dumb webhook senders expect.
 */
export function WebhookPanel({ ownerId, spaceId, roomId }: { ownerId: string; spaceId: string; roomId: string }) {
  const { colors } = useTheme();
  const { items, busy, error, reveal, create, remove, dismissReveal } = useWebhooks(ownerId, spaceId, roomId);

  return (
    <OwnerConfigPanel
      title="Incoming webhooks"
      subtitle={<>Let an external tool post here by POSTing {'{ "text": "…" }'} to a URL — no OctoChat account needed.</>}
    >
      {items.map((w) => (
        <Row
          key={w.id}
          iconName={w.sealed ? 'lock' : 'zap'}
          title={w.label}
          detail={`Added ${shortDate(w.createdAt)}`}
          right={
            <IconButton
              name="trash"
              size={18}
              color={colors.inkMuted}
              accessibilityLabel={`Revoke webhook ${w.label}`}
              onPress={() => void remove(w.id)}
            />
          }
        />
      ))}

      {reveal ? (
        <>
          <Callout tone="warning" iconName="alert">
            Copy these now — the token is shown once and can't be recovered. Treat it like a password.
          </Callout>
          <CopyField label="Webhook URL (POST)" value={reveal.url} lines={2} />
          <CopyField label={`Send header  ${reveal.header}`} value={reveal.token} lines={3} />
          <Button label="Done" variant="secondary" size="sm" onPress={dismissReveal} />
        </>
      ) : (
        <Button
          label="Create webhook"
          iconName="plus"
          variant="secondary"
          size="sm"
          loading={busy}
          onPress={() => void create(`Webhook ${shortDate(Date.now())}`)}
        />
      )}

      {error ? (
        <Callout tone="warning" iconName="alert">
          {error}
        </Callout>
      ) : null}
    </OwnerConfigPanel>
  );
}
