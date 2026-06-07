/**
 * Runtime configuration for the OctoChat SDK — the Starfish sync server URL,
 * optional namespace, events-stream URL and public web origin.
 *
 * The SDK is headless and platform-agnostic, so it does NOT read environment
 * variables itself. The host app reads its own env (e.g. Expo `EXPO_PUBLIC_*`) and
 * calls {@link configureOctoChat} once at boot, before any sync/identity API runs.
 * Getters throw a clear error if called before configuration so a misconfigured
 * host fails fast rather than silently signing the wrong path.
 */
export interface OctoChatConfig {
  /** Starfish sync server base URL (e.g. `http://localhost:8787`). */
  syncBase: string;
  /** Bare namespace name; the SDK prepends `/v1/<namespace>` to signed paths.
   *  Unset for a root-mounted (local dev) server. */
  syncNamespace?: string;
  /** Override the live change-event SSE endpoint. Defaults to
   *  `${syncBase}${syncPrefix}/events`. */
  eventsUrl?: string;
  /** Public origin of the web app, used to build shareable invite links on
   *  platforms without `window.location` (native). Empty by default. */
  webBase?: string;
}

let cfg: OctoChatConfig | null = null;

/** Configure the SDK. Call once at app boot before any sync/identity API. */
export function configureOctoChat(config: OctoChatConfig): void {
  const ns = (config.syncNamespace ?? '').trim();
  if (ns !== '' && !/^[A-Za-z0-9_-]+$/.test(ns)) {
    throw new Error(`octochat-sdk: syncNamespace must be a bare name ([A-Za-z0-9_-]+), got "${ns}"`);
  }
  cfg = { ...config, syncNamespace: ns || undefined };
}

function req(): OctoChatConfig {
  if (!cfg) throw new Error('octochat-sdk: configureOctoChat() not called — wire it at app boot.');
  return cfg;
}

/** Starfish sync server base URL. */
export const getSyncBase = (): string => req().syncBase;
/** Bare namespace name (or `undefined` for a root-mounted server). */
export const getSyncNamespace = (): string | undefined => req().syncNamespace;
/** Namespaced path prefix (`/v1/<namespace>`, or `''` locally). */
export const getSyncPrefix = (): string => {
  const ns = req().syncNamespace;
  return ns ? `/v1/${ns}` : '';
};
/** Live change-event SSE endpoint. */
export const getEventsUrl = (): string => req().eventsUrl ?? `${getSyncBase()}${getSyncPrefix()}/events`;
/** Public web origin (right-trimmed of trailing slashes; `''` by default). */
export const getWebBase = (): string => (req().webBase ?? '').replace(/\/+$/, '');
