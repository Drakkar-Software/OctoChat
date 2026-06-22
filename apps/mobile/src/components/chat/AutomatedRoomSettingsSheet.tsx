import { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import Conductor, { type ConductorStatus } from '@drakkar.software/expo-conductor';

import { motion, radii, spacing } from '@/theme';
import {
  deleteAutomatedRoom,
  isValidCronExpression,
  renameAutomatedRoom,
  rotateAutomatedRoomCredential,
  runAutomationTick,
  tickStatusPatch,
  updateAutomatedRoom,
} from '@drakkar.software/octochat-sdk';
import { getProvider } from '@drakkar.software/octochat-sdk';
import { loadAutomationSecrets, saveAutomationSecrets } from '@drakkar.software/octochat-sdk';
import { openStreamBotCredential, type StreamBotCredential } from '@drakkar.software/octochat-sdk';
import type { Session } from '@drakkar.software/octochat-sdk';
import type { Room } from '@drakkar.software/octochat-sdk';
import { useRoomsRegistryActions } from '@/lib/rooms-registry-context';
import { syncAutomationTasks } from '@/lib/automations/conductor-init';
import { useTheme } from '@/lib/use-theme';
import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { CopyField } from '@/components/ui/CopyField';
import { Icon } from '@/components/ui/Icon';
import { AutomationRunStatus } from '@/components/chat/AutomationRunStatus';
import { IntervalPicker, type Cadence } from '@/components/chat/IntervalPicker';
import { TextField } from '@/components/ui/TextField';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';

/** Distance the sheet springs up from on mount — larger than the tallest sheet so it
 *  always starts fully offscreen regardless of content height. */
const SHEET_RISE = 700;

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
  const [name, setName] = useState(room.name);
  const [params, setParams] = useState<Record<string, unknown>>(auto?.params ?? {});
  const [secrets, setSecrets] = useState<Record<string, unknown>>({});
  const [cadence, setCadence] = useState<Cadence>({
    intervalMin: auto?.intervalMin ?? 0,
    onOpen: auto?.onOpen ?? false,
    schedule: auto?.schedule,
  });
  const [enabled, setEnabled] = useState<boolean>(auto?.enabled ?? true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bot credential is rarely needed after setup — collapse it so it doesn't bury the
  // common save/run/delete actions in a long scroll.
  const [showCred, setShowCred] = useState(false);
  // The bot credential rides the synced doc SEALED to the owner key — unseal it here
  // (any owner device can) to surface the copyable token/endpoint. Re-runs on rotate
  // (the sealed `ct` changes). Stays null on a non-owner / failed unseal → fields hidden.
  const [cred, setCred] = useState<StreamBotCredential | null>(null);
  // Background-execution availability (native only; web is always 'unsupported' and we
  // don't nag about it). Surfaces an "OS is limiting background runs" hint so a user whose
  // scheduled ticks aren't firing knows it's a system setting, not a bug.
  const [bgStatus, setBgStatus] = useState<ConductorStatus | null>(null);

  // A bottom sheet rises from the bottom edge rather than fading. Spring up on mount
  // (the scrim keeps Modal's fade). Reduced motion → resting position.
  const reduced = useReducedMotion();
  const rise = useSharedValue(reduced ? 0 : SHEET_RISE);
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: rise.value }] }));

  useEffect(() => {
    if (reduced) return;
    rise.set(withSpring(0, motion.spring));
  }, [reduced, rise]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;
    void Conductor.getStatus()
      .then((s) => {
        if (!cancelled) setBgStatus(s);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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
      if (cadence.schedule?.kind === 'cron' && !isValidCronExpression(cadence.schedule.expression)) {
        throw new Error('Cron schedule is invalid — use 3 fields: minute hour day-of-week.');
      }
      await saveAutomationSecrets(session.userId, room.id, secrets);
      await updateAutomatedRoom({
        session,
        room,
        patch: { params, intervalMin: cadence.intervalMin, onOpen: cadence.onOpen, schedule: cadence.schedule, enabled },
      });
      // The registry write doesn't refresh the in-memory cache, so reflect the edit
      // locally — else the driver keeps reading the stale meta (e.g. disabling wouldn't
      // stop ticking, a reschedule wouldn't apply) until a cold reload. Optimistic, not
      // `refresh`: a re-read flips the cached entry to empty mid-write and unmounts this
      // sheet. Safe — the awaited write above isn't caught here, so a failure throws first.
      patchRoomAutomationLocal(room.spaceId, room.id, {
        params,
        intervalMin: cadence.intervalMin,
        onOpen: cadence.onOpen,
        schedule: cadence.schedule,
        enabled,
      });
      // Name lives on the Room (not AutomationMeta); rename only when it changed.
      // It can't ride the local automation patch above, so repaint from the server.
      if (name.trim() && name.trim() !== room.name) {
        await renameAutomatedRoom(session, room, name);
        await refresh(room.spaceId);
      }
      // Reconcile Conductor: apply the new cadence / on-open / enabled state (reschedule,
      // or cancel when disabled).
      await syncAutomationTasks(session);
    });

  const runNow = () =>
    wrap('runNow', async () => {
      const now = Date.now();
      // force: a manual run always posts, even if the content is unchanged.
      const outcome = await runAutomationTick({ session, room, trigger: 'scheduled', now, force: true });
      // Reflect the run into the cache so the foreground driver doesn't immediately re-fire.
      patchRoomAutomationLocal(room.spaceId, room.id, tickStatusPatch(outcome, now));
      // Surface the failure immediately via the action error Callout at the bottom of
      // the sheet — the AutomationRunStatus card above shows the prior persisted state
      // and only updates on re-open; this gives instant feedback for manual runs.
      if (outcome.kind === 'failed') throw new Error(outcome.error);
    });

  const takeOver = () =>
    wrap('takeOver', async () => {
      await updateAutomatedRoom({ session, room, patch: { runOnDeviceId: session.keys.edPub } });
      // Reflect the runner change so the gate elects this device live (else `runsHere`
      // and the driver keep reading the stale runOnDeviceId until a cold reload).
      patchRoomAutomationLocal(room.spaceId, room.id, { runOnDeviceId: session.keys.edPub });
      // This device is now the runner — schedule its Conductor task.
      await syncAutomationTasks(session);
    });

  const rotate = () =>
    wrap('rotate', async () => {
      const credential = await rotateAutomatedRoomCredential(session, room);
      // Reflect the new sealed blob so the `cred` effect (keyed on credential.ct)
      // re-unseals and shows the rotated token without a re-read / remount.
      patchRoomAutomationLocal(room.spaceId, room.id, { credential });
    });

  const remove = () =>
    wrap('delete', async () => {
      await deleteAutomatedRoom(session, room);
      await refresh(room.spaceId);
      // Cancel the room's Conductor task now that its automation is gone.
      await syncAutomationTasks(session);
      onDeleted();
    });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* Backdrop is a plain View with an absolute-fill dismiss Pressable BEHIND the
          sheet — NOT a Pressable wrapping the sheet. Wrapping the ScrollView in a
          Pressable makes the scroll gesture depend on JS-thread responder negotiation,
          which an in-flight automation tick (fetch + crypto) can stall → intermittent
          "stuck" scroll. With the ScrollView free of any Pressable parent, the native
          scroller takes the gesture directly. */}
      <View style={[styles.backdrop, { backgroundColor: colors.scrim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss" />
        <Animated.View style={[styles.sheetWrap, sheetStyle]}>
        <View style={[styles.sheet, { backgroundColor: colors.paper }]}>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <Txt variant="micro" weight="bold" mono uppercase tone="inkMuted">
              Automation
            </Txt>
            <Txt variant="title">{provider.name}</Txt>
            <Txt variant="caption" tone="inkMuted">
              {provider.description}
            </Txt>

            {/* Last-run timestamp + latest error so the owner can see at a glance
                whether the automation has been firing and why it last failed. */}
            <AutomationRunStatus auto={auto} />

            {/* Group the long stack into titled paper sections (General / Schedule /
                Settings) so the consequential controls aren't on one flat plane —
                each Card supplies the lit-from-above depth the config surface lacked. */}
            <Card title="General">
              <View style={styles.field}>
                <Txt variant="caption" tone="inkMuted">
                  Name
                </Txt>
                <TextField
                  value={name}
                  onChangeText={setName}
                  placeholder="my-automation"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <View style={styles.row}>
                <Txt variant="footnote" weight="semibold" style={styles.rowLabel}>
                  Enabled
                </Txt>
                <Toggle value={enabled} onValueChange={setEnabled} accessibilityLabel="Enable automation" />
              </View>
            </Card>

            {/* Card supplies the uppercase-mono "Schedule" title to match General /
                Settings; hideHeading drops IntervalPicker's own sentence-case heading so the
                three section headers read as one family. */}
            <Card title="Schedule">
              <IntervalPicker value={cadence} onChange={setCadence} hideHeading />
            </Card>

            {provider.paramFields.length ? (
              <Card title="Settings">
                {provider.paramFields.map((f) => {
                  const isSecret = !!f.secret;
                  const value = isSecret ? ((secrets[f.key] as string | undefined) ?? '') : ((params[f.key] as string | undefined) ?? '');
                  const onChange = (next: string) => {
                    if (isSecret) setSecrets((s) => ({ ...s, [f.key]: next }));
                    else setParams((p) => ({ ...p, [f.key]: next }));
                  };
                  return (
                    <View key={f.key} style={styles.field}>
                      <View style={styles.fieldLabel}>
                        {/* A lock glyph marks a credential so a secret field is visually
                            distinct from a plain param, not just dotted-out. */}
                        {isSecret ? <Icon name="lock" size={12} color={colors.inkMuted} /> : null}
                        <Txt variant="caption" tone="inkMuted">
                          {f.label}
                        </Txt>
                      </View>
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
              </Card>
            ) : null}

            <View style={styles.actions}>
              <View style={styles.actionRow}>
                <View style={styles.actionCell}>
                  <Button label="Save" iconName="check" onPress={save} loading={busy === 'save'} full />
                </View>
                <View style={styles.actionCell}>
                  <Button label="Run now" iconName="refresh" variant="secondary" onPress={runNow} loading={busy === 'runNow'} full />
                </View>
              </View>
              {runsHere ? (
                <Txt variant="caption" tone="inkMuted">
                  Running on this device.
                </Txt>
              ) : (
                <Button label="Run on this device" iconName="arrow-r" variant="secondary" onPress={takeOver} loading={busy === 'takeOver'} />
              )}
              {bgStatus === 'restricted' ? (
                <Callout tone="warning" iconName="alert">
                  The system is limiting background runs — scheduled ticks may only fire while
                  the room is open. Check Background App Refresh / battery settings.
                </Callout>
              ) : null}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Toggle bot credential"
              onPress={() => setShowCred((v) => !v)}
              style={styles.collapseHeader}
            >
              <Txt variant="footnote" weight="semibold" style={styles.collapseLabel}>
                Bot credential
              </Txt>
              <Icon name={showCred ? 'chevron-up' : 'chevron-down'} size={16} color={colors.inkMuted} />
            </Pressable>
            {showCred ? (
              <>
                {cred ? (
                  <>
                    <CopyField label="Token" value={cred.token} lines={3} />
                    <CopyField label="Endpoint" value={cred.endpoint} lines={2} />
                  </>
                ) : null}
                <Button label="Rotate credential" iconName="refresh" variant="ghost" onPress={rotate} loading={busy === 'rotate'} />
              </>
            ) : null}

            {error ? (
              <Callout tone="warning" iconName="alert">
                {error}
              </Callout>
            ) : null}

            {/* Danger zone — a dangerBg-tinted, danger-bordered well sets the destructive
                action spatially and chromatically apart from the config fields above it. */}
            <View
              style={[
                styles.danger,
                { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder, borderTopColor: colors.hairlineHi },
              ]}
            >
              <Txt variant="caption" weight="semibold" mono uppercase color={colors.danger}>
                Danger zone
              </Txt>
              <Button label="Delete automation" iconName="trash" variant="danger" onPress={remove} loading={busy === 'delete'} />
            </View>
          </ScrollView>
        </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  // The animated wrapper owns the height cap so the inner sheet keeps its rounded
  // top + paper fill while the translateY rise plays.
  sheetWrap: { maxHeight: '90%' },
  sheet: {
    flexShrink: 1,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
  },
  scroll: { flexShrink: 1 },
  body: { gap: spacing.sm, padding: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  rowLabel: { flex: 1 },
  field: { gap: 4 },
  fieldLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  actions: { gap: spacing.sm, paddingTop: spacing.xs },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  actionCell: { flex: 1 },
  collapseHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  collapseLabel: { flex: 1 },
  // Danger well: tinted, danger-bordered, lit top edge — set apart from the fields.
  danger: {
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radii.md,
  },
});
