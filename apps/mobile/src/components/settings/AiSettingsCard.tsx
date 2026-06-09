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
import { Row } from '@/components/ui/Row';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { Txt } from '@/components/ui/Txt';
import { formatBytes } from '@drakkar.software/octochat-sdk';

export function AiSettingsCard() {
  const { settings, update } = useAiSettings();
  const { kind, model, progress, download, cancelDownload, removeModel } = useAiModelStatus();
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
            <>
              {model && !model.meetsRequirements ? (
                <Callout tone="warning" iconName="alert">
                  Your device may not meet the minimum requirements for this model (
                  {formatBytes(model.minRamBytes)} RAM needed).
                </Callout>
              ) : (
                <Callout tone="info" iconName="info">
                  An on-device model is needed for AI features.{' '}
                  {model ? `Download ${model.name} (≈${formatBytes(model.sizeBytes)}).` : ''}
                </Callout>
              )}
              <Button
                label={model ? `Download ${model.name} (≈${formatBytes(model.sizeBytes)})` : 'Download model'}
                variant="secondary"
                iconName="info"
                disabled={model ? !model.meetsRequirements : false}
                onPress={() => model && void download(model.id)}
              />
            </>
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
});
