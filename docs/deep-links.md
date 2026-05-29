# Deep links & universal / App Links

Domain: **`oc.drakkar.software`** (serves the OctoChat web app and the link
association files).

OctoChat opens from links three ways:

| Link form | Example | Works |
| --- | --- | --- |
| **Web URL** | `https://oc.drakkar.software/join#<token>` | Web app (always) |
| **Custom scheme** | `octochat://join#<token>` | Native, once installed |
| **Universal / App Link** | `https://oc.drakkar.software/join#<token>` | Native, opens the app directly (web fallback if not installed) |

Expo Router maps file routes to URLs automatically, so `octochat://rooms`,
`octochat://room/<id>`, `octochat://join`, `octochat://search` already resolve
in any standalone/dev build — `scheme: "octochat"` is set in `app.json`.

## Done in the repo

- **`scheme: "octochat"`** in `app.json` → custom-scheme deep links route via
  Expo Router on native.
- **Invite-link handler** — `src/lib/use-invite-link.ts` (`useInviteFragment`)
  reads the credential `#fragment` from the launch URL on **web** (`location.hash`)
  and **native** (raw `Linking.getInitialURL()` + `url` event — the fragment is
  read from the raw URL, never through a parser, which would drop it).
  `src/app/join.tsx` consumes it and auto-joins the public space once per
  credential (cold start + warm resume).
- **`WEB_BASE`** (`src/lib/starfish/config.ts`, from `EXPO_PUBLIC_WEB_URL`) — the
  public origin used to build shareable invite links on native (web uses the live
  `window.location.origin`).
- **Native association config** in `app.json` — `ios.associatedDomains:
  ["applinks:oc.drakkar.software"]` and an Android `intentFilters` entry for
  `https://oc.drakkar.software/join*` with `autoVerify: true`.
- **`EXPO_PUBLIC_WEB_URL=https://oc.drakkar.software`** in all three `eas.json`
  build profiles, so native-built invite links emit the full `https://…/join#…`.

So `octochat://join#<token>` auto-joins on native **today**. The `https://` form
opening the app needs the two hosted files below — plus a rebuild (the `app.json`
native keys only take effect in a fresh build).

> Scope is deliberately **`/join` only** (the one link the app generates — see
> `encodePublicInviteLink`). The Android `pathPrefix: "/join"` is essential:
> without it `autoVerify` would claim the *entire* host and every
> `https://oc.drakkar.software/…` link — the web app included — would open the
> native app on Android. Only widen the AASA `paths` / Android `pathPrefix` when
> you actually ship `/room|/space|/thread` link-sharing **and** make those screens
> robust to missing params + membership.

## Remaining: host two association files on `oc.drakkar.software`

Both need two values not in the repo:

- **`<APPLE_TEAM_ID>`** — Apple Developer → Membership, or `eas credentials` → iOS.
- **`<ANDROID_SHA256>`** — signing-cert SHA-256, via `eas credentials` → Android.
  List **every** keystore to verify (EAS dev/preview and Play App Signing differ).

Serve both over **HTTPS**, no redirects.

**`https://oc.drakkar.software/.well-known/apple-app-site-association`** — no
extension, `Content-Type: application/json`:

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "<APPLE_TEAM_ID>.com.drakkarsoftware.octochat",
        "paths": ["/join", "/join/*"]
      }
    ]
  }
}
```

**`https://oc.drakkar.software/.well-known/assetlinks.json`** —
`Content-Type: application/json`:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.drakkarsoftware.octochat",
      "sha256_cert_fingerprints": ["<ANDROID_SHA256>"]
    }
  }
]
```

The OctoChat web app serves static files from `apps/mobile/public/` (Expo
`web.output: "single"`). Since `oc.drakkar.software` is the OctoChat web app, drop
the two files into `apps/mobile/public/.well-known/` so they ship with the web
export — **but only with the real values filled in**: confirm the host serves the
extension-less AASA as `application/json` and does not rewrite `/.well-known/*`
into the SPA. Otherwise host them via Infra.

> Do not commit a placeholder AASA to the live `.well-known/` path: Apple's CDN
> caches it and Android verifies App Links at install. Fill the real values first.

## Testing

**Custom scheme (works now, no build config):**

```sh
npx uri-scheme open 'octochat://join#<token>' --ios
npx uri-scheme open 'octochat://room/<roomId>' --android
# Expo Go uses exp:// — prefix the path with /--/:
npx uri-scheme open 'exp://127.0.0.1:8081/--/join' --ios
```

**Universal / App Links** can't be verified locally — they need:
- the AASA + `assetlinks.json` actually served on `oc.drakkar.software` (validate
  the AASA via a validator / the Apple App Search API; check Android with
  `adb shell pm get-app-links com.drakkarsoftware.octochat`), **and**
- a **signed device build** (Apple CDN-caches the AASA; Android verifies at install).

Tapping `https://oc.drakkar.software/join#<token>` in Messages/Notes (iOS) or via
`adb shell am start -a android.intent.action.VIEW -d 'https://oc.drakkar.software/join#<token>'`
(Android) should open the app and auto-join.
