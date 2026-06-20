/**
 * Runtime configuration for the OctoChat SDK — delegates to the shared
 * `@drakkar.software/octospaces-sdk` config so every shared-spaces API uses the
 * same resolved base URL, namespace, and callbacks.
 *
 * The SDK is headless and platform-agnostic, so it does NOT read environment
 * variables itself. The host app reads its own env (e.g. Expo `EXPO_PUBLIC_*`) and
 * calls {@link configureOctoChat} once at boot, before any sync/identity API runs.
 */
import {
  type OctoSpacesConfig,
  configureOctoSpaces,
  getSyncBase as _getSyncBase,
  getSyncNamespace as _getSyncNamespace,
  getSyncPrefix as _getSyncPrefix,
  getSharedSpacesNamespace,
} from '@drakkar.software/octospaces-sdk';

/** OctoChat's config extends the shared spaces config directly — all sync, namespace,
 *  events-URL, and web-origin options are inherited from {@link OctoSpacesConfig}. */
export interface OctoChatConfig extends OctoSpacesConfig {
  /** Public web origin for building invite/share links (right-trim trailing slashes
   *  via `getWebBase`). octospaces dropped its unused `webBase` config field in 0.13.x
   *  ("consumers define their own"), so OctoChat owns it here. */
  webBase?: string;
}

export { getSharedSpacesNamespace };

// Locally-cached config for the OctoChat-specific getters below.
let _eventsUrl: string | undefined;
let _webBase = '';
let _onServerReachable: (() => void) | undefined;

/** Configure the SDK. Call once at app boot before any sync/identity API.
 *  Delegates to `configureOctoSpaces` from `@drakkar.software/octospaces-sdk`. */
export function configureOctoChat(config: OctoChatConfig): void {
  _eventsUrl = config.eventsUrl;
  _webBase = config.webBase ?? '';
  _onServerReachable = config.onServerReachable;
  configureOctoSpaces(config);
}

/** Starfish sync server base URL. */
export const getSyncBase = _getSyncBase;
/** Bare namespace name (or `undefined` for a root-mounted server). */
export const getSyncNamespace = _getSyncNamespace;
/** Namespaced path prefix (`/v1/<namespace>`, or `''` locally). */
export const getSyncPrefix = _getSyncPrefix;
/** Live change-event SSE endpoint (defaults to `${syncBase}${syncPrefix}/events`). */
export const getEventsUrl = (): string => _eventsUrl ?? `${_getSyncBase()}${_getSyncPrefix()}/events`;
/** Public web origin (right-trimmed of trailing slashes; `''` by default). */
export const getWebBase = (): string => _webBase;
/** Callback to invoke when a background Starfish revalidation succeeds. */
export const getOnServerReachable = (): (() => void) | undefined => _onServerReachable;
