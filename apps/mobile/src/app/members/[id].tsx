import { useCallback, useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { fonts, radii, spacing, type as typeScale } from '@/theme';
import { inviteMember, readMembers, revokeMember, type MemberRow } from '@/lib/starfish/members';
import { useSession } from '@/lib/session-context';
import { useTheme } from '@/lib/use-theme';
import { AppBar } from '@/components/ui/AppBar';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';

function copy(text: string) {
  try {
    (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => void } } }).navigator?.clipboard?.writeText?.(text);
  } catch {
    /* ignore */
  }
}

export default function MembersScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const roomId = params.id;
  const roomName = params.name ?? roomId;
  const { session } = useSession();

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [request, setRequest] = useState('');
  const [invite, setInvite] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!session) return;
    setMembers(await readMembers(session.chatClient, roomId));
  }, [session, roomId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async () => {
    if (!session || busy) return;
    setBusy(true);
    setError(null);
    try {
      const cap = await inviteMember(session, roomId, request.trim(), true);
      setInvite(cap);
      setRequest('');
      await refresh();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (m: MemberRow) => {
    if (!session || busy) return;
    setBusy(true);
    setError(null);
    try {
      await revokeMember(session, roomId, m);
      await refresh();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <StackScreen
      scroll
      contentStyle={styles.content}
      header={<AppBar title="Members" subtitle={`#${roomName}`} onBack={() => router.back()} />}
    >
      <Card title={`MEMBERS · ${members.length}`}>
        {members.length === 0 ? (
          <Txt variant="footnote" tone="inkMuted">
            Just you so far. Invite someone with their join request below.
          </Txt>
        ) : (
          members.map((m, i) => (
            <View key={m.nonce || m.userId}>
              {i > 0 ? <Divider style={styles.divider} /> : null}
              <View style={styles.memberRow}>
                <Avatar label={m.label.slice(0, 2).toUpperCase()} size={32} />
                <View style={styles.memberText}>
                  <Txt variant="callout" weight="semibold">
                    {m.label}
                  </Txt>
                  <Txt variant="caption" tone="inkMuted" mono>
                    {m.canWrite ? 'read · write' : 'read only'}
                  </Txt>
                </View>
                <Button label="Revoke" variant="danger" size="sm" onPress={() => revoke(m)} />
              </View>
            </View>
          ))
        )}
      </Card>

      <Card title="INVITE SOMEONE">
        <Txt variant="footnote" tone="inkSoft">
          Paste their join request (from “Join a room” on their device).
        </Txt>
        <TextInput
          value={request}
          onChangeText={setRequest}
          placeholder="Paste join request…"
          placeholderTextColor={colors.inkMuted}
          style={[styles.input, { color: colors.ink, backgroundColor: colors.paperAlt, borderColor: colors.lineSoft }]}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button label={busy ? 'Creating…' : 'Create invite'} variant="primary" size="md" disabled={busy} onPress={create} />
        {error ? (
          <Callout tone="danger" iconName="alert">
            {error}
          </Callout>
        ) : null}
        {invite ? (
          <View style={styles.inviteBox}>
            <Txt variant="micro" weight="semibold" mono uppercase tone="inkSoft">
              Invite cap — send to your invitee
            </Txt>
            <Txt variant="caption" mono tone="inkSoft" numberOfLines={4}>
              {invite}
            </Txt>
            {Platform.OS === 'web' ? (
              <Button label="Copy invite" variant="secondary" size="sm" iconName="copy" onPress={() => copy(invite)} />
            ) : null}
          </View>
        ) : null}
      </Card>
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg, paddingBottom: spacing.xxl },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 4 },
  memberText: { flex: 1, gap: 2 },
  divider: { marginVertical: spacing.xs },
  input: {
    minHeight: 64,
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.md,
    fontFamily: fonts.mono,
    fontSize: typeScale.caption.fontSize,
    textAlignVertical: 'top',
  },
  inviteBox: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, borderWidth: 0 },
});
