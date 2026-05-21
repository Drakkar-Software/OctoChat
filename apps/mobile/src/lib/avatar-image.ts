import {
  AVATAR_BUDGET_CHARS,
  AVATAR_MIN_PX,
  AVATAR_NOT_IMAGE,
  AVATAR_QUALITIES,
  AVATAR_START_PX,
  AVATAR_TOO_LARGE,
} from './avatar-image.shared';
import { pickFile } from './pick-file';

/**
 * Pick an image, center-crop it square and downscale it to a small JPEG data URI
 * that fits inline in the public profile doc. Returns null if the user cancels;
 * throws if the file isn't an image or can't be shrunk under budget.
 *
 * Web path: decode the picked bytes with `createImageBitmap`, crop + resize on a
 * `<canvas>`, and re-encode with `toDataURL` — no native module needed. The
 * native variant lives in `avatar-image.native.ts`.
 */
export async function pickAndProcessAvatar(): Promise<string | null> {
  const file = await pickFile('image/*');
  if (!file) return null;
  if (!file.mime.startsWith('image/')) throw new Error(AVATAR_NOT_IMAGE);

  // `as BlobPart`: TS's strict ArrayBufferLike vs ArrayBuffer split — same cast
  // bytesToUri uses in AttachmentView; runtime bytes are a plain ArrayBuffer.
  const bitmap = await createImageBitmap(new Blob([file.bytes as BlobPart], { type: file.mime }));
  try {
    // Center-crop to the largest centered square, then resize that square down.
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    for (let px = AVATAR_START_PX; px >= AVATAR_MIN_PX; px = Math.round(px * 0.8)) {
      const canvas = document.createElement('canvas');
      canvas.width = px;
      canvas.height = px;
      const ctx = canvas.getContext('2d');
      if (!ctx) break;
      ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, px, px);
      // Try each quality at this size; shrink the canvas only if none fit.
      for (const q of AVATAR_QUALITIES) {
        const uri = canvas.toDataURL('image/jpeg', q);
        if (uri.length <= AVATAR_BUDGET_CHARS) return uri;
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error(AVATAR_TOO_LARGE);
}
