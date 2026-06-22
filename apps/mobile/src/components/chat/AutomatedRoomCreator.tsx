import { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { motion, paperBorder, radii, spacing } from '@/theme';
import { createAutomatedRoom, isValidCronExpression } from '@drakkar.software/octochat-sdk';
import { syncAutomationTasks } from '@/lib/automations/conductor-init';
import { getProvider, PROVIDERS } from '@drakkar.software/octochat-sdk';
import type { AutomationProvider } from '@drakkar.software/octochat-sdk';
import type { Session } from '@drakkar.software/octochat-sdk';
import { useHover } from '@/lib/use-hover';
import { useTheme } from '@/lib/use-theme';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Icon, type IconName } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { IntervalPicker, type Cadence } from '@/components/chat/IntervalPicker';
import { TextField } from '@/components/ui/TextField';
import { Txt } from '@/components/ui/Txt';

// keyboard-controller KAV lifts the bottom-anchored sheet above the keyboard
// (Android edge-to-edge safe); web never overlays the keyboard, so plain View.
// Wraps OUTSIDE the backdrop so the inner ScrollView keeps owning scroll.
const KAV = Platform.OS === 'web' ? View : KeyboardAvoidingView;

interface Props {
  session: Session;
  /** The space the new automated room lands in — PUBLIC or an OWNED PRIVATE one. The caller
   *  only opens the creator when the user owns the space (`canCreate`); the SDK
   *  ({@link createAutomatedRoom}) branches the bot credential on space type. */
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
  const [cadence, setCadence] = useState<Cadence>(
    provider?.fetch ? { intervalMin: 60, onOpen: false } : { intervalMin: 0, onOpen: false },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A bottom sheet's natural motion is a rise from the bottom edge, not a fade. Spring
  // the sheet up on mount (the scrim keeps Modal's fade). Reduced motion → resting.
  const reduced = useReducedMotion();
  const rise = useSharedValue(reduced ? 0 : SHEET_RISE);
  useEffect(() => {
    if (reduced) return;
    rise.set(withSpring(0, motion.spring));
  }, [reduced, rise]);
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: rise.value }] }));

  const picked = useMemo<AutomationProvider | null>(() => provider ?? null, [provider]);

  const pick = (p: AutomationProvider) => {
    setProviderId(p.id);
    setParams({ ...p.defaults });
    setSecrets({});
    if (!name) setName(p.name.toLowerCase().replace(/\s+/g, '-'));
    setCadence(p.fetch ? { intervalMin: 60, onOpen: false } : { intervalMin: 0, onOpen: false });
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
    if (cadence.schedule?.kind === 'cron' && !isValidCronExpression(cadence.schedule.expression)) {
      setError('Cron schedule is invalid — use 3 fields: minute hour day-of-week.');
      return;
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
        intervalMin: cadence.intervalMin,
        onOpen: cadence.onOpen,
        schedule: cadence.schedule,
      });
      // Schedule the new automation's Conductor task on this (runner) device.
      await syncAutomationTasks(session);
      onCreated(room.id);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KAV style={styles.kav} behavior="padding">
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.scrim }]}
        onPress={onClose}
        accessibilityLabel="Dismiss"
      >
        <Animated.View style={[styles.sheetWrap, sheetStyle]}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.paper }]} onPress={() => undefined}>
          <View style={[styles.grabber, { backgroundColor: colors.lineSoft }]} />
          <ScrollView style={styles.scroll} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
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
                  <ProviderRow key={p.id} provider={p} onPick={() => pick(p)} />
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
                  <IntervalPicker value={cadence} onChange={setCadence} />
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
        </Animated.View>
      </Pressable>
      </KAV>
    </Modal>
  );
}

/** Distance the sheet springs up from on mount. Larger than the tallest sheet so it
 *  always starts fully offscreen regardless of content height. */
const SHEET_RISE = 600;

/** One pick-an-integration row — raised lit paper (paperBorder) that picks up the hover
 *  wash on web and a press wash on touch, so the provider menu feels responsive like the
 *  rest of the app instead of inert until tapped. */
function ProviderRow({ provider, onPick }: { provider: AutomationProvider; onPick: () => void }) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={provider.name}
      onPress={onPick}
      {...hoverProps}
      style={({ pressed }) => [
        styles.providerRow,
        paperBorder(colors),
        { backgroundColor: pressed || hovered ? colors.hover : colors.paperAlt },
      ]}
    >
      <Icon name={provider.iconName as IconName} size={18} color={colors.inkSoft} />
      <View style={styles.providerText}>
        <Txt variant="footnote" weight="semibold">
          {provider.name}
        </Txt>
        <Txt variant="caption" tone="inkMuted">
          {provider.description}
        </Txt>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  kav: { flex: 1 },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  // The animated wrapper owns the height cap so the inner sheet keeps its rounded top +
  // paper fill while the translateY rise plays.
  sheetWrap: { maxHeight: '90%' },
  sheet: {
    flexShrink: 1,
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
  scroll: { flexShrink: 1 },
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
