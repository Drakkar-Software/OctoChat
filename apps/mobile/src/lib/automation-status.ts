import type { Room } from '@drakkar.software/octochat-sdk';

import type { Palette } from '@/lib/use-theme';

type Automation = NonNullable<Room['automation']>;

export type AutomationStatusKind = 'disabled' | 'failed' | 'onOpen' | 'commands' | 'scheduled';

/** The single status ladder for an automated room — disabled > failed > on-open >
 *  commands-only > scheduled cadence. Shared by every agent surface so the wording
 *  and colour stay in lockstep (was inlined identically in two components). */
export function automationStatusKind(a: Automation | undefined): AutomationStatusKind {
  if (!a?.enabled) return 'disabled';
  if (a.lastError) return 'failed';
  if (a.onOpen) return 'onOpen';
  if (a.intervalMin === 0) return 'commands';
  return 'scheduled';
}

export function automationStatusLabel(a: Automation | undefined): string {
  switch (automationStatusKind(a)) {
    case 'disabled':
      return 'Disabled';
    case 'failed':
      return 'Failed';
    case 'onOpen':
      return 'On open';
    case 'commands':
      return 'Commands-only';
    case 'scheduled':
      return `Every ${a!.intervalMin} min`;
  }
}

/** Status → palette token so a broken/disabled agent is scannable at a glance
 *  instead of identical to a healthy one. */
export function automationStatusColor(a: Automation | undefined, p: Palette): string {
  switch (automationStatusKind(a)) {
    case 'disabled':
      return p.inkFaint;
    case 'failed':
      return p.danger;
    case 'onOpen':
      return p.accent;
    case 'commands':
      return p.inkMuted;
    case 'scheduled':
      return p.success;
  }
}
