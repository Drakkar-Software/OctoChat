// Thin re-export — implementation lives in octospaces-sdk.
export {
  buildSession,
  buildLinkedSession,
  deriveSession,
  rootIdentityOf,
  ownerTrustedAdders,
  generateSeedWords,
  isValidSeed,
  fingerprintFromUserId,
} from '@drakkar.software/octospaces-sdk';
export type { Session, LinkedIdentity } from '@drakkar.software/octospaces-sdk';
