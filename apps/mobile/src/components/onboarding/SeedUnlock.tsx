import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { motion, spacing } from '@/theme';
import type { UnlockMethod } from '@/lib/starfish/storage-types';
import { randomFact } from '@/lib/octochat-facts';
import { useTheme } from '@/lib/use-theme';
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
  /** Forget the stored seed and recover from the 12-word phrase instead. Omit to hide
   *  the escape hatch (e.g. a re-auth gate where there's nothing to forget). */
  onForget?: () => void;
}

/** Cold-start unlock: PIN pad plus, when enrolled, a one-tap passkey unlock. */
export function SeedUnlock({ methods, onUnlock, onDone, onForget }: SeedUnlockProps) {
  const { colors } = useTheme();
  const [entry, setEntry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasPasskey = methods.includes('passkey');

  // Slow-unlock flourish: while busy, the keypad fades out and an OctoChat fact
  // fades in to fill the multi-second Argon2id wait. Shared-value opacities
  // crossfade the two; a fresh fact is picked at the start of each attempt.
  const [fact, setFact] = useState(randomFact);
  const padOpacity = useSharedValue(1);
  const tipOpacity = useSharedValue(0);
  const padStyle = useAnimatedStyle(() => ({ opacity: padOpacity.value }));
  const tipStyle = useAnimatedStyle(() => ({ opacity: tipOpacity.value }));

  useEffect(() => {
    if (busy) {
      setFact(randomFact());
      padOpacity.value = withTiming(0, { duration: motion.base });
      tipOpacity.value = withDelay(motion.base, withTiming(1, { duration: motion.base }));
    } else {
      tipOpacity.value = 0;
      padOpacity.value = withTiming(1, { duration: motion.fast });
    }
  }, [busy, padOpacity, tipOpacity]);

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
        {busy ? (
          // Argon2id PIN-stretch takes seconds in the pure-JS web/Electron path;
          // surface a spinner so the wait reads as "working", not frozen. The
          // ActivityIndicator is CSS/compositor-animated on web, so it keeps
          // spinning through the derivation even while the JS thread is crunching.
          <View style={styles.unlocking}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Txt variant="caption" weight="semibold" mono uppercase tone="inkSoft" center>
              Unlocking…
            </Txt>
          </View>
        ) : (
          <>
            <Txt variant="caption" weight="semibold" mono uppercase tone="inkSoft" center>
              Enter PIN
            </Txt>
            <PinDots length={PIN_LENGTH} filled={entry.length} />
          </>
        )}
      </View>

      {error ? (
        <Callout tone="danger" iconName="alert">
          {error}
        </Callout>
      ) : null}

      {/* Crossfade: the keypad fades out and an OctoChat fact fades in to fill the
          Argon2id wait. The keypad stays mounted (faded) so its height holds the
          layout; the tip is overlaid, centered. pointerEvents off the pad while
          busy — onDigit already no-ops, this makes it look it too. */}
      <View>
        <Animated.View style={padStyle} pointerEvents={busy ? 'none' : 'auto'}>
          <PinPad onDigit={onDigit} onDelete={() => setEntry((c) => c.slice(0, -1))} />
        </Animated.View>
        {busy ? (
          <Animated.View style={[StyleSheet.absoluteFill, styles.tip, tipStyle]} pointerEvents="none">
            <Callout tone="accent" iconName={fact.icon} title="Did you know?">
              {fact.text}
            </Callout>
          </Animated.View>
        ) : null}
      </View>

      {onForget ? (
        <Button label="Use recovery seed instead" variant="ghost" size="sm" full disabled={busy} onPress={onForget} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.xl },
  passkeyBlock: { gap: spacing.md },
  // minHeight keeps the slot from collapsing when the dots swap for the spinner.
  pinBlock: { gap: spacing.md, minHeight: 56, justifyContent: 'center' },
  unlocking: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  tip: { justifyContent: 'center', paddingHorizontal: spacing.sm },
});
