/**
 * Shared knobs for avatar processing. The web and native implementations both
 * downscale a picked image to a small square JPEG data URI that fits inline in
 * the public profile doc (see writeProfile in starfish/client.ts).
 */

/**
 * Cap on the avatar data-URI length. The string is ASCII (base64 + a short
 * `data:image/jpeg;base64,` prefix), so chars ≈ bytes; staying under this leaves
 * headroom under the 64 KB profile doc for the pseudo + JSON framing.
 */
export const AVATAR_BUDGET_CHARS = 60_000;

/** Target square edge in px; the recompression loop shrinks from here if needed. */
export const AVATAR_START_PX = 192;

/** Floor for the shrink loop — below this we give up rather than ship mush. */
export const AVATAR_MIN_PX = 96;

/** JPEG qualities tried at each size, highest first. */
export const AVATAR_QUALITIES = [0.7, 0.6, 0.5, 0.4];

export const AVATAR_NOT_IMAGE = 'Please choose an image file.';
export const AVATAR_TOO_LARGE = 'Could not shrink this image enough — try a different picture.';
