/**
 * Variant presets — build-time identity + runtime brand/feature flags.
 *
 * `EXPO_PUBLIC_VARIANT` selects the active preset at build time (and at
 * runtime for web). Falls back to 'octochat' for the default build.
 */
import type { Capability } from '@drakkar.software/octochat-sdk';

export type VariantId = 'octochat' | 'octodesk' | 'octopulse';

export interface VariantConfig {
  id: VariantId;
  // ── Native identity (read by app.config.js at build time) ────────────────
  name: string;
  slug: string;
  scheme: string;
  bundleId: string;
  linkHost: string;
  easProjectId: string;
  // ── Runtime brand ─────────────────────────────────────────────────────────
  /** App name shown in UI strings (lock prompt, passkey enrollment, etc.). */
  appName: string;
  /** The colored suffix in the Wordmark (e.g. "Chat", "Desk", "Pulse"). */
  wordmarkSuffix: string;
  /** Which palette token to use for the variant accent. */
  accentToken: 'accent' | 'accentDesk';
  // ── Capability preset ─────────────────────────────────────────────────────
  features: Capability[];
}

export const VARIANTS: Record<VariantId, VariantConfig> = {
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

const raw = process.env.EXPO_PUBLIC_VARIANT as VariantId | undefined;
export const ACTIVE_VARIANT: VariantId = raw != null && raw in VARIANTS ? raw : 'octochat';
export const activeVariant: VariantConfig = VARIANTS[ACTIVE_VARIANT];
