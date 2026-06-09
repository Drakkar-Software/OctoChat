/**
 * Sealed stream elements — read (and write) end-to-end-encrypted messages that a
 * KEYLESS external writer injected into a public-space room.
 *
 * A normal public room is plaintext: each append element's `data` is a
 * {@link StreamEnvelope} the server can read. A *sealed* room instead carries
 * ciphertext: the writer (e.g. an inbound webhook holding only a published "space
 * write key") seals each envelope to that key, so the server stores only an opaque
 * blob. Members hold the matching private key — distributed out of band, e.g. wrapped
 * into the space keyring — and open it here.
 *
 * This mirrors how `pullAndFold` decrypts a PRIVATE room with the space keyring CEK,
 * but uses the asymmetric `seal`/`unseal` primitive instead: the writer needs only
 * the public key (it can inject but never read), while readers need the private key.
 * Use {@link openSealedItems} to turn a pulled batch (which may mix sealed and
 * plaintext elements) into plain elements ready for {@link fanOut}.
 */
import { seal, unseal, type SealedBlob, type SealerKeys } from '@drakkar.software/starfish-keyring';
import type { AppendElement } from '@drakkar.software/starfish-client';

import type { StreamEnvelope } from './stream-log';

const DEC = new TextDecoder();

/** Structural check that an element's `data` is a sealed blob (`{ entry, ct }`), so a
 *  reader can branch per element when a log mixes sealed and plaintext writes. */
export function isSealedElement(data: unknown): data is SealedBlob {
  return (
    typeof data === 'object' &&
    data !== null &&
    'entry' in data &&
    'ct' in data &&
    typeof (data as { ct: unknown }).ct === 'string'
  );
}

/** Seal a stream envelope to a space write public key (for a member posting into a
 *  sealed room, or to mirror what the inbound webhook does). */
export function sealStreamElement(
  envelope: StreamEnvelope,
  recipientKemPubHex: string,
  sealer: SealerKeys,
): Promise<SealedBlob> {
  return seal(JSON.stringify(envelope), recipientKemPubHex, sealer);
}

/** Open one sealed element with the space write PRIVATE key, returning the envelope.
 *  Pass `opts.requireSealer` (the writer's Ed25519 pubkey hex) to pin provenance —
 *  the open throws unless the blob was sealed by that key. */
export async function openSealedStreamElement(
  blob: SealedBlob,
  kemPrivHex: string,
  opts: { requireSealer?: string } = {},
): Promise<StreamEnvelope> {
  const bytes = await unseal(blob, kemPrivHex, opts);
  return JSON.parse(DEC.decode(bytes)) as StreamEnvelope;
}

/**
 * Turn a pulled batch into plain elements ready for {@link fanOut}: plaintext
 * elements pass through unchanged; sealed elements are opened with `kemPrivHex`; an
 * element that fails to open (wrong key, bad provenance, tampering) is SKIPPED — a
 * single bad element must never brick the room, exactly as `pullAndFold` skips an
 * undecryptable private-room element.
 */
export async function openSealedItems(
  items: AppendElement[],
  kemPrivHex: string,
  opts: { requireSealer?: string } = {},
): Promise<AppendElement[]> {
  const out: AppendElement[] = [];
  for (const item of items) {
    if (isSealedElement(item.data)) {
      try {
        const envelope = await openSealedStreamElement(item.data, kemPrivHex, opts);
        out.push({ ...item, data: envelope as unknown as Record<string, unknown> });
      } catch {
        // Skip an unopenable element rather than failing the whole fold.
      }
    } else {
      out.push(item);
    }
  }
  return out;
}
