import * as DocumentPicker from 'expo-document-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import {
  AVATAR_BUDGET_CHARS,
  AVATAR_MIN_PX,
  AVATAR_NOT_IMAGE,
  AVATAR_QUALITIES,
  AVATAR_START_PX,
  AVATAR_TOO_LARGE,
} from './avatar-image.shared';

/**
 * Pick an image, center-crop it square and downscale it to a small JPEG data URI
 * that fits inline in the public profile doc. Returns null if the user cancels;
 * throws if the file isn't an image or can't be shrunk under budget.
 *
 * Native path: crop + resize + JPEG-encode run on the background thread via
 * expo-image-manipulator's context API. The web variant lives in
 * `avatar-image.ts` (canvas).
 */
export async function pickAndProcessAvatar(): Promise<string | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true });
  const asset = res.canceled ? undefined : res.assets?.[0];
  if (!asset) return null;
  if (asset.mimeType && !asset.mimeType.startsWith('image/')) throw new Error(AVATAR_NOT_IMAGE);

  // Render once to read the source dimensions, then derive a centered square crop.
  const source = await ImageManipulator.manipulate(asset.uri).renderAsync();
  const side = Math.min(source.width, source.height);
  const originX = Math.floor((source.width - side) / 2);
  const originY = Math.floor((source.height - side) / 2);

  for (let px = AVATAR_START_PX; px >= AVATAR_MIN_PX; px = Math.round(px * 0.8)) {
    const ref = await ImageManipulator.manipulate(asset.uri)
      .crop({ originX, originY, width: side, height: side })
      .resize({ width: px, height: px })
      .renderAsync();
    // Try each quality at this size; shrink only if none fit the budget.
    // NOTE (verify on native): we re-encode the same ImageRef at several
    // qualities. If a future SDK consumes the ref on saveAsync, move the
    // manipulate→renderAsync inside this loop (one resize per quality).
    for (const q of AVATAR_QUALITIES) {
      const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: q, base64: true });
      if (out.base64) {
        const uri = `data:image/jpeg;base64,${out.base64}`;
        if (uri.length <= AVATAR_BUDGET_CHARS) return uri;
      }
    }
  }
  throw new Error(AVATAR_TOO_LARGE);
}
