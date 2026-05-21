import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, TextInput, View } from 'react-native';

import { fonts, radii, spacing, type as typeScale } from '@/theme';
import { plural } from '@/lib/format';
import { useSession } from '@/lib/session-context';
import { useSpaces } from '@/lib/use-spaces';
import { useSpaceSettings } from '@/lib/use-space-settings';
import { useTheme } from '@/lib/use-theme';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';

export default function SpaceScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const spaceId = params.id;
  const { session } = useSession();
  const { spaces } = useSpaces();
  const space = spaces.find((s) => s.id === spaceId);
  const name = space?.name ?? params.name ?? 'Space';
  const members = space?.members ?? 1;
  const { isOwner, loading, rename } = useSpaceSettings(spaceId);

  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    try {
      await rename(draft ?? name);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <StackScreen scroll contentStyle={styles.content} header={<AppBar title="Space" onBack={() => router.back()} />}>
      {!session ? (
        <EmptyState iconName="lock" title="Sign in first" />
      ) : (
        <>
          <Card title="INFORMATION">
            <Txt variant="title" weight="bold" numberOfLines={1}>
              {name}
            </Txt>
            <View style={styles.meta}>
              <Icon name="lock" size={12} color={colors.accent} />
              <Txt variant="footnote" tone="inkMuted">
                end-to-end encrypted · {plural(members, 'member')}
              </Txt>
            </View>
            <Txt variant="caption" mono tone="inkMuted" numberOfLines={1}>
              {spaceId}
            </Txt>
          </Card>

          <Card title="SETTINGS">
            {loading ? (
              <Txt variant="footnote" tone="inkMuted">
                Checking access…
              </Txt>
            ) : isOwner ? (
              <>
                <Txt variant="footnote" tone="inkSoft">
                  Space name
                </Txt>
                <TextInput
                  value={draft ?? name}
                  onChangeText={(t) => {
                    setDraft(t);
                    setSaved(false);
                  }}
                  placeholder="Space name…"
                  placeholderTextColor={colors.inkMuted}
                  style={[styles.input, { color: colors.ink, backgroundColor: colors.paperAlt, borderColor: colors.lineSoft }]}
                  autoCapitalize="words"
                  autoCorrect={false}
                  onSubmitEditing={save}
                  returnKeyType="done"
                />
                <Button label={saving ? 'Saving…' : 'Save'} variant="primary" size="md" disabled={saving} onPress={save} />
                {saved ? (
                  <View style={styles.meta}>
                    <Icon name="check" size={12} color={colors.success} />
                    <Txt variant="footnote" tone="inkMuted">
                      Saved.
                    </Txt>
                  </View>
                ) : null}
              </>
            ) : (
              <Txt variant="footnote" tone="inkMuted">
                Only the space owner can change these settings.
              </Txt>
            )}
          </Card>
        </>
      )}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  input: {
    height: spacing.controlMinHeight,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.body,
    fontSize: typeScale.body.fontSize,
  },
});
