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

import { isMuteActive, loadMutesFromKv } from '@drakkar.software/octochat-sdk';
import { notificationTitle } from '@drakkar.software/octochat-sdk';
import { loadNotificationLabels } from '@drakkar.software/octochat-sdk';
import { loadNotificationSettings } from '../notification-settings';
import { loadLatestMessagePreview } from '@drakkar.software/octochat-sdk';
// Importing platform.native runs `install()` (globalThis.crypto) at module load;
// calling configureStarfishPlatform() wires the base64 provider the SDK needs. Both
// are required for decryption to work in this headless task (no provider tree ran).
import { configureStarfishPlatform, loadVault } from '@drakkar.software/octochat-sdk/platform';
import { initOctoChat } from '../octochat-init';
import { hydrateSpaceAccessStore, spaceIdFromRoomId } from '@drakkar.software/octochat-sdk';
import { activeAccountOf, sessionFromPersisted } from '@drakkar.software/octochat-sdk';

import { MESSAGES_CHANNEL_ID, MESSAGES_CHANNEL_VIBRATION_PATTERN } from './channel';
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
 * Replace the placeholder with the real decrypted content. `title` is the resolved
 * "Space › #room" header (or the bare app name when names couldn't be resolved).
 * `id = roomKey` so a later upgrade in the same room replaces this one (latest wins);
 * `groupId = spaceId` bundles a space's rooms. Cancel the FCM placeholder first so the
 * room shows a single banner.
 *
 * `onlyAlertOnce: true` is the spam fix: the OS-rendered placeholder already buzzed,
 * so this decrypted REPLACEMENT must update silently rather than re-vibrate — and a
 * burst of messages in the same room (same `id`) then updates the one banner without
 * buzzing per message. The channel's single-pulse `vibrationPattern` (matching the
 * expo-notifications definition; channels are immutable so both must agree) replaces
 * Android's default multi-pulse pattern.
 */
async function displayRealContent(
  title: string,
  body: string,
  roomKey: string,
  spaceId: string | undefined,
  data: PushData,
): Promise<void> {
  await notifee.createChannel({
    id: MESSAGES_CHANNEL_ID,
    name: 'Messages',
    importance: AndroidImportance.HIGH,
    vibrationPattern: MESSAGES_CHANNEL_VIBRATION_PATTERN,
  });
  await cancelPlaceholder(roomKey);
  await notifee.displayNotification({
    id: roomKey,
    title,
    body,
    data: pushDataToNotifee(data),
    android: {
      channelId: MESSAGES_CHANNEL_ID,
      smallIcon: 'ic_launcher',
      pressAction: { id: 'default' },
      onlyAlertOnce: true,
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
    initOctoChat(); // wire SDK config + kv; no provider tree ran in this headless task
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

    // Muted room (or whole space): suppress the decrypted upgrade and best-effort
    // cancel the OS placeholder so this room stays silent. Read from the kv copy the
    // foreground app warms (no provider tree / server round-trip in this headless
    // task). NOTE: a muted space normally never reaches here (its FCM topic is
    // unsubscribed); a muted room in an UNMUTED space still receives the push, and
    // FCM ordering means the generic placeholder may already be on screen — hence
    // best-effort. (A muted space's own topic-drop is the reliable native layer.)
    const muted = await loadMutesFromKv(userId);
    if (isMuteActive(muted.rooms[roomId]) || isMuteActive(muted.spaces[spaceId])) {
      await cancelPlaceholder(roomId);
      return;
    }

    const session = await sessionFromPersisted(account);
    // Joined-space caps live only in the kv cache in a cold task; reload them (empty
    // server caps leaves the local cache intact, no network) so a JOINED space can open
    // its keyring. Owned spaces don't need it. Likewise hydrate the JOINED public-space
    // link caps so a public room can authorize its plaintext pull (owned public spaces
    // use the account cap, no entry needed).
    await hydrateSpaceAccessStore(userId, {}, {});
    const preview = await loadLatestMessagePreview(session, roomId).catch(() => null);
    if (!preview) return; // couldn't decrypt → leave the generic placeholder

    // Resolve the "Space › #room" title from the plaintext registry. Best-effort: a
    // failed/slow lookup degrades to the bare app name — never gate the preview on it.
    const labels = await loadNotificationLabels(session, roomId).catch(() => null);
    const title = notificationTitle(labels?.spaceName, labels?.roomName, labels?.roomKind);
    await displayRealContent(title, preview, roomId, spaceId, data);
  } catch {
    // Leave the placeholder standing — never worse than the generic banner.
  }
}
