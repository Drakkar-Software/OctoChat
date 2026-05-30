import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { createAutomatedRoom } from '@/lib/automations/orchestrator';
import { getProvider, PROVIDERS } from '@/lib/automations/providers';
import type { AutomationProvider } from '@/lib/automations/types';
import type { Session } from '@/lib/starfish/identity';
import { useTheme } from '@/lib/use-theme';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { IntervalPicker } from '@/components/chat/IntervalPicker';
import { TextField } from '@/components/ui/TextField';
import { Txt } from '@/components/ui/Txt';

interface Props {
  session: Session;
  /** The public space the new automated room lands in. The creator does NOT
   *  open in private spaces (the caller gates that and shows a callout). */
  spaceId: string;
  onClose: () => void;
  onCreated: (roomId: string) => void;
}

/** Two-step modal — pick a provider, configure its params + cadence + name,
 *  submit. Posts via `createAutomatedRoom` (creates the room → saves secrets →
 *  mints the bot credential → stamps the automation meta). */
export function AutomatedRoomCreator({ session, spaceId, onClose, onCreated }: Props) {
  const { colors } = useTheme();
  const [providerId, setProviderId] = useState<string | null>(null);
  const provider = providerId ? getProvider(providerId) : null;
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [secrets, setSecrets] = useState<Record<string, unknown>>({});
  const [name, setName] = useState('');
  const [interval, setInterval] = useState<number>(provider?.fetch ? 60 : 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const picked = useMemo<AutomationProvider | null>(() => provider ?? null, [provider]);

  const pick = (p: AutomationProvider) => {
    setProviderId(p.id);
    setParams({ ...p.defaults });
    setSecrets({});
    if (!name) setName(p.name.toLowerCase().replace(/\s+/g, '-'));
    setInterval(p.fetch ? 60 : 0);
  };

  const submit = async () => {
    if (!picked) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Pick a name for this automation.');
      return;
    }
    for (const f of picked.paramFields) {
      if (!f.required) continue;
      const v = f.secret ? secrets[f.key] : params[f.key];
      if (!v || String(v).trim() === '') {
        setError(`${f.label} is required.`);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const room = await createAutomatedRoom({
        session,
        spaceId,
        name: trimmed,
        providerId: picked.id,
        params,
        secrets,
        intervalMin: interval,
      });
      onCreated(room.id);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.scrim }]}
        onPress={onClose}
        accessibilityLabel="Dismiss"
      >
        <Pressable style={[styles.sheet, { backgroundColor: colors.paper }]} onPress={() => undefined}>
          <View style={[styles.grabber, { backgroundColor: colors.lineSoft }]} />
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Txt variant="micro" weight="bold" mono uppercase tone="inkMuted">
                  New automation
                </Txt>
                <Txt variant="title">{picked ? picked.name : 'Pick an integration'}</Txt>
              </View>
              <IconButton name="x" onPress={onClose} accessibilityLabel="Cancel" color={colors.inkMuted} />
            </View>

            {!picked ? (
              <View style={styles.providerList}>
                {PROVIDERS.map((p) => (
                  <Pressable
                    key={p.id}
                    accessibilityRole="button"
                    onPress={() => pick(p)}
                    style={({ pressed }) => [
                      styles.providerRow,
                      {
                        backgroundColor: pressed ? colors.hover : colors.paperAlt,
                        borderColor: colors.lineSoft,
                      },
                    ]}
                  >
                    <Icon name={p.iconName} size={18} color={colors.inkSoft} />
                    <View style={styles.providerText}>
                      <Txt variant="footnote" weight="semibold">
                        {p.name}
                      </Txt>
                      <Txt variant="caption" tone="inkMuted">
                        {p.description}
                      </Txt>
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : (
              <>
                <Txt variant="caption" tone="inkMuted">
                  {picked.description}
                </Txt>

                <View style={styles.field}>
                  <Txt variant="caption" tone="inkMuted">
                    Room name
                  </Txt>
                  <TextField
                    value={name}
                    onChangeText={setName}
                    placeholder="my-automation"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>

                {picked.paramFields.map((f) => {
                  const isSecret = !!f.secret;
                  const value = isSecret ? ((secrets[f.key] as string | undefined) ?? '') : ((params[f.key] as string | undefined) ?? '');
                  const onChange = (next: string) => {
                    if (isSecret) setSecrets((s) => ({ ...s, [f.key]: next }));
                    else setParams((p) => ({ ...p, [f.key]: next }));
                  };
                  return (
                    <View key={f.key} style={styles.field}>
                      <Txt variant="caption" tone="inkMuted">
                        {f.label}
                        {f.required ? ' *' : ''}
                      </Txt>
                      <TextField
                        value={String(value)}
                        onChangeText={onChange}
                        placeholder={f.placeholder}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType={f.kind === 'number' ? 'numeric' : f.kind === 'url' ? 'url' : 'default'}
                        multiline={f.kind === 'textarea'}
                        secureTextEntry={isSecret}
                      />
                    </View>
                  );
                })}

                {picked.fetch ? (
                  <IntervalPicker value={interval} onChange={setInterval} />
                ) : (
                  <Callout tone="info" iconName="info">
                    Commands-only — this integration doesn't poll on a schedule.
                    Drive it from the room with {(picked.commands ?? []).map((c) => c.usage).join(' or ') || '/<cmd>'}.
                  </Callout>
                )}

                {error ? (
                  <Callout tone="warning" iconName="alert">
                    {error}
                  </Callout>
                ) : null}

                <View style={styles.actions}>
                  <Button label="Back" iconName="arrow-l" variant="ghost" onPress={() => setProviderId(null)} />
                  <View style={styles.actionPrimary}>
                    <Button label="Create" iconName="check" variant="primary" onPress={submit} loading={busy} full />
                  </View>
                </View>
              </>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: radii.pill,
    alignSelf: 'center',
    marginTop: spacing.sm,
  },
  body: { gap: spacing.sm, padding: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headerText: { flex: 1, gap: 2 },
  providerList: { gap: spacing.sm },
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  providerText: { flex: 1, gap: 2 },
  field: { gap: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xs },
  actionPrimary: { flex: 1 },
});
