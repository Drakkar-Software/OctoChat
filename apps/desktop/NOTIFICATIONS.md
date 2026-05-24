# Desktop notifications

How OctoChat desktop shows "new message" toasts, why the permission UX differs
per OS, and why **macOS may silently never prompt** (spoiler: the build is
ad-hoc signed).

## How it works

There is **no Electron-specific notification code**. The desktop app reuses the
same web code path as the browser build:

| Piece | File | Role |
| --- | --- | --- |
| Fire a toast | `apps/mobile/src/lib/notify.ts` | HTML5 `new Notification(...)` |
| Decide when | `apps/mobile/src/lib/unread-context.tsx` | SSE `subscribeRoomChanges` → `notifyNewMessage(roomId)` |
| Click → focus | `apps/mobile/src/lib/desktop.ts` → `preload.ts` `focusWindow` | IPC `octochat:focus-window` → `BrowserWindow.show()/focus()` |
| Dock/taskbar badge | `preload.ts` `setBadgeCount` → `main.ts` `octochat:set-badge` | `app.setBadgeCount(n)` |

Chromium inside Electron bridges the HTML5 `Notification` to a **native OS
toast** automatically — macOS Notification Center, Windows toast, Linux D-Bus.
So one renderer code path covers web *and* all three desktop OSes.

### When a toast actually fires

`notifyNewMessage` (notify.ts) is deliberately conservative. It posts **only**
when all of these hold:

1. `Notification` exists and `Notification.permission === 'granted'`.
2. The app window is **not focused** (`document.hasFocus()` is false) — never pop
   while you're looking at OctoChat; the unread badge covers that case.
3. An SSE room-change event arrived for a room you are **not** currently viewing
   (the active room pulls messages instead of bumping unread — unread-context.tsx).

Content is **generic** ("New message in another room"): chat is E2E-encrypted, so
the SSE event carries no text or author. Clicking the toast focuses the window and
routes to the room.

> **Testing implication:** if you test with the window focused, or with the room
> already open, **nothing fires** — by design. To trigger one: leave OctoChat in
> the background and send a message from another account/device into a room you
> don't have open.

## Permission model: two separate layers

A notification has to clear **two** gates. They are independent and people
conflate them.

### Layer 1 — the web permission (Electron renderer)

In a normal browser, `Notification.requestPermission()` shows the "Allow
notifications?" bubble. **In Electron it does not.** Electron's default permission
handler auto-grants notifications: `Notification.permission` reads `'granted'`
from the start and `requestPermission()` resolves `'granted'` immediately, with no
popup — on **all three** OSes.

So `ensureNotifyPermission()` (called once in unread-context.tsx) is effectively a
no-op inside Electron. The renderer always believes it may notify.

### Layer 2 — the OS permission (differs per OS)

This is the gate that actually decides whether a toast appears. Behavior is **not**
uniform:

| OS | Prompts the user? | Details |
| --- | --- | --- |
| **macOS** | **Yes — one-time system prompt** | First posted notification triggers the macOS authorization dialog; the app then lives in System Settings → Notifications. **Requires a validly signed app** — see below. Unpackaged dev (`electron .`) registers under the name **"Electron"**, not OctoChat. |
| **Windows** | **No prompt** | Toasts just appear; the user disables them later in Settings → Notifications. Requires an **AppUserModelID** (set in `main.ts`: `app.setAppUserModelId('software.drakkar.octochat')`) and a Start-Menu shortcut, which the nsis installer creates. |
| **Linux** | **No prompt** | Delivered over D-Bus `org.freedesktop.Notifications`. Shows if a notification daemon is running; there is no permission concept. |

**Net:** only macOS asks. Windows and Linux silently allow.

## Why macOS never prompts you (current builds)

macOS notification authorization (UNUserNotificationCenter) requires the app to be
signed with a **valid, stable identity**. Our current builds are **ad-hoc signed**
— verify with:

```bash
codesign -dv --verbose=4 "release/mac-arm64/OctoChat.app"
# CodeDirectory ... flags=0x10002(adhoc,runtime)
# Signature=adhoc
# TeamIdentifier=not set
```

`Signature=adhoc` + `TeamIdentifier=not set` means macOS **silently refuses** to
register the app with Notification Center: **no prompt, no toast, no error**.
Layer 1 still reports `'granted'`, so the app *thinks* it notified — the OS just
dropped it.

### Three things to clear, in order

1. **Code signing (the real blocker).** Sign with a **Developer ID Application**
   certificate (requires a paid Apple Developer account) and ideally notarize.
   Once signed with a real identity, the first toast triggers the macOS
   authorization prompt and the app appears in System Settings → Notifications.
   An ad-hoc signature cannot get there — there is no local workaround.

2. **Quarantine / App Translocation.** Even when signed, launching from the `.dmg`
   without clearing quarantine makes macOS run the app from a randomized read-only
   path (App Translocation), which breaks its notification identity. Move it to
   `/Applications` first, or clear the flag:
   ```bash
   xattr -dr com.apple.quarantine "apps/desktop/release/mac-arm64/OctoChat.app"
   ```

3. **A toast has to actually fire.** See "When a toast actually fires" above —
   background window + a message into a non-open room. Testing focused will never
   prompt regardless of signing.

> There is no cheap shortcut: a self-signed/local certificate does **not** satisfy
> macOS notification authorization. The Developer ID path is the only reliable fix.

## Quick triage

- **No macOS prompt ever:** expected on ad-hoc builds (this repo today). Needs
  Developer ID signing. Check `codesign -dv` for `Signature=adhoc`.
- **Signed but still nothing:** likely quarantined/translocated — move to
  `/Applications` or run the `xattr` command.
- **Windows: no toasts:** confirm the app was installed via the nsis installer
  (it creates the Start-Menu shortcut Windows requires) and that the AppUserModelID
  matches `appId` in `electron-builder.yml`.
- **Linux: no toasts:** confirm a notification daemon is running on the desktop.
- **Toast never appears on any OS:** check the firing conditions — window must be
  unfocused and the message must target a room you don't have open.

## Related files

- `apps/mobile/src/lib/notify.ts` — toast firing + permission helper.
- `apps/mobile/src/lib/unread-context.tsx` — SSE subscription that drives toasts and the badge.
- `apps/mobile/src/lib/desktop.ts` — `window.octochat` bridge accessors (focus, badge).
- `apps/desktop/src/preload.ts` — exposes `focusWindow` / `setBadgeCount` over IPC.
- `apps/desktop/src/main.ts` — IPC handlers, `setAppUserModelId`, `setBadgeCount`.
