import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import type { UnlockMethod } from '@/lib/starfish/storage-types';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Txt } from '@/components/ui/Txt';

import { PinDots } from './PinDots';
import { PinPad } from './PinPad';

const PIN_LENGTH = 6;

interface SeedUnlockProps {
  /** Unlock methods enrolled for the stored seed. */
  methods: UnlockMethod[];
  /** Open the sealed seed and start the session (heavy: Argon2id). */
  onUnlock: (method: UnlockMethod, pin?: string) => Promise<void>;
  /** Called once an unlock succeeds — navigate into the app. */
  onDone: () => void;
  /** Forget the stored seed and recover from the 12-word phrase instead. */
  onForget: () => void;
}

/** Cold-start unlock: PIN pad plus, when enrolled, a one-tap passkey unlock. */
export function SeedUnlock({ methods, onUnlock, onDone, onForget }: SeedUnlockProps) {
  const [entry, setEntry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasPasskey = methods.includes('passkey');

  const run = async (method: UnlockMethod, pin?: string) => {
    setBusy(true);
    setError(null);
    try {
      await onUnlock(method, pin);
      onDone();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setEntry('');
      setBusy(false);
    }
  };

  const onDigit = (d: string) => {
    if (busy || entry.length >= PIN_LENGTH) return;
    const next = entry + d;
    setEntry(next);
    if (next.length === PIN_LENGTH) void run('pin', next);
  };

  return (
    <View style={styles.block}>
      {hasPasskey ? (
        <View style={styles.passkeyBlock}>
          <Button
            label={busy ? 'Unlocking…' : 'Unlock with passkey'}
            variant="primary"
            size="lg"
            full
            iconName="key"
            loading={busy}
            disabled={busy}
            onPress={() => void run('passkey')}
          />
          <Txt variant="caption" mono uppercase tone="inkSoft" center>
            or enter your PIN
          </Txt>
        </View>
      ) : null}

      <View style={styles.pinBlock}>
        <Txt variant="caption" weight="semibold" mono uppercase tone="inkSoft" center>
          Enter PIN
        </Txt>
        <PinDots length={PIN_LENGTH} filled={entry.length} />
      </View>

      {error ? (
        <Callout tone="danger" iconName="alert">
          {error}
        </Callout>
      ) : null}

      <PinPad onDigit={onDigit} onDelete={() => setEntry((c) => c.slice(0, -1))} />

      <Button label="Use recovery seed instead" variant="ghost" size="sm" full disabled={busy} onPress={onForget} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.xl },
  passkeyBlock: { gap: spacing.md },
  pinBlock: { gap: spacing.md },
});
