/**
 * AI section of the profile/settings screen. Mirrors NotificationSettingsCard.tsx.
 * Shows model availability and lets the user toggle on-device AI features.
 * Everything runs on-device — no data leaves the phone.
 */
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useAiSettings } from '@/lib/ai-settings-context';
import { useAiModelStatus } from '@/lib/ai/use-ai-model-status';
import { useTheme } from '@/lib/use-theme';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { Pill } from '@/components/ui/Pill';
import { Row } from '@/components/ui/Row';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { Txt } from '@/components/ui/Txt';
import { formatBytes } from '@drakkar.software/octochat-sdk';

export function AiSettingsCard() {
  const { settings, update } = useAiSettings();
  const { kind, models, model, recommendedId, progress, download, cancelDownload, removeModel } =
    useAiModelStatus();
  const { colors } = useTheme();

  const unsupported = kind === 'checking' || kind === 'unsupported';
  const needsDownload = kind === 'needs-download';
  const downloading = kind === 'downloading';
  const ready = kind === 'available-built-in' || kind === 'ready';

  return (
    <Card title="AI">
      <ToggleRow
        iconName="sparkles"
        title="AI suggestions & summaries"
        detail={
          unsupported
            ? 'Requires iOS 18+ or a recent Android device — not available here'
            : 'Reply suggestions and "catch me up" space summaries, on-device'
        }
        value={unsupported ? false : settings.enabled}
        onValueChange={(enabled) => update({ enabled })}
        disabled={unsupported}
      />

      {/* Privacy note */}
      <Txt variant="micro" tone="inkMuted" style={styles.note}>
        Everything runs on-device. Your messages never leave your phone.
      </Txt>

      {/* Model section — only when feature is enabled and we know the state */}
      {settings.enabled && !unsupported ? (
        <>
          <Divider style={styles.divider} />

          {ready ? (
            <>
              <Row
                iconName="check"
                title={kind === 'available-built-in' ? 'Built-in model ready' : 'Model ready'}
                detail={
                  kind === 'available-built-in'
                    ? "Using your device's native AI — no download required"
                    : model
                    ? `${model.name} · ${formatBytes(model.sizeBytes)}`
                    : 'Downloaded model active'
                }
              />
              {kind === 'ready' && model ? (
                <Row
                  iconName="trash"
                  title="Delete model"
                  detail={`Free up ${formatBytes(model.sizeBytes)} of storage`}
                  onPress={() => void removeModel(model.id)}
                />
              ) : null}
            </>
          ) : needsDownload ? (
            models.length === 0 ? (
              <Callout tone="warning" iconName="alert">
                Your device doesn’t meet the minimum requirements to run an on-device model.
              </Callout>
            ) : (
              <>
                <Callout tone="info" iconName="info">
                  An on-device model is needed for AI features. It downloads once and runs entirely
                  on your phone. The lighter model is recommended — it uses less memory.
                </Callout>
                {models.map((m) => (
                  <View key={m.id} style={styles.modelOption}>
                    <View style={styles.modelInfo}>
                      <View style={styles.modelTitleRow}>
                        <Txt variant="callout" weight="semibold">
                          {m.name}
                        </Txt>
                        {m.id === recommendedId ? <Pill label="Recommended" tone="accent" /> : null}
                      </View>
                      <Txt variant="caption" tone="inkMuted">
                        ≈{formatBytes(m.sizeBytes)} · {m.parameterCount} params
                      </Txt>
                    </View>
                    <Button
                      label="Download"
                      variant={m.id === recommendedId ? 'secondary' : 'ghost'}
                      size="sm"
                      onPress={() => void download(m.id)}
                    />
                  </View>
                ))}
              </>
            )
          ) : downloading ? (
            <View style={styles.downloadProgress}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Txt variant="footnote" tone="inkMuted" style={styles.progressText}>
                Downloading… {Math.round(progress * 100)}%
              </Txt>
              <Button
                label="Cancel"
                variant="ghost"
                size="sm"
                onPress={() => model && void cancelDownload(model.id)}
              />
            </View>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  note: { marginTop: spacing.xs },
  divider: { marginVertical: spacing.sm },
  checking: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  downloadProgress: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  progressText: { flex: 1 },
  modelOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  modelInfo: { flex: 1, gap: 2 },
  modelTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
});
