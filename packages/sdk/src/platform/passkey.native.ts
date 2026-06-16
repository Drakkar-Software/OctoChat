export { passkeySupported, passkeyEnrollable, evalPasskey } from '@drakkar.software/octospaces-platform-sdk';
import { enrollPasskey as _enrollPasskey } from '@drakkar.software/octospaces-platform-sdk';
import type { PasskeyEnrollment } from '@drakkar.software/octospaces-sdk';

export const enrollPasskey = (displayName: string): Promise<PasskeyEnrollment> =>
  _enrollPasskey(displayName, 'OctoChat', 'octochat');
