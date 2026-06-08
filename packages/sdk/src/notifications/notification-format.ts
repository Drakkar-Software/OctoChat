/**
 * Format a notification's TITLE from a space + room name, mirroring the in-app
 * room-screen convention (`#channel`/`#stream`, bare DM name — see `room/[id].tsx`).
 * Shared by every surface that renders a "new message" notification: the Android
 * push banner (`push/background-notify.native`) and the web/desktop SSE toast
 * (`notify`), so a notification reads the same everywhere — "Space › #room".
 *
 * Names are plaintext space metadata, NOT message content, so they're orthogonal to
 * the `preview` setting. Resolution is best-effort: when a name can't be recovered
 * (registry not synced yet / pull failed) the title degrades to whichever part
 * resolved, and to the bare app name when neither did — the message body is never
 * gated on name resolution.
 */
import type { RoomKind } from '../domain/types';

/** Shown in a notification header when no room/space name resolves. */
export const APP_NAME = 'OctoChat';

/** "#general" for channels/streams, the bare name for a DM — matches `room/[id].tsx`. */
export function roomDisplayName(name: string, kind?: RoomKind): string {
  return kind === 'dm' ? name : `#${name}`;
}

/**
 * "Space › #room" when both names are known; degrades to whichever part resolved
 * (room alone, or space alone for a roomless space push), and to {@link APP_NAME}
 * when neither did.
 */
export function notificationTitle(
  spaceName: string | null | undefined,
  roomName: string | null | undefined,
  kind?: RoomKind,
): string {
  const room = roomName ? roomDisplayName(roomName, kind) : null;
  if (spaceName && room) return `${spaceName} › ${room}`;
  return room ?? spaceName ?? APP_NAME;
}
