import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { motion, spacing } from '@/theme';
import type { UnlockMethod } from '@drakkar.software/octochat-sdk';
import { randomFact } from '@/lib/octochat-facts';
import { useTheme } from '@/lib/use-theme';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { FadeView } from '@/components/ui/FadeView';
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
  // Bumped on a failed unlock so the PIN dots play a short mismatch shake.
  const [shake, setShake] = useState(0);
  const hasPasskey = methods.includes('passkey');

  // Slow-unlock flourish: while busy the keypad fades out (over ~2s, on the
  // compositor so it animates through the JS-thread-blocking Argon2id stretch)
  // and a rotating OctoChat fact fades in once the pad has cleared, to fill the
  // wait. A fresh fact is picked at the start of each attempt, before busy flips.
  const [fact, setFact] = useState(randomFact);

  const run = async (method: UnlockMethod, pin?: string) => {
    setFact(randomFact());
    setBusy(true);
    setError(null);
    try {
      // Yield a tick so React commits + paints the busy frame (pad at full
      // opacity, fade armed) before Argon2id seizes the JS thread — otherwise
      // the synchronous crunch can start before the fade-out gets to begin.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await onUnlock(method, pin);
      onDone();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setEntry('');
      setBusy(false);
      // Kinetic "wrong PIN" signal: shake the dots (no-op under reduced motion).
      if (method === 'pin') setShake((n) => n + 1);
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
            <PinDots length={PIN_LENGTH} filled={entry.length} shake={shake} />
          </>
        )}
      </View>

      {error ? (
        <Callout tone="danger" iconName="alert">
          {error}
        </Callout>
      ) : null}

      {/* Crossfade: the keypad fades out (slowly, during the unlock) and an OctoChat
          fact fades in once it has cleared, to fill the Argon2id wait. The keypad
          stays mounted (faded) so its height holds the layout; the tip is overlaid,
          centered. Fade-out runs over ~2s; recovery (on error) snaps back fast.
          pointerEvents off the pad while busy — onDigit already no-ops too. */}
      <View>
        <FadeView visible={!busy} duration={busy ? motion.unlockFade : motion.fast} pointerEvents={busy ? 'none' : 'auto'}>
          <PinPad onDigit={onDigit} onDelete={() => setEntry((c) => c.slice(0, -1))} />
        </FadeView>
        <FadeView
          visible={busy}
          duration={motion.base}
          delay={busy ? motion.unlockFade : 0}
          style={[StyleSheet.absoluteFill, styles.tip]}
          pointerEvents="none"
        >
          <Callout tone="accent" iconName={fact.icon} title="Did you know?">
            {fact.text}
          </Callout>
        </FadeView>
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
