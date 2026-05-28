/**
 * Starfish sync server base URL.
 *
 * Web/dev defaults to the local server (see apps/server, port 8787). Override
 * with EXPO_PUBLIC_STARFISH_URL. Native LAN/emulator handling is refined in the
 * native runtime step.
 */
export const SYNC_BASE = process.env.EXPO_PUBLIC_STARFISH_URL ?? 'http://localhost:8787';

/**
 * Starfish namespace name. UNSET for the local dev server (apps/server mounts the
 * sync router at root, so paths are /pull, /push, /events). For the deployed
 * multi-tenant drakkar-sync, OctoChat is the `octochat` namespace, so set
 * EXPO_PUBLIC_STARFISH_NAMESPACE=octochat and EXPO_PUBLIC_STARFISH_URL=https://<host>/sync.
 *
 * The StarfishClient applies this via its `namespace` option, prepending
 * `/v1/<namespace>` to every request path — signed AND sent, including the paths
 * SDK helpers build (keyring, blobs). Pass the BARE name; the `/v1/` is supplied by
 * the SDK. Throws on a malformed value so a misconfigured deploy fails fast rather
 * than silently signing the wrong path.
 */
const _ns = process.env.EXPO_PUBLIC_STARFISH_NAMESPACE?.trim() ?? '';
if (_ns !== '' && !/^[A-Za-z0-9_-]+$/.test(_ns)) {
  throw new Error(`EXPO_PUBLIC_STARFISH_NAMESPACE must be a bare name ([A-Za-z0-9_-]+), got "${_ns}"`);
}
export const SYNC_NAMESPACE = _ns || undefined;

/**
 * Namespaced path prefix (`/v1/<namespace>`, or '' locally) for the `/events` SSE
 * endpoint, which is signed by a hand-rolled signer OUTSIDE the StarfishClient (see
 * EVENTS_URL + `buildAuthHeaders`) and so needs the literal prefix the client would
 * otherwise add itself. Derived from {@link SYNC_NAMESPACE}. nginx strips the /sync
 * mount, so the deployed server observes exactly /v1/octochat/events = the signed path.
 */
export const SYNC_PREFIX = SYNC_NAMESPACE ? `/v1/${SYNC_NAMESPACE}` : '';

/**
 * Live change-event SSE endpoint. Served by the authenticated /events proxy on the
 * OctoChat Starfish server (same host as SYNC_BASE) which validates the caller's
 * cap-cert identity and whitelists only their member spaces before proxying the
 * Whistler NATS→SSE stream. Override with EXPO_PUBLIC_EVENTS_URL.
 */
export const EVENTS_URL = process.env.EXPO_PUBLIC_EVENTS_URL ?? `${SYNC_BASE}${SYNC_PREFIX}/events`;

/**
 * Public origin of the OctoChat web app — the host that serves shareable invite
 * links and the universal-/App-Link association files. Set to the universal-links
 * domain, e.g. `https://app.octochat.example`.
 *
 * On web, runtime link-building uses `window.location.origin` (the live origin);
 * native has no `window`, so invite links fall back to this. Empty by default,
 * which yields a host-less `/join#…` link on native — set it so native-created
 * invites emit a full `https://<domain>/join#…` that opens the app (or the web
 * fallback). The matching native config lives in `app.json`
 * (`ios.associatedDomains` + Android `intentFilters`); see `docs/deep-links.md`.
 */
export const WEB_BASE = (process.env.EXPO_PUBLIC_WEB_URL ?? '').replace(/\/+$/, '');
