import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import {
  deleteAutomatedRoom,
  rotateAutomatedRoomCredential,
  runAutomationTick,
  tickStatusPatch,
  updateAutomatedRoom,
} from '@/lib/automations/orchestrator';
import { getProvider } from '@/lib/automations/providers';
import { loadAutomationSecrets, saveAutomationSecrets } from '@/lib/automations/secrets';
import { openStreamBotCredential, type StreamBotCredential } from '@/lib/starfish/stream-bots';
import type { Session } from '@/lib/starfish/identity';
import type { Room } from '@/lib/types';
import { useRoomsRegistryActions } from '@/lib/rooms-registry-context';
import { useTheme } from '@/lib/use-theme';
import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { CopyField } from '@/components/ui/CopyField';
import { IntervalPicker, type Cadence } from '@/components/chat/IntervalPicker';
import { TextField } from '@/components/ui/TextField';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';

interface Props {
  session: Session;
  room: Room;
  onClose: () => void;
  onDeleted: () => void;
}

/** Settings + actions for an automated room. Owner-only; non-owners see a callout
 *  explaining the room is managed elsewhere. */
export function AutomatedRoomSettingsSheet({ session, room, onClose, onDeleted }: Props) {
  const { colors } = useTheme();
  const { refresh, patchRoomAutomationLocal } = useRoomsRegistryActions();
  const auto = room.automation;
  const provider = auto ? getProvider(auto.providerId) : null;
  const [params, setParams] = useState<Record<string, unknown>>(auto?.params ?? {});
  const [secrets, setSecrets] = useState<Record<string, unknown>>({});
  const [cadence, setCadence] = useState<Cadence>({
    intervalMin: auto?.intervalMin ?? 0,
    onOpen: auto?.onOpen ?? false,
  });
  const [enabled, setEnabled] = useState<boolean>(auto?.enabled ?? true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The bot credential rides the synced doc SEALED to the owner key — unseal it here
  // (any owner device can) to surface the copyable token/endpoint. Re-runs on rotate
  // (the sealed `ct` changes). Stays null on a non-owner / failed unseal → fields hidden.
  const [cred, setCred] = useState<StreamBotCredential | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadAutomationSecrets(session.userId, room.id).then((s) => {
      if (!cancelled) setSecrets(s);
    });
    return () => {
      cancelled = true;
    };
  }, [session.userId, room.id]);

  useEffect(() => {
    if (!auto) return;
    let cancelled = false;
    void openStreamBotCredential(session, auto.credential)
      .then((c) => {
        if (!cancelled) setCred(c);
      })
      .catch(() => {
        if (!cancelled) setCred(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session, auto?.credential.ct]);

  if (!auto || !provider) {
    return (
      <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
        <Pressable style={[styles.backdrop, { backgroundColor: colors.scrim }]} onPress={onClose}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.paper }]} onPress={() => undefined}>
            <Callout tone="warning" iconName="alert">
              This room's automation provider isn't installed on this build.
            </Callout>
            <Button label="Close" variant="ghost" onPress={onClose} />
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  const runsHere = auto.runOnDeviceId === session.keys.edPub;

  const wrap = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    wrap('save', async () => {
      await saveAutomationSecrets(session.userId, room.id, secrets);
      await updateAutomatedRoom({
        session,
        room,
        patch: { params, intervalMin: cadence.intervalMin, onOpen: cadence.onOpen, enabled },
      });
    });

  const runNow = () =>
    wrap('runNow', async () => {
      const now = Date.now();
      // force: a manual run always posts, even if the content is unchanged.
      const outcome = await runAutomationTick({ session, room, trigger: 'scheduled', now, force: true });
      // Reflect the run into the cache so the foreground driver doesn't immediately re-fire.
      patchRoomAutomationLocal(room.spaceId, room.id, tickStatusPatch(outcome, now));
    });

  const takeOver = () =>
    wrap('takeOver', async () => {
      await updateAutomatedRoom({ session, room, patch: { runOnDeviceId: session.keys.edPub } });
    });

  const rotate = () => wrap('rotate', async () => rotateAutomatedRoomCredential(session, room));

  const remove = () =>
    wrap('delete', async () => {
      await deleteAutomatedRoom(session, room);
      await refresh(room.spaceId);
      onDeleted();
    });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.scrim }]}
        onPress={onClose}
        accessibilityLabel="Dismiss"
      >
        <Pressable style={[styles.sheet, { backgroundColor: colors.paper }]} onPress={() => undefined}>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <Txt variant="micro" weight="bold" mono uppercase tone="inkMuted">
              Automation
            </Txt>
            <Txt variant="title">{provider.name}</Txt>
            <Txt variant="caption" tone="inkMuted">
              {provider.description}
            </Txt>

            <View style={styles.row}>
              <Txt variant="footnote" weight="semibold" style={styles.rowLabel}>
                Enabled
              </Txt>
              <Toggle value={enabled} onValueChange={setEnabled} accessibilityLabel="Enable automation" />
            </View>

            <IntervalPicker value={cadence} onChange={setCadence} />

            {provider.paramFields.length ? (
              <>
                <Txt variant="footnote" weight="semibold">
                  Settings
                </Txt>
                {provider.paramFields.map((f) => {
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
              </>
            ) : null}

            <View style={styles.actions}>
              <Button label="Save" iconName="check" onPress={save} loading={busy === 'save'} />
              <Button label="Run now" iconName="refresh" variant="secondary" onPress={runNow} loading={busy === 'runNow'} />
              {runsHere ? (
                <Txt variant="caption" tone="inkMuted">
                  Running on this device.
                </Txt>
              ) : (
                <Button label="Run on this device" iconName="arrow-r" variant="secondary" onPress={takeOver} loading={busy === 'takeOver'} />
              )}
            </View>

            <Txt variant="footnote" weight="semibold">
              Bot credential
            </Txt>
            {cred ? (
              <>
                <CopyField label="Token" value={cred.token} lines={3} />
                <CopyField label="Endpoint" value={cred.endpoint} lines={2} />
              </>
            ) : null}
            <Button label="Rotate credential" iconName="refresh" variant="ghost" onPress={rotate} loading={busy === 'rotate'} />

            {error ? (
              <Callout tone="warning" iconName="alert">
                {error}
              </Callout>
            ) : null}

            <View style={styles.danger}>
              <Button label="Delete automation" iconName="trash" variant="danger" onPress={remove} loading={busy === 'delete'} />
            </View>
            <Button label="Close" variant="ghost" onPress={onClose} />
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
  scroll: { flexShrink: 1 },
  body: { gap: spacing.sm, padding: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  rowLabel: { flex: 1 },
  field: { gap: 4 },
  actions: { gap: spacing.sm, paddingTop: spacing.xs },
  danger: { paddingTop: spacing.lg },
});
