import type { Room } from '@drakkar.software/octochat-sdk';

import { formatLastRun } from '@/lib/automation-status';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { Txt } from '@/components/ui/Txt';

type Automation = NonNullable<Room['automation']>;

/** Status card for an automated room — last-run timestamp + latest error text
 *  when present. Reused in both the owner settings sheet and the read-only
 *  member detail sheet so error visibility is consistent for all room members. */
export function AutomationRunStatus({ auto }: { auto: Automation }) {
  return (
    <Card title="Status">
      <Txt variant="caption" tone="inkMuted">
        Last run: {formatLastRun(auto.lastRunAt)}
      </Txt>
      {auto.lastError ? (
        <Callout tone="danger" iconName="alert" title="Last error">
          {auto.lastError}
        </Callout>
      ) : null}
    </Card>
  );
}
