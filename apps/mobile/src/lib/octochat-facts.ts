import type { IconName } from '@/components/ui/Icon';

/** A bite-sized tip or fun fact shown to fill a slow unlock (Argon2id) wait. */
export interface OctoFact {
  /** Leading glyph, chosen to match the fact's subject. */
  icon: IconName;
  text: string;
}

/**
 * Tips and facts surfaced while the PIN is being stretched. They double as
 * gentle security education — every claim here is true of OctoChat's design
 * (see the project README / starfish layer), so nothing oversells the model.
 */
export const OCTOCHAT_FACTS: OctoFact[] = [
  { icon: 'shield', text: 'Messages are end-to-end encrypted — the server only ever stores ciphertext, never your words.' },
  { icon: 'key', text: 'Your keys are derived from a 12-word recovery phrase and never leave this device.' },
  { icon: 'lock', text: 'Each room carries its own keyring, so every space stays sealed on its own.' },
  { icon: 'shield', text: 'OctoChat pairs Ed25519 signing with Kyber — a post-quantum key exchange.' },
  { icon: 'devices', text: 'Add a new device by scanning a QR code: your seed is shared, never typed.' },
  { icon: 'globe', text: 'One codebase ships OctoChat to iOS, Android, web and desktop alike.' },
  { icon: 'clock', text: 'Stretching your PIN takes a moment on purpose — it makes a stolen vault far harder to crack.' },
  { icon: 'people', text: 'An octopus has three hearts and blue blood — fitting for a chat that keeps your team in sync.' },
];

/** Pick a random fact to show during a slow unlock. */
export function randomFact(): OctoFact {
  return OCTOCHAT_FACTS[Math.floor(Math.random() * OCTOCHAT_FACTS.length)];
}
