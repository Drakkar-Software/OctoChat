import { useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { copyText } from '@/lib/clipboard';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Txt } from '@/components/ui/Txt';

import { SeedGrid } from './SeedGrid';

interface SeedBackupProps {
  /** The 12-word recovery phrase to display. */
  words: readonly string[];
  /** A creation failure to surface in place of the default warning, if any. */
  error?: string | null;
  /** Lead-in copy; defaults to the first-time "write these down" wording. */
  intro?: ReactNode;
}

/**
 * The recovery-seed backup body: a warning, the concealable 12-word grid, and
 * reveal / copy controls. Shared by first-account onboarding and add-account so
 * the phrase-handling UI stays identical. The confirm action lives in each
 * screen's footer — the handler differs (first sign-in vs. add-account).
 */
export function SeedBackup({ words, error, intro }: SeedBackupProps) {
  const [revealed, setRevealed] = useState(false);
  return (
    <>
      {intro ?? (
        <Txt variant="body" tone="inkSoft">
          Write these 12 words down somewhere private. They&apos;re the{' '}
          <Txt variant="body" weight="bold" tone="ink">
            only
          </Txt>{' '}
          way to recover your account.
        </Txt>
      )}

      <SeedGrid words={words} concealed={!revealed} />

      <View style={styles.actions}>
        <Button
          label={revealed ? 'Hide' : 'Reveal'}
          variant="ghost"
          size="sm"
          iconName={revealed ? 'eye-off' : 'eye'}
          onPress={() => setRevealed((v) => !v)}
        />
        {Platform.OS === 'web' ? (
          <Button
            label="Copy"
            variant="ghost"
            size="sm"
            iconName="copy"
            onPress={() => void copyText(words.join(' '))}
          />
        ) : null}
      </View>

      {error ? (
        <Callout tone="danger" iconName="alert" title="Couldn't create identity">
          {error}
        </Callout>
      ) : (
        <Callout tone="danger" iconName="alert" title="No screenshots.">
          Anyone with these 12 words can read your messages forever.
        </Callout>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
