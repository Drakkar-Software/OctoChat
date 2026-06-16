export { passkeySupported, passkeyEnrollable, evalPasskey } from '@drakkar.software/octospaces-platform-sdk';
import { enrollPasskey as _enrollPasskey } from '@drakkar.software/octospaces-platform-sdk';

export const enrollPasskey = (displayName: string) =>
  _enrollPasskey(displayName, 'OctoChat', 'octochat');
