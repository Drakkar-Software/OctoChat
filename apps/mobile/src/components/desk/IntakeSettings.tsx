import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { useFeature } from '@/lib/use-feature';
import { useIdentityLink } from '@/lib/use-dm-link';
import { useIntakeConfig } from '@/lib/use-intake-config';
import { encodeRequestLink } from '@drakkar.software/octochat-sdk';
import type { IntakeMode } from '@drakkar.software/octochat-sdk';
import { Card } from '@/components/ui/Card';
import { CopyField } from '@/components/ui/CopyField';
import { Divider } from '@/components/ui/Divider';
import { Reveal } from '@/components/ui/Reveal';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { TextField } from '@/components/ui/TextField';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';

const MODES: { key: IntakeMode; title: string; detail: string }[] = [
  { key: 'manual', title: 'Review manually', detail: 'Requests wait under Requests until you accept them.' },
  { key: 'auto-accept', title: 'Auto-accept', detail: 'Turn every request into a ticket automatically.' },
  { key: 'auto-reply', title: 'Auto-accept and reply', detail: 'Accept, then send the first reply for you.' },
];

const REPLY_PLACEHOLDER = "Thanks for reaching out — we've logged your request and will reply shortly.";

/**
 * Owner-only "Requests" card for one space: the shareable request link (so non-members can request
 * a private room or file a ticket without joining), plus — on desk builds — how inbound ticket
 * requests are handled (review manually / auto-accept / auto-accept and reply).
 * Mount inside the space settings screen for any non-DM owner.
 */
export function IntakeSettings({ spaceId }: { spaceId: string }) {
  const { colors } = useTheme();
  const hasTickets = useFeature('tickets');
  const { config, loading, error, save } = useIntakeConfig(spaceId);
  // The owner's shareable request link for THIS space: the identity link + the target space.
  const { link } = useIdentityLink('request');
  const requestLink = link ? encodeRequestLink(link, spaceId) : null;

  // Local draft for the fixed reply so typing is smooth; persisted on blur.
  const [draft, setDraft] = useState(config.replyText);
  useEffect(() => {
    setDraft(config.replyText);
  }, [config.replyText]);

  return (
    <Card title="REQUESTS">
      <Txt variant="footnote" tone="inkSoft">
        Share this link so anyone can request a private room or file a support ticket — no account
        or membership needed.
      </Txt>
      {requestLink ? (
        <CopyField label="Request link" value={requestLink} copyLabel="Copy link" lines={3} />
      ) : (
        <Txt variant="caption" tone="inkMuted">
          Your link will be ready once this identity has synced its keys.
        </Txt>
      )}

      {hasTickets ? (
        <>
          <Divider />

          <Txt variant="footnote" tone="inkSoft">
            Choose what happens when someone sends a ticket request.
          </Txt>

          <View style={styles.options}>
            {MODES.map((m) => {
              const active = config.mode === m.key;
              return (
                <Pressable
                  key={m.key}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active, disabled: loading }}
                  disabled={loading}
                  onPress={() => void save({ mode: m.key })}
                  style={({ pressed }) => [
                    styles.option,
                    {
                      borderColor: active ? colors.accentDeskBorder : colors.ruleSoft,
                      backgroundColor: active ? colors.accentDeskBg : 'transparent',
                    },
                    pressed && !active && { backgroundColor: colors.hover },
                  ]}
                >
                  <View style={[styles.radio, { borderColor: active ? colors.accentDesk : colors.inkFaint }]}>
                    {active ? <View style={[styles.radioDot, { backgroundColor: colors.accentDesk }]} /> : null}
                  </View>
                  <View style={styles.optionText}>
                    <Txt variant="body" weight="medium">
                      {m.title}
                    </Txt>
                    <Txt variant="caption" tone="inkMuted">
                      {m.detail}
                    </Txt>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Divider />

          <View style={styles.encRow}>
            <View style={styles.optionText}>
              <Txt variant="body" weight="medium">
                End-to-end encrypt tickets
              </Txt>
              <Txt variant="caption" tone="inkMuted">
                Messages are sealed with a per-ticket keyring — only you and the requester can read them.
              </Txt>
            </View>
            <Toggle
              tone="desk"
              disabled={loading}
              value={config.enc ?? false}
              onValueChange={(v) => void save({ enc: v })}
            />
          </View>

          {config.mode === 'auto-reply' ? (
            <Reveal style={styles.replyBlock}>
              <Txt variant="micro" weight="semibold" mono uppercase tone="inkSoft">
                Reply with
              </Txt>
              <SegmentedControl
                segments={[
                  { key: 'fixed', label: 'Fixed message' },
                  { key: 'ai', label: 'AI-written' },
                ]}
                selected={config.replyKind}
                onSelect={(k) => void save({ replyKind: k === 'ai' ? 'ai' : 'fixed' })}
              />
              {config.replyKind === 'fixed' ? (
                <TextField
                  value={draft}
                  onChangeText={setDraft}
                  onBlur={() => {
                    if (draft !== config.replyText) void save({ replyText: draft });
                  }}
                  placeholder={REPLY_PLACEHOLDER}
                  multiline
                  autoCapitalize="sentences"
                />
              ) : (
                <Txt variant="caption" tone="inkMuted">
                  An on-device model writes a short first reply. If AI isn&apos;t ready on this device,
                  your fixed message is sent instead.
                </Txt>
              )}
            </Reveal>
          ) : null}
        </>
      ) : null}

      {error ? (
        <Txt variant="footnote" color={colors.danger}>
          Couldn&apos;t save the change. Check your connection and try again.
        </Txt>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  options: { gap: spacing.xs },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  radioDot: { width: 8, height: 8, borderRadius: 4 },
  optionText: { flex: 1, gap: 2 },
  replyBlock: { gap: spacing.sm, marginTop: spacing.xs },
  encRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
