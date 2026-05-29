/**
 * Background push → REAL decrypted message content (Android, Phase 3).
 *
 * The bridge sends TWO messages per event (Infra `apps/octochat/format.ts`):
 *   1. a VISIBLE "placeholder" notification the OS shows even force-quit (generic,
 *      E2EE-safe), tagged per room (`android.notification.tag = roomId`); and
 *   2. this DATA-ONLY message, which Android hands to this headless JS task in the
 *      full Hermes/RN runtime (even backgrounded/force-quit).
 *
 * Job: when the `preview` setting is on, decrypt the room's latest message (reusing
 * the web/desktop `loadLatestMessagePreview`) and REPLACE the OS placeholder with a
 * notifee banner showing the real "Sender: text". When preview is off, decryption
 * fails, or we're signed out, do NOTHING — leave the placeholder standing. So the user
 * always sees at least the generic banner and we never post a duplicate.
 *
 * Decryption stays fully local — the bridge sends only ids, no content on the wire.
 * iOS does NOT use this path (its visible-alert banner is OS-rendered; real content
 * there needs a Notification Service Extension — see docs/push-fcm.md "iOS deferral").
 */
import notifee, { AndroidImportance } from '@notifee/react-native';

import { loadNotificationSettings } from '../notification-settings';
import { loadLatestMessagePreview } from '../notification-preview';
// Importing platform.native runs `install()` (globalThis.crypto) at module load;
// calling configureStarfishPlatform() wires the base64 provider the SDK needs. Both
// are required for decryption to work in this headless task (no provider tree ran).
import { configureStarfishPlatform } from '../starfish/platform';
import { hydrateMemberCaps } from '../starfish/member-caps';
import { spaceIdFromRoomId } from '../starfish/paths';
import { hydratePubspaceCaps } from '../starfish/pubspace-caps';
import { activeAccountOf, sessionFromPersisted } from '../starfish/session-restore';
import { loadVault } from '../starfish/storage';

import { MESSAGES_CHANNEL_ID } from './channel';
import type { PushData } from './fcm';

/** notifee data must be a string map; drop undefined ids. */
function pushDataToNotifee(data: PushData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['type', 'spaceId', 'roomId', 'docId'] as const) {
    const v = data[k];
    if (typeof v === 'string' && v) out[k] = v;
  }
  return out;
}

/**
 * Cancel the OS-displayed placeholder for this room. The bridge posts it via FCM with
 * `android.notification.tag = roomKey`; FCM's integer id isn't predictable, so we
 * enumerate the active notifications and cancel the one(s) carrying that tag. Our own
 * notifee replacement sets no `android.tag`, so it is never matched here. Best-effort:
 * a lingering placeholder is acceptable (never worse than today's generic banner) — and
 * if the placeholder hasn't been rendered yet (FCM doesn't guarantee ordering) there's
 * simply nothing to cancel.
 */
async function cancelPlaceholder(tag: string): Promise<void> {
  try {
    const displayed = await notifee.getDisplayedNotifications();
    await Promise.all(
      displayed
        .filter((d) => d.id && d.notification.android?.tag === tag)
        .map((d) => notifee.cancelDisplayedNotification(d.id as string, tag)),
    );
  } catch {
    /* best-effort — leave it to the OS if cancellation isn't available */
  }
}

/**
 * Replace the placeholder with the real decrypted content. `id = roomKey` so a later
 * upgrade in the same room replaces this one (latest wins); `groupId = spaceId` bundles
 * a space's rooms. Cancel the FCM placeholder first so the room shows a single banner.
 */
async function displayRealContent(
  body: string,
  roomKey: string,
  spaceId: string | undefined,
  data: PushData,
): Promise<void> {
  await notifee.createChannel({ id: MESSAGES_CHANNEL_ID, name: 'Messages', importance: AndroidImportance.HIGH });
  await cancelPlaceholder(roomKey);
  await notifee.displayNotification({
    id: roomKey,
    title: 'OctoChat',
    body,
    data: pushDataToNotifee(data),
    android: {
      channelId: MESSAGES_CHANNEL_ID,
      smallIcon: 'ic_launcher',
      pressAction: { id: 'default' },
      ...(spaceId ? { groupId: spaceId } : {}),
    },
  });
}

export async function handleBackgroundPush(data: PushData): Promise<void> {
  // Public-space rooms carry the id as `docId`; either is the room id.
  const roomId = data.roomId || data.docId || undefined;
  if (!roomId) return; // nothing to upgrade — leave the placeholder standing
  const spaceId = data.spaceId || spaceIdFromRoomId(roomId);
  try {
    configureStarfishPlatform();
    const load = await loadVault();
    const account = load.kind === 'ready' ? activeAccountOf(load.vault) : null;
    const userId = account?.derived?.userId;
    if (!account || !userId) return; // signed out → leave the placeholder

    // Read settings from kv directly — the synchronous snapshot is never hydrated in a
    // headless task (its provider effect doesn't run). Master off (no push should
    // arrive) or preview off → leave the OS placeholder; it already shows the generic
    // banner and posting ours would duplicate it.
    const settings = await loadNotificationSettings(userId);
    if (!settings.enabled || !settings.preview) return;

    const session = await sessionFromPersisted(account);
    // Joined-space caps live only in the kv cache in a cold task; reload them (empty
    // server caps leaves the local cache intact, no network) so a JOINED space can open
    // its keyring. Owned spaces don't need it. Likewise hydrate the JOINED public-space
    // link caps so a public room can authorize its plaintext pull (owned public spaces
    // use the account cap, no entry needed).
    await hydrateMemberCaps(userId, {});
    await hydratePubspaceCaps(userId);
    const preview = await loadLatestMessagePreview(session, roomId).catch(() => null);
    if (!preview) return; // couldn't decrypt → leave the generic placeholder

    await displayRealContent(preview, roomId, spaceId, data);
  } catch {
    // Leave the placeholder standing — never worse than the generic banner.
  }
}
