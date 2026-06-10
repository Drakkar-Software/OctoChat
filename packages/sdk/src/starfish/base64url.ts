/**
 * base64url for link fragments (UTF-8 safe, web + native) — the encoding both
 * invitation-link kinds ride in a URL `#fragment` (public-space invites in
 * `pubspace.ts`, "DM me" links in `dm-link.ts`). Extracted so the two stay
 * byte-identical; no padding, `+/` → `-_`.
 */
export function toBase64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(json, 'utf-8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(b64, 'base64').toString('utf-8');
}
