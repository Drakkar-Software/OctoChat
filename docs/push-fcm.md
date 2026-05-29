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
            // Per-room grouping key (see "Notification grouping" below). On Android
            // `tag` COLLAPSES — a repeat in the same room replaces the prior banner
            // (one per room, latest wins). On iOS `thread-id` GROUPS — banners stack
            // under one per-room header in Notification Center. Both keyed by roomId
            // so a busy room never floods with identical generic banners.
            android: { priority: "high", notification: { channelId: "messages", tag: p.roomId ?? "" } },
            apns: {
              headers: { "apns-push-type": "alert", "apns-priority": "10" },
              // firebase-admin `aps.threadId` serializes to APNs `thread-id`.
              payload: { aps: { sound: "default", threadId: p.roomId ?? "" } },
            },
          }
        },
      }),
  }
}
```

> This formatter shows the base case (topic-addressed, generic banner). It also
> excludes the message author from their own push by switching to an FCM
> *condition* when the event carries an `identity` — see
> **"Author self-exclusion (sender skips their own push)"** below for the full
> formatter and the per-collection `includeIdentity` flag that feeds it.

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

## Author self-exclusion (sender skips their own push)

Goal: a user never gets a push for a message **they** wrote — on **any** of their
devices. Background banners are rendered by the OS, not our JS, so the client can't
suppress them after the fact; the exclusion has to happen **at send time** in the
bridge.

**Mechanism — a per-user topic + an FCM condition.** Each device also subscribes to
an account-scoped topic `octochat-user-<userId>` (alongside its per-space topics).
When the bridge knows who authored the write, it addresses the push to an FCM
**condition** instead of a plain topic:

```
'octochat-octochat-chat-changed-<spaceId>' in topics && !('octochat-user-<authorId>' in topics)
```

Only the author's own devices are subscribed to `octochat-user-<authorId>`, so the
negation drops exactly them while every other space member still receives it. FCM
conditions allow up to 5 topics; this uses 2.

**Where the author comes from (E2EE-safe).** The server already authenticates the
*writer* via their cap-cert — the same identity it uses for authorization and the
audit log — completely independent of the (encrypted) message body. It does **not**
read content. Starfish surfaces that identity to plugins as `WriteEvent.identity`,
and the queuing plugin forwards it into the NATS payload **only for collections that
opt in** (`includeIdentity` / `include_identity`, default off). So the bridge learns
*who* posted *where*, never *what*.

**Identity-match invariant (the one thing that can silently break it).** The string
the client subscribes with (`session.userId`) MUST equal the string the server
reports as the write identity (`auth.identity`). Both are
`sha256(edPub)[0:16]` as 32-char lowercase hex, and both are **account-level** — a
device cap resolves to its `issUserId` and a member cap to its `subUserId`, which for
a real user are the same account id across all their devices. That's why exclusion is
account-wide, not per-device. If those two strings ever diverge (different derivation,
casing, truncation), the feature **no-ops silently** — no error, the author just keeps
getting their own pushes. Guard it with the verify step below.

**Moving parts (all shipped):**

- **Starfish ≥ `3.0.0-alpha.13`** — `WriteEvent.identity` (threaded through the TS &
  Python servers at every push site) + the queuing plugin's per-collection
  `includeIdentity` / `include_identity` flag (publishes `QueueMessage.identity`).
- **Whistlers ≥ `0.7.0`** — `FirebaseDestination`'s `format` may return a non-empty
  `condition`, which is sent **instead of** `topic` (FCM accepts one or the other);
  an absent/empty `condition` falls back to the normal topic send.
- **Server (both impls)** — OctoChat `apps/server/src/index.ts` and Infra
  `drakkar_sync/server.py` set `includeIdentity: true` / `include_identity=True` on the
  `chat` / `streamchat` / `pubstream` / `pubspace` QueueConfigs, so a write emits
  `octochat.chat.changed.<spaceId>` with `identity` in the body.
- **Infra bridge** (`bridge/src/apps/octochat/format.ts`) — builds the condition when
  `identity` is present, guarded to the userId charset so it can't inject:

  ```ts
  const id = (n.rawPayload as { identity?: string }).identity
  const authorId = typeof id === "string" && /^[0-9a-f]{32}$/.test(id) ? id : undefined
  return {
    notification: { title: "OctoChat", body: "New message in another room" },
    data: { /* …spaceId, roomId, docId… */ },
    ...(authorId
      ? { condition: `'${n.topic}' in topics && !('octochat-user-${authorId}' in topics)` }
      : {}), // no/invalid identity → plain topic send
    // …android / apns…
  }
  ```

- **Client** (`fcm.native.ts`) — `pushTopicForUser(userId)` +
  `subscribeUserPush` / `unsubscribeUserPush`; `use-push.ts` subscribes
  `octochat-user-<session.userId>` in its reconcile effect (and drops it on
  sign-out / toggle-off, tracked in a `subscribedUser` ref). Web is a no-op stub.

**Degradation / deploy order.** Whenever `identity` is absent or malformed — an old
payload, a collection that didn't opt in, an audience-cap/bot writer, or a device on
an app build that predates the user-topic subscription — the bridge emits **no
condition**, and `FirebaseDestination` falls back to a plain topic send (exactly
today's behavior). So the four parts can ship in any order with no flag day; the
exclusion simply activates once both ends are deployed and the device has
re-subscribed.

**Privacy note.** Forwarding the author's userId means the NATS/bridge layer now sees
"user X posted to space Y at time T" — **metadata only**, content stays E2EE. It is
gated per-collection (`includeIdentity` off by default) precisely so this exposure is
an explicit opt-in, not a default.

**Verify.** With a real device + two accounts: account A posts in a shared space → A's
device(s) show **no** banner, B's device does; B posts → A is notified, B is not.
Locally (no Firebase needed) you can assert the NATS payload now carries
`identity: "<32-hex>"` and that it equals the sender's `session.userId` (the
silent-failure check), and unit-test the bridge condition builder (see
`bridge/src/apps/octochat/format.test.ts`).

## Notification grouping (per room)

Goal: when several messages land in the **same room**, don't show N identical
generic banners — group/collapse them under that room. The grouping key is
**`roomId`** (each room is its own group). *Alternative:* key on `spaceId` to
stack a whole space's rooms together — but iOS `thread-id` is single-level, so
it's one or the other; we chose per-room.

### Phase 1 — shipped, server-only + a one-line web polish

No native rebuild. The behaviour is **not uniform across platforms** — say so
plainly:

| Platform | Mechanism | Behaviour | Where |
| --- | --- | --- | --- |
| **iOS** | `aps.thread-id = roomId` | **True grouping** — banners stack under one per-room header in Notification Center; all preserved. | bridge formatter (B1) |
| **Android** | `android.notification.tag = roomId` | **Collapse/replace** — a repeat in the same room *replaces* the prior banner; you see one per room (latest wins), earlier ones are gone. | bridge formatter (B1) |
| **Web / desktop** | `tag` (already set) + `renotify` | **Collapse/replace** — same as Android; `renotify: true` re-alerts when a replacement lands. | `src/lib/notify.ts` |

- The bridge change is the `tag` + `threadId` additions in the **B1 formatter**
  above. It lives in **Infra** (`apps/octochat/index.ts`) — the diff there is
  documented but **not applied/verified from this repo**; apply + deploy on the
  Infra side (re-deploy the bridge image, Part B5).
- The OctoChat client change is **done**: `notify.ts` adds `renotify: true`
  (web was already collapsing via the per-room `tag`).
- `notificationCount` is intentionally **omitted** — the server can't know
  per-device unread, so a server-set count would be wrong. A real count needs
  client-built notifications (Phase 2).
- **Old clients are unaffected** — `tag`/`thread-id` are ignored by clients that
  don't expect them, so the bridge change is deploy-order-safe.

### Phase 2 / 3 — REAL decrypted content via the two-message "placeholder + upgrade" hybrid

**Implemented across all three repos.** A single FCM message can't do this on Android:
a `notification`-block message is OS-displayed and the data background handler is
*never* invoked when backgrounded; a pure data-only message can run JS but shows
*nothing* if the headless task can't run (Doze quota / OEM killer / force-quit). The
fix is **two messages per event**, both addressed to the same topic/condition:

1. **Placeholder** — a `notification`-block message the OS shows immediately, even
   force-quit (generic, E2EE-safe), tagged per room (`android.notification.tag = roomId`,
   `apns thread-id = roomId` for grouping). This is the **reliability floor**.
2. **Upgrade** — a `data`-only `priority:high` message → Android hands it to the
   headless JS task, which decrypts the latest message and **replaces** the placeholder
   with "Sender: text". On iOS the upgrade is a no-op (no `apns`); iOS keeps the
   placeholder (real content there is deferred — see below).

This is delivered by **Whistlers ≥0.8.0** (`format` may return an array of messages →
`sendEach`); the Infra formatter `apps/octochat/format.ts` returns `[placeholder, upgrade]`.

**Why this is strictly better than single-data-only:** if the headless handler can't
run, or notifee can't render, or decrypt fails — the placeholder simply stays. Failures
degrade to the **generic banner, never to silence.** It also removes the deploy-order
hazard: the bridge always sends the placeholder, so old clients (no notifee handler)
still get the generic banner and just ignore the data-only upgrade.

**Client (`src/lib/push/background-notify.native.ts`).** The handler does NOTHING unless
it can show real content — otherwise it would double the placeholder:
- gated on `enabled` + `preview` (default OFF) read via `await loadNotificationSettings(userId)`
  (the synchronous snapshot is never hydrated in a headless task);
- rebuilds the session (`sessionFromPersisted`, cached-`derived` fast path, no Argon2id),
  `await hydrateMemberCaps(userId, {})` (joined private-space caps from the kv cache, no
  network) **and** `await hydratePubspaceCaps(userId)` (joined public-space link caps),
  then `loadLatestMessagePreview` (the same read as the web toast);
- **public spaces are covered too** — `loadLatestMessagePreview` routes `psp-` rooms to a
  plaintext path (`pubspace` merge-doc → `pubstream` log, no decrypt, cap-authorized) and
  reuses the same "Sender: text" formatting. So Android patches BOTH private (E2EE) and
  public (plaintext) room pushes with real content;
- on success: **cancel-then-replace** — `getDisplayedNotifications()` → cancel the entry
  whose `android.tag === roomId` (the FCM placeholder; FCM's int id isn't predictable, so
  match by tag), then `displayNotification({ title, id: roomId, groupId: spaceId, … })`;
- **title shows the space + room** — `loadNotificationLabels` reads the plaintext `_rooms`
  registry (private via the account cap, public via the link cap) and `notificationTitle`
  formats it as `"Space › #room"` (matching the in-app `#channel` convention; bare name for
  a DM). Best-effort and orthogonal to `preview` — names are plaintext metadata, not message
  content — so a failed/slow lookup degrades to the bare `"OctoChat"` title and never gates
  the preview body. The web/desktop toast (`notify.ts`) shows the same `"Space › #room"`
  title, resolved from the already-loaded rooms-registry cache (`nav.ensure`, no extra pull);
- on any miss (signed out / preview off / decrypt fails / exception): return and leave the
  placeholder standing.

notifee dep + the two-message display ⇒ `app.json` `version` bump (1.2.0) to fence OTAs and
a fresh dev/EAS build (not Expo Go). Tap routing: placeholder taps → RN-Firebase
`onPushOpenNavigate`; replacement taps → notifee `onNotifeeOpenNavigate`; both feed
`openRoomFromNotification` and are subscribed together in `use-push.ts`.

**Bridge formatter (Infra `apps/octochat/format.ts` — DONE, committed master 3892110):**
returns the two-message array; see that file. Both messages carry identical routing `data`
and the same self-exclusion `condition`; the placeholder carries the per-room
`tag`/`thread-id` grouping; the upgrade is data-only `android:{priority:"high"}`.

> **Verify on a physical device (polish, not reliability — the placeholder is the floor):**
> 1. **Replacement** — does the upgrade actually cancel + replace the placeholder, or do two
>    banners briefly coexist? Hinges on `getDisplayedNotifications()` surfacing the FCM
>    placeholder's `android.tag`; if it doesn't, the placeholder lingers (double banner) —
>    acceptable degradation, but check it.
> 2. **Headless registration** — confirm `setBackgroundMessageHandler` fires in a force-quit
>    launch (registered at `_layout.tsx` module scope). If it doesn't, only the placeholder
>    shows (no upgrade) — still fine, but move registration to the JS entry to fix.
> 3. **`smallIcon`** — `ic_launcher` should resolve (may render as a white square; a
>    monochrome `ic_notification` is the polish). If `displayNotification` throws, the catch
>    leaves the placeholder — no silence.
> 4. **Ordering** — FCM doesn't guarantee placeholder-before-upgrade; in practice the OS
>    render beats the decrypt-driven upgrade.

Web/desktop have no OS-level bundled-stack API beyond `tag`, so this phase is
Android-only; iOS keeps the placeholder + Phase 1's `thread-id` grouping.

### iOS real-content — deferred (future work)

iOS reliable banner-rewrite needs a **Notification Service Extension**, a *separate
native process that does NOT host the Expo/RN runtime* (the silent-push-runs-JS path
is Apple-throttled and undelivered when force-quit — the very reason iOS is on
visible-alert). So iOS can't reuse the JS decrypt the way Android's headless task
does. Recommended future path: NSE hosting iOS's built-in **JavaScriptCore** running
a bundled subset of the existing JS decrypt (reject a native Swift re-port —
ML-KEM/Kyber isn't in CryptoKit and every Starfish alpha wire change forces a
byte-exact re-port). Binding prerequisites: App Group + shared keychain
(`keychainAccessGroup` + `kSecAttrAccessibleAfterFirstUnlock` + a launch-time vault
re-save migration); move the `preview` setting + joined-space member caps into the App
Group container (the NSE can't read AsyncStorage); a WebCrypto-`subtle` shim over
`@noble` (the SDK calls `subtle`, not `@noble` directly); an esbuild/rollup bundle
step; bridge `aps['mutable-content']=1` with the generic alert as the timeout
fallback; build only from the cached `derived` identity (no Argon2id — it blows the
~30s NSE budget). Until then iOS keeps the reliable generic banner; `preview` default
OFF means iOS users lose nothing visible out-of-the-box.

**Public spaces on iOS — also generic, by deliberate choice.** Android's headless task
patches *both* private and public rooms (see the client section above). iOS shows the
generic placeholder for *every* room — private **and** public. Public content is plaintext
and server-readable, so unlike private rooms it *could* be embedded directly in the iOS
placeholder by the bridge (no NSE needed), covering iOS public rooms. We are **not** doing
this for now: it would diverge public from private handling, push plaintext message content
onto the FCM wire and into bridge/FCM logs, and only the NSE path gives uniform real content
for the private rooms that are the majority case. So iOS public rooms intentionally stay
generic until the NSE lands. No code change is planned; this paragraph is the record of the
decision.

## Sources

- [Expo push notifications setup](https://docs.expo.dev/push-notifications/push-notifications-setup/)
- [Expo — Obtain FCM V1 service account credentials](https://docs.expo.dev/push-notifications/fcm-credentials/)
- [Expo — Send notifications with FCM and APNs](https://docs.expo.dev/push-notifications/sending-notifications-custom/)
- [React Native Firebase — Cloud Messaging usage (subscribeToTopic, background handler)](https://rnfirebase.io/messaging/usage)
- [Expo — Using Firebase (config plugins, googleServicesFile)](https://docs.expo.dev/guides/using-firebase/)
