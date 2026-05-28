# Deep links & universal / App Links

OctoChat opens from links three ways:

| Link form | Example | Works |
| --- | --- | --- |
| **Web URL** | `https://<domain>/join#<token>` | Web app (always) |
| **Custom scheme** | `octochat://join#<token>` | Native, once installed |
| **Universal / App Link** | `https://<domain>/join#<token>` | Native, opens the app directly (web fallback if not installed) |

Expo Router maps file routes to URLs automatically, so `octochat://rooms`,
`octochat://room/<id>`, `octochat://join`, `octochat://search` already resolve
in any standalone/dev build — `scheme: "octochat"` is set in `app.json`.

## What's already wired (no values needed)

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

So `octochat://join#<token>` auto-joins on native **today**. Universal / App Links
(the `https://` form opening the app) need the steps below.

## To activate universal / App Links

You must supply three values that can't be derived from the repo:

1. **`<DOMAIN>`** — the host that serves the web app and the association files
   (e.g. `app.octochat.example`). No scheme, no trailing slash.
2. **`<APPLE_TEAM_ID>`** — Apple Developer → Membership, or `eas credentials` → iOS.
3. **`<ANDROID_SHA256>`** — the signing cert SHA-256, via
   `eas credentials` → Android. List **every** keystore you want verified
   (EAS dev/preview and Play App Signing can differ).

### 1. `app.json` — native association

Add to `expo.ios`:

```json
"associatedDomains": ["applinks:<DOMAIN>"]
```

Add to `expo.android` (alongside `package`):

```json
"intentFilters": [
  {
    "action": "VIEW",
    "autoVerify": true,
    "data": [{ "scheme": "https", "host": "<DOMAIN>", "pathPrefix": "/join" }],
    "category": ["BROWSABLE", "DEFAULT"]
  }
]
```

> `autoVerify: true` is what makes Android open the app instead of the browser;
> it requires the `assetlinks.json` below to be served and to match the build's
> signing cert. A rebuild is required after editing `app.json`.
>
> Scope is deliberately **`/join` only** (the one link the app generates — see
> `encodePublicInviteLink`). The Android `pathPrefix` is essential: without it,
> `autoVerify` claims the *entire* host and every `https://<DOMAIN>/…` link — the
> web app included — would open the native app on Android. Only widen the AASA
> `paths` / Android `pathPrefix` when you actually ship `/room|/space|/thread`
> link-sharing **and** make those screens robust to missing params + membership.

### 2. Host the association files on `<DOMAIN>`

Both must be served over **HTTPS**, no redirects.

**`https://<DOMAIN>/.well-known/apple-app-site-association`** — no extension,
`Content-Type: application/json`:

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

**`https://<DOMAIN>/.well-known/assetlinks.json`** — `Content-Type: application/json`:

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
`web.output: "single"`). **If `<DOMAIN>` is the OctoChat web app**, drop the two
files into `apps/mobile/public/.well-known/` so they ship with the web export —
confirm the host serves the extension-less AASA as `application/json` and does
not rewrite `/.well-known/*` into the SPA. Otherwise host them via Infra.

> Do not commit a placeholder AASA to a live `.well-known/` path: Apple's CDN
> caches it, and Android verifies App Links at install. Fill the real values first.

### 3. Set `EXPO_PUBLIC_WEB_URL`

So native-built invite links use the domain (else they're host-less `/join#…`):

```
EXPO_PUBLIC_WEB_URL=https://<DOMAIN>
```

Set it wherever the app's `EXPO_PUBLIC_*` vars are configured (EAS build env / web
deploy env), the same place as `EXPO_PUBLIC_STARFISH_URL`.

## Testing

**Custom scheme (works now, no build config):**

```sh
npx uri-scheme open 'octochat://join#<token>' --ios
npx uri-scheme open 'octochat://room/<roomId>' --android
# Expo Go uses exp:// — prefix the path with /--/:
npx uri-scheme open 'exp://127.0.0.1:8081/--/join' --ios
```

**Universal / App Links** can't be verified locally — they need:
- the AASA + `assetlinks.json` actually served on `<DOMAIN>` (validate the AASA at
  the Apple App Search API / a validator; check Android with
  `adb shell pm get-app-links com.drakkarsoftware.octochat`), **and**
- a **signed device build** (Apple CDN-caches the AASA; Android verifies at install).

Tapping a `https://<DOMAIN>/join#<token>` link in Messages/Notes (iOS) or via
`adb shell am start -a android.intent.action.VIEW -d 'https://<DOMAIN>/join#<token>'`
(Android) should open the app and auto-join.
