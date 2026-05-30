import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/**
 * Save a decrypted attachment to the user's device — iOS/Android implementation.
 *
 * There is no universal "download to a folder" on native, so we follow the Expo
 * idiom: write the decrypted bytes to a cache file, then open the OS share sheet
 * (`Sharing.shareAsync`) so the user can save it to Files/Downloads or hand it to
 * another app. The web/default twin (`save-attachment.ts`) drives the browser's
 * `<a download>` instead; both keep an identical signature.
 */
export async function saveAttachment(bytes: Uint8Array, name: string, mime: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) return;
  // Keep the basename only — a `/` in a user filename would point at a missing
  // subdirectory and make `write` throw.
  const file = new File(Paths.cache, name.replace(/[/\\]/g, '_'));
  // `write` is synchronous and (over)writes the cache file, so a re-download of
  // the same name just refreshes it.
  file.write(bytes);
  // `mimeType` is what Android's intent uses to pick a target app; iOS infers the
  // type from the filename's extension. A user-cancelled sheet resolves normally,
  // so there is nothing to treat as an error here.
  await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: name });
}
