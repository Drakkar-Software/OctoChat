// variants-config.js — CommonJS mirror of variants.ts for use in app.config.js
const VARIANTS = {
  octochat: {
    id: 'octochat',
    name: 'OctoChat',
    slug: 'octochat',
    scheme: 'octochat',
    bundleId: 'com.drakkarsoftware.octochat',
    linkHost: 'oc.drakkar.software',
    easProjectId: '458ea622-202d-484a-bed2-4ad0e63d2068',
    appName: 'OctoChat',
    wordmarkSuffix: 'Chat',
    accentToken: 'accent',
    features: ['channels', 'dms', 'threads', 'automations'],
  },
  octodesk: {
    id: 'octodesk',
    name: 'OctoDesk',
    slug: 'octodesk',
    scheme: 'octodesk',
    bundleId: 'com.drakkarsoftware.octodesk',
    linkHost: 'desk.drakkar.software',
    easProjectId: 'OCTODESK_EAS_PROJECT_ID',
    appName: 'OctoDesk',
    wordmarkSuffix: 'Desk',
    accentToken: 'accentDesk',
    features: ['tickets', 'automations', 'threads'],
  },
  octopulse: {
    id: 'octopulse',
    name: 'OctoPulse',
    slug: 'octopulse',
    scheme: 'octopulse',
    bundleId: 'com.drakkarsoftware.octopulse',
    linkHost: 'pulse.drakkar.software',
    easProjectId: 'OCTOPULSE_EAS_PROJECT_ID',
    appName: 'OctoPulse',
    wordmarkSuffix: 'Pulse',
    accentToken: 'accent',
    features: ['channels', 'dms', 'threads', 'automations', 'tickets'],
  },
};

const ACTIVE_VARIANT = 'octochat';

module.exports = { VARIANTS, ACTIVE_VARIANT };
