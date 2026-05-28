# OctoChat push notifications — FCM via Whistler (native, topic-addressed)

Step-by-step guide to add **Firebase Cloud Messaging** push to the native apps
(iOS + Android), delivered through the existing **Whistler** bridge in Infra —
exactly the path octobot already uses, generalized to per-space topics.

## Implementation status

The **code** is implemented and typechecks in both repos:

- **Infra bridge:** `apps/octochat/index.ts` exports BOTH transports —
  `createOctochatSseApp()` (live SSE) and `createOctochatFcmApp(app)` (FCM push) —
  registered in `src/index.ts`, where **octobot and octochat each initialize their
  own named firebase-admin app**
  (separate Firebase projects — `FIREBASE_SERVICE_ACCOUNT` vs
  `OCTOCHAT_FIREBASE_SERVICE_ACCOUNT`); `package.json` uses
  `@drakkar.software/whistlers@^0.6.0` (npm) and the Dockerfile is simplified to
  `npm ci` (no local source build); `bridge.env.j2` carries both service accounts.
  The OctoChat **local dev** launcher (`infra/whistlers-sse.mjs`) is on `^0.6.0` too.
- **OctoChat client:** `src/lib/push/{fcm.ts,fcm.native.ts,use-push.ts}` (new),
  wired via `registerBackgroundPushHandler()` in `src/app/_layout.tsx` and
  `usePush(session, spaceIds)` in `unread-context.tsx`; deps + `app.json` plugins added.

**Still manual (can't be automated here):** create the Firebase project + drop
`google-services.json` / `GoogleService-Info.plist` into `apps/mobile/` (Part A),
put the service-account JSON in the ansible vault as
`octochat_firebase_service_account` (Part B3), `eas credentials` for the iOS APNs
key, and an **EAS/dev build** (Parts C7 + D). Until those exist the app builds and
runs as before — push is simply inert.

## Decisions baked into this guide

These were chosen up front; the steps assume them.

- **Topic-addressed.** Each device subscribes to an FCM topic per space; the
  bridge publishes to that topic. ~Zero new server state (no token registry).
  Trade-off: **no membership gate** — anyone who learns a `spaceId` can subscribe
  via Firebase, and a removed member keeps receiving wake-pings until they
  uninstall/unsubscribe. Acceptable here only because payloads are content-free
  (below). If you later need revocation parity with the SSE proxy, switch to
  token-addressed (register device tokens with drakkar-sync, fan out
  `spaceId → members → tokens`). *(Re-examined: we chose not to add revocation
  parity — see "Why we don't gate FCM the way SSE does" below.)*
- **Native only (iOS + Android).** Web push is a separate stack (Firebase JS SDK
  + VAPID + service worker in `src/lib/pwa.ts`) and is out of scope here.
- **Generic notification text — non-negotiable (E2EE).** The push shows a fixed
  "New message in another room" banner + `{ spaceId, roomId }` data for routing.
  No message text, sender, or preview — the server can't read content (it's E2EE)
  and must not put it on the wire. *(Initially this was a silent/data-only push, but
  iOS throttles those and drops them for force-quit apps — see the iOS fix below;
  it's now a visible alert push with generic text. Decrypted content would need a
  Notification Service Extension — out of scope.)*
- **Not the Expo Push Service.** That routes through Expo's servers and bypasses
  Whistler. We send via Whistler's `FirebaseDestination` (firebase-admin → FCM
  HTTP v1), the chosen transport.
- **Topic subscription needs `@react-native-firebase/messaging`.**
  `expo-notifications` alone cannot subscribe a device to an FCM topic, so the
  client needs RN-Firebase + a **development/EAS build** (not Expo Go).

## Why we don't gate FCM the way SSE does

SSE has a server-side membership gate (`/v1/octochat/events` filters `?spaces=…`
by `spaces/{spaceId}/_rooms` membership on every connect). FCM topic subscribe
does NOT. A removed member who knows `<spaceId>` can subscribe to
`octochat-octochat-chat-changed-<spaceId>` via Firebase directly and keep
receiving wake-pings until they uninstall/unsubscribe.

We considered closing this gap and explicitly chose not to. The constraint set
(no token registry, no FCM tokens transiting the backend, client-driven
topic-subscribe only) leaves exactly one mechanical option: make the topic name
itself a member-only secret derived from the active room CEK, and rotate it
whenever the keyring rotates. That option was rejected because:

- It costs ~4-repo plumbing (a `deriveSecret` API in the keyring SDK, a meta
  side-channel through the queueing plugin, a `topicResolver` in Whistler's
  `FirebaseDestination`, and a new `kickMemberFromSpace` flow in OctoChat —
  the current client never calls `removeRecipient`/`rotateEpoch`, so today
  the keyring does not rotate on member removal either).
- It protects metadata only. Payloads are already content-free (E2EE — see
  below). A removed ex-member learns at most "space X changed" with no
  decryptable content.
- It still leaks in-flight pushes published before the rotation lands.

The accepted residual: **a removed member keeps getting generic wake-pings
until they unsubscribe or uninstall.** They decrypt nothing. If you ever need
true revocation, the only honest path is to switch to token-addressed delivery
(register device tokens with drakkar-sync, fan out `spaceId → members → tokens`)
— that requires accepting server-side token state, which we have explicitly
declined.

## How it fits what already exists

Today (SSE), an event flows:

```
drakkar-sync  ──NATS──▶  Whistler (octochat app, SSE)  ──▶  /v1/octochat/events proxy  ──▶  client
   publishes            subject: octochat.chat.changed.<spaceId>      (cap-cert auth +
                        group: drakkar-bridge                          per-space membership)
```

We add a **second destination on the same NATS subject** — no change to
drakkar-sync, no new SSE listener:

```
drakkar-sync  ──NATS──▶  Whistler (octochat-FCM app)  ──FCM topic──▶  device
   (unchanged)          subject: octochat.chat.changed.<spaceId>     octochat-octochat-chat-changed-<spaceId>
                        group: drakkar-bridge-fcm  ◀── MUST differ from the SSE group
                        → FirebaseDestination
```

> **Why a different NATS queue group is mandatory:** NATS core load-balances
> messages *within* a queue group and gives *each distinct group* a full copy. If
> the FCM subscription reused `drakkar-bridge` (the SSE group), NATS would split
> messages between the SSE and FCM subscribers — each would see only ~half. Use a
> distinct group (`drakkar-bridge-fcm`) so both get every event.

The destination topic string comes from Whistler's namespace transform
(`namespace` prefix + dot→hyphen-sanitized source subject), so for namespace
`octochat` and subject `octochat.chat.changed.<spaceId>` it is exactly:

```
octochat-octochat-chat-changed-<spaceId>
```

The client must `subscribeToTopic()` to that **identical** string. (Confirm your
`spaceId` charset is FCM-topic-safe: `[a-zA-Z0-9-_.~%]+`, no `/`. `sp-<hex>`-style
ids are fine.)

---

## Part A — Firebase project (console, ~10 min)

You need a Firebase project whose `google-services.json`/`GoogleService-Info.plist`
(client) and **service-account key** (Whistler) belong to the *same* project.

1. **Create a dedicated `octochat` project** at <https://console.firebase.google.com>
   — separate from octobot's, so the two products' topics and credentials stay
   isolated (the bridge gives each its own named admin app — see B2).
2. **Register the Android app**: project's package name (your `app.json`
   `android.package`). Download **`google-services.json`**. This file contains no
   secrets and is safe to commit.
3. **Register the iOS app**: your `app.json` `ios.bundleIdentifier`. Download
   **`GoogleService-Info.plist`**.
4. **iOS APNs key** (so FCM can relay to Apple): in Apple Developer, create an
   **APNs Auth Key (.p8)**; in Firebase → *Project settings → Cloud Messaging →
   Apple app configuration*, upload the `.p8` with its Key ID + Team ID. (FCM
   relays to APNs — Whistler never talks to APNs directly.)
5. **Service-account key for Whistler**: *Project settings → Service accounts →
   Generate new private key* → downloads a **secret JSON**. This is server-side
   only; it goes in the Infra ansible vault (Part B), never in the app and never
   committed.

---

## Part B — Infra / Whistler bridge (server)

All paths under `Infra/sync/bridge`. The bridge wrapper
(`src/index.ts`) already initializes one default firebase-admin app from
`FIREBASE_SERVICE_ACCOUNT` and registers octobot's `FirebaseDestination` on it.

### B0. Use the published Whistlers from npm

`Infra/sync/bridge/package.json` (and the OctoChat root `package.json`, used by the
local dev launcher `infra/whistlers-sse.mjs`) both depend on the **npm release** —
no `file:` links:

```jsonc
"@drakkar.software/whistlers": "^0.6.0"
```

`0.6.0` (current `latest`) adds `NamespaceRoutingDestination` (one Firebase project
per namespace) and keeps `FirebaseDestination`'s `app` + `format` options used
below. Note: the bridge starts **one Whistler per app** (`bridge.ts`), so each app
already has its own destination — separate Firebase projects come from giving each
its own *named* admin app (B2), not from `NamespaceRoutingDestination` (that's for a
single destination fanning out multiple namespaces, e.g. the bundled `bin/server`).
After changing the version, run `npm install` (bridge) / `pnpm install` (root) so
the lockfiles match before building the image.

### B1. Add the FCM factory to `src/apps/octochat/index.ts`

`apps/octochat/index.ts` holds both octochat transports — the existing
`createOctochatSseApp()` (SSE) and this `createOctochatFcmApp(app)` (FCM):

```ts
import { FirebaseDestination } from "@drakkar.software/whistlers"
import type { App } from "firebase-admin/app"
import type { AppDefinition } from "../base.js"

/**
 * OctoChat FCM relay. Same NATS subject as the SSE app, but a DISTINCT queue
 * group so NATS delivers every event to both. Per-space FCM topics come from the
 * `octochat` namespace transform: octochat-octochat-chat-changed-<spaceId>.
 * Sends a VISIBLE notification with GENERIC text (E2EE — no content on the wire),
 * shown by the OS even when the app is force-quit; `data` carries ids for routing.
 */
export function createOctochatFcmApp(app?: App): AppDefinition {
  return {
    name: "octochat-fcm",
    namespace: "octochat",
    // no ssePort — FCM is push-out, nothing listens.
    subscriptions: [
      {
        name: "chat",
        topics: ["octochat.chat.changed.>"],
        group: "drakkar-bridge-fcm", // <-- distinct from the SSE app's group
      },
    ],
    createDestination: () =>
      new FirebaseDestination({
        app, // octochat's OWN named Firebase app (its dedicated project) — passed in by index.ts
        format: (n) => {
          // rawPayload mirrors the SSE event body: { params: { spaceId, roomId }, ... }.
          // Forward BOTH ids so the client can reuse its SSE refetch path (keyed by roomId).
          const p = (n.rawPayload as { params?: { spaceId?: string; roomId?: string } })?.params ?? {}
          return {
            // VISIBLE generic notification (E2EE-safe) — OS shows it even force-quit.
            notification: { title: "OctoChat", body: "New message in another room" },
            data: { type: "chat.changed", spaceId: p.spaceId ?? "", roomId: p.roomId ?? "" },
            android: { priority: "high", notification: { channelId: "messages" } },
            apns: {
              headers: { "apns-push-type": "alert", "apns-priority": "10" },
              payload: { aps: { sound: "default" } },
            },
          }
        },
      }),
  }
}
```

### B2. Register it in `src/index.ts`

octobot and octochat each push from their **own Firebase project**. A small helper
initializes a dedicated *named* firebase-admin app per product (separate
service-account keys → separate named apps → no cross-project bleed) and returns
`null` (with a warning) when a key is absent/invalid, so one product's
misconfiguration disables only its push — never the other's or the SSE relay:

```ts
import { initializeApp, cert, type App } from "firebase-admin/app"

function namedFirebaseApp(name: string, serviceAccountJson: string | undefined): App | null {
  if (!serviceAccountJson || serviceAccountJson === "null") return null
  try {
    return initializeApp(
      { credential: cert(JSON.parse(serviceAccountJson) as Record<string, unknown>) },
      name,
    )
  } catch (err) {
    console.warn("[drakkar-bridge] %s Firebase not configured (%s) — its push disabled; SSE still runs.", name, (err as Error)?.message ?? err)
    return null
  }
}

const apps: AppDefinition[] = [createOctochatSseApp()] // SSE relay — no Firebase

const octobotApp = namedFirebaseApp("octobot", process.env["FIREBASE_SERVICE_ACCOUNT"])
if (octobotApp) apps.push(createOctobotApp(octobotApp))

const octochatApp = namedFirebaseApp("octochat", process.env["OCTOCHAT_FIREBASE_SERVICE_ACCOUNT"])
if (octochatApp) apps.push(createOctochatFcmApp(octochatApp))
```

> This drops the old `GOOGLE_APPLICATION_CREDENTIALS` (ADC) fallback for octobot —
> the deployed `bridge.env` always sets `FIREBASE_SERVICE_ACCOUNT`, and ADC was a
> dev-only path. `createOctobotApp` now also takes its `app` and passes it to
> `FirebaseDestination({ app })`.

### B3. Wire credentials through ansible

- Add to `Infra/sync/ansible/roles/stack/templates/bridge.env.j2`:
  ```
  OCTOCHAT_FIREBASE_SERVICE_ACCOUNT={{ octochat_firebase_service_account | to_json }}
  ```
  (Skip this if reusing octobot's project — the default `FIREBASE_SERVICE_ACCOUNT`
  already covers it.)
- Put the Part-A service-account JSON in the **ansible vault**
  (`group_vars/.../vault.yml`) as `octochat_firebase_service_account`, mirroring
  how octobot's `firebase_service_account` is stored.

### B4. What you do NOT need

- **No new port** — FCM is outbound; nothing listens (`ssePort` unset).
- **No nginx / CORS** — server→FCM is a backend egress call, not a browser
  request.
- **No drakkar-sync change** — it already publishes `octochat.chat.changed.<spaceId>`.

### B5. Build & deploy

Rebuild and publish the `drakkarsoftware/drakkar-bridge` image, then run the
sync-stack deploy so the new env var + image land. **Run the deploy yourself** —
I won't push outward-facing infra on your behalf. After deploy, the bridge log
should show the `octochat-fcm` app subscribing on group `drakkar-bridge-fcm`.

---

## Part C — Expo client (`apps/mobile`, native)

Follows the project rule "logic in `src/lib`": all push logic lives in
`src/lib/push/`, screens/hooks only consume it.

### C1. Install

```sh
pnpm --filter @octochat/mobile add @react-native-firebase/app @react-native-firebase/messaging
pnpm --filter @octochat/mobile add expo-dev-client expo-notifications expo-build-properties
```

### C2. Place the Firebase config files

Drop the Part-A files in `apps/mobile/` (e.g. `google-services.json`,
`GoogleService-Info.plist`). `google-services.json` is safe to commit;
`.plist` likewise contains no secret but treat per your preference.

### C3. `app.json`

> **Merge, don't replace.** OctoChat's `app.json` already defines `plugins`,
> `android`, `ios`, `expo-updates`/`runtimeVersion`, etc. Add these keys into the
> existing objects — append to the `plugins` array and merge the `android`/`ios`
> keys; don't paste over the file.

```jsonc
{
  "expo": {
    "android": { "googleServicesFile": "./google-services.json" },
    "ios": {
      "googleServicesFile": "./GoogleService-Info.plist",
      "infoPlist": { "UIBackgroundModes": ["remote-notification"] }
    },
    "plugins": [
      "@react-native-firebase/app",
      "@react-native-firebase/messaging",
      ["expo-build-properties", { "ios": { "useFrameworks": "static" } }],
      "expo-notifications"
    ]
  }
}
```

> Verified against the installed **`@react-native-firebase/app`/`messaging` v24**:
> both plugins are `ConfigPlugin<void>` — **bare strings, no options object**
> (older guides pass `{ ios: { forceStaticLinking: true } }`; that's not the v24
> shape). The iOS static-framework requirement is satisfied by
> `expo-build-properties` `ios.useFrameworks: "static"`. The `@react-native-firebase/app`
> plugin reads the `android.googleServicesFile` / `ios.googleServicesFile` paths
> and embeds those files at prebuild.
>
> **iOS push entitlement** (`aps-environment`): you don't hand-edit it — EAS
> auto-syncs it once iOS push credentials exist. Run `eas credentials` (iOS →
> Push Key) once to attach an APNs key to the build.

### C4. `src/lib/push/fcm.native.ts`

```ts
import messaging from "@react-native-firebase/messaging"

const topic = (spaceId: string) => `octochat-octochat-chat-changed-${spaceId}`

export async function ensurePushPermission(): Promise<boolean> {
  const status = await messaging().requestPermission()
  return (
    status === messaging.AuthorizationStatus.AUTHORIZED ||
    status === messaging.AuthorizationStatus.PROVISIONAL
  )
}

export const subscribeSpace = (spaceId: string) =>
  messaging().subscribeToTopic(topic(spaceId))
export const unsubscribeSpace = (spaceId: string) =>
  messaging().unsubscribeFromTopic(topic(spaceId))
```

Add a no-op `src/lib/push/fcm.ts` (web fallback) exporting the same names as
async no-ops, so the universal/web build doesn't pull in RN-Firebase. (Metro
resolves `.native.ts` on iOS/Android, `.ts` on web.)

### C5. Subscribe per space membership

A small hook diffs the current space list against subscriptions:

```ts
// src/lib/push/use-push-subscriptions.ts — consume from a top-level provider
export function usePushSubscriptions(spaceIds: string[]) {
  const prev = useRef<Set<string>>(new Set())
  useEffect(() => {
    let active = true
    ;(async () => {
      if (!(await ensurePushPermission()) || !active) return
      const next = new Set(spaceIds)
      for (const id of next) if (!prev.current.has(id)) await subscribeSpace(id)
      for (const id of prev.current) if (!next.has(id)) await unsubscribeSpace(id)
      prev.current = next
    })()
    return () => { active = false }
  }, [spaceIds.join(",")])
}
```

Feed it your existing spaces selector (`useSpaces`). On lock/sign-out,
unsubscribe all (loop `unsubscribeSpace`).

### C6. Receive, display & route

The bridge sends a **visible notification** (generic text) + `data`, so the **OS
displays the banner itself** when the app is backgrounded/quit — the app doesn't
build it. The client only handles three things (all in `fcm.native.ts`):

- **Foreground** (`messaging().onMessage`): the OS does *not* auto-display, so just
  refresh in place — `usePush` calls `dispatchRoomChange(roomId)` from
  `room-events-bus.ts`, the same function `UnreadProvider` invokes on every SSE
  event (pulls the open room; the unread badge covers the rest). No banner — the
  user is already in the app.
- **Tap** (`messaging().onNotificationOpenedApp` + `getInitialNotification` for cold
  start): route to the room via the `data.roomId`.
- **Android channel + permission**: create the `"messages"` channel (matching the
  bridge's `android.notification.channelId`) and request Android-13
  `POST_NOTIFICATIONS`.

The **background handler** is still registered at module scope (in
`src/app/_layout.tsx`) as a no-op — RN-Firebase wants it set, but it isn't invoked
for notification messages while backgrounded (the OS handles those).

### C7. Build (NOT Expo Go)

```sh
# local dev build
pnpm --filter @octochat/mobile exec expo run:ios    # or run:android
# or store/internal builds
eas build --profile development --platform all
```

---

## Part D — Verify

1. Install a dev build on a **physical device** (push doesn't work in simulators
   for real delivery; iOS needs a real device).
2. Sign in, open a space → confirm `subscribeToTopic` ran (no error).
3. From the Firebase console (*Messaging → New campaign → topic*) **or** an
   admin-SDK script, send a test to topic
   `octochat-octochat-chat-changed-<spaceId>` — confirm the device shows the banner.
4. End-to-end: post a message as another user → drakkar-sync publishes to NATS →
   bridge log shows the FCM send → device shows the notification; tapping opens the room.
5. Background **and force-quit** behavior: verify the banner shows in both states
   (the visible-push fix targets exactly the force-quit case).

---

## Known caveats (call these out before shipping)

- **No revocation (topic model) — decided, not a TODO.** A removed member
  keeps getting generic wake-pings until they unsubscribe or uninstall. They
  decrypt nothing (E2EE). See "Why we don't gate FCM the way SSE does" above
  for the rationale and the path we'd take (token-addressed) if that ever
  stops being acceptable.
- **Generic notification text (the iOS-fix trade-off).** Delivery is now a
  **visible alert** push (`apns-push-type: alert`, priority 10 / Android high), so
  iOS shows it reliably **even when force-quit** — but the body is generic ("New
  message in another room") because chat is E2EE and the server can't read content.
  To show the real sender/preview, add an iOS **Notification Service Extension**
  (`mutable-content: 1`) that fetches+decrypts and rewrites the banner — a native
  target beyond Expo config plugins; a follow-up, not v1.
- **Android force-stop.** A user who force-stops the app from Settings gets no
  delivery until they reopen it (OS policy); normal background/swipe is fine.
- **No revocation (topic model)** is restated above — removed members keep getting
  generic wake banners until they unsubscribe/uninstall.
- **Topic string must match exactly** between bridge and client, and `spaceId`
  must be FCM-topic-safe.
- **In-app unread badge can lag the push on native.** Unread counts are driven by
  the SSE stream (`unread-context`), which only runs while the app is foregrounded
  and has no replay. A push received while backgrounded shows the OS banner, but the
  unread count for that room isn't bumped until SSE redelivers or the user opens the
  room. (Pre-existing SSE behavior; the push doesn't change it.) Closing the gap
  would mean coupling push delivery into `unread-context` — deliberately out of scope.

## Sources

- [Expo push notifications setup](https://docs.expo.dev/push-notifications/push-notifications-setup/)
- [Expo — Obtain FCM V1 service account credentials](https://docs.expo.dev/push-notifications/fcm-credentials/)
- [Expo — Send notifications with FCM and APNs](https://docs.expo.dev/push-notifications/sending-notifications-custom/)
- [React Native Firebase — Cloud Messaging usage (subscribeToTopic, background handler)](https://rnfirebase.io/messaging/usage)
- [Expo — Using Firebase (config plugins, googleServicesFile)](https://docs.expo.dev/guides/using-firebase/)
