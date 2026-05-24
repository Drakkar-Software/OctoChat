import { useState } from 'react';

import { isValidSeed } from '@/lib/starfish/identity';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { TextField } from '@/components/ui/TextField';
import { Txt } from '@/components/ui/Txt';

interface SeedRecoverFormProps {
  /** Label for the submit button (e.g. "Recover" or "Add account"). */
  submitLabel: string;
  /** Whether the caller's submit is in flight (disables + spins the button). */
  busy: boolean;
  /** A failure from the caller's submit handler to surface below the form. */
  error?: string | null;
  /** Called with the validated 12 words; the caller signs in / adds the account. */
  onSubmit: (words: string[]) => void;
}

/**
 * The 12-word recovery entry: a textarea, local 12-word + checksum validation,
 * and a submit button. Shared by first-account recovery and add-account so the
 * parsing/validation rules stay in one place; the caller owns what happens with
 * the words (first sign-in vs. add-account).
 */
export function SeedRecoverForm({ submitLabel, busy, error, onSubmit }: SeedRecoverFormProps) {
  const [text, setText] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = () => {
    const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length !== 12) {
      setLocalError('Enter all 12 words, separated by spaces.');
      return;
    }
    if (!isValidSeed(words)) {
      setLocalError('That is not a valid 12-word recovery seed.');
      return;
    }
    setLocalError(null);
    onSubmit(words);
  };

  const shown = localError ?? error;
  return (
    <>
      <Txt variant="body" tone="inkSoft">
        Type your 12 recovery words, separated by spaces. The same words restore the same identity.
      </Txt>
      <TextField
        value={text}
        onChangeText={setText}
        placeholder="anchor bluefin coral …"
        mono
        multiline
        minHeight={88}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Button
        label={busy ? `${submitLabel}…` : submitLabel}
        variant="primary"
        size="lg"
        full
        loading={busy}
        disabled={busy}
        onPress={submit}
      />
      {shown ? (
        <Callout tone="danger" iconName="alert">
          {shown}
        </Callout>
      ) : null}
    </>
  );
}
