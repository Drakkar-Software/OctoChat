/**
 * Capability registry — the set of feature keys a variant preset can enable or
 * disable. Pure data: no React, no platform deps.
 *
 * `channels` and `tickets` are "room-type capabilities" — the sidebar renders one
 * labelled section per enabled room-type capability, filtering rooms by their
 * `ObjectNode.type`. Empty sections render nothing (no chrome).
 */

/** All known capability keys. */
export type Capability = 'channels' | 'dms' | 'threads' | 'automations' | 'tickets';

export interface CapabilityMeta {
  label: string;
  description: string;
  /**
   * When set, this is a "room-type capability": the sidebar renders one labelled
   * section for rooms whose `ObjectNode.type === roomType`.
   */
  roomType?: string;
}

export const CAPABILITY_META: Record<Capability, CapabilityMeta> = {
  channels: {
    label: 'Channels',
    description: 'Team messaging channels',
    roomType: 'room',
  },
  dms: {
    label: 'Direct Messages',
    description: 'Private one-to-one conversations',
  },
  threads: {
    label: 'Threads',
    description: 'Threaded replies and discussions',
  },
  automations: {
    label: 'Automations',
    description: 'Scheduled and triggered room automations',
  },
  tickets: {
    label: 'Tickets',
    description: 'Support and task tracking tickets',
    roomType: 'ticket',
  },
};

/** The capabilities that map to a sidebar section (have a roomType). */
export const ROOM_TYPE_CAPABILITIES = (Object.entries(CAPABILITY_META) as [Capability, CapabilityMeta][])
  .filter(([, m]) => m.roomType != null)
  .map(([cap, m]) => ({ cap, roomType: m.roomType!, label: m.label }));
