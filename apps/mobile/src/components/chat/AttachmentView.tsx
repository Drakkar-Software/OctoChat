import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import { getBase64 } from '@drakkar.software/starfish-protocol';

import { radii, spacing } from '@/theme';
import { formatBytes } from '@/lib/format';
import type { AttachmentRef } from '@/lib/starfish/attachments';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

/** Decrypted bytes → a renderable URI. Web uses an object URL; native a data URI. */
function bytesToUri(bytes: Uint8Array, mime: string): string {
  if (Platform.OS === 'web') return URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  return `data:${mime};base64,${getBase64().encode(bytes)}`;
}

function triggerDownload(uri: string, name: string): void {
  if (Platform.OS !== 'web') return;
  const a = document.createElement('a');
  a.href = uri;
  a.download = name;
  a.click();
}

interface AttachmentViewProps {
  attachment: AttachmentRef;
  /** Fetch + decrypt the blob's bytes (bound to the room by the hook). */
  onLoad?: (ref: AttachmentRef) => Promise<Uint8Array | null>;
}

/** Renders a message attachment: image thumbnails decrypt in place; other files
 *  show a card that fetches + downloads on press. All bytes are E2EE at rest. */
export function AttachmentView({ attachment, onLoad }: AttachmentViewProps) {
  const { colors } = useTheme();
  const isImage = attachment.kind === 'image';
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Images decrypt eagerly so they show inline; files fetch only on download.
  useEffect(() => {
    if (!isImage || !onLoad) return;
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const bytes = await onLoad(attachment);
        if (cancelled || !bytes) {
          if (!cancelled) setFailed(true);
          return;
        }
        url = bytesToUri(bytes, attachment.mime);
        setUri(url);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (url && Platform.OS === 'web') URL.revokeObjectURL(url);
    };
  }, [attachment, isImage, onLoad]);

  if (isImage) {
    return (
      <View style={[styles.imageBox, { backgroundColor: colors.fill, borderColor: colors.lineFaint }]}>
        {uri ? (
          <Image source={{ uri }} style={styles.image} resizeMode="cover" accessibilityLabel={attachment.name} />
        ) : failed ? (
          <Txt variant="micro" tone="inkMuted">
            Couldn&apos;t load image
          </Txt>
        ) : (
          <ActivityIndicator color={colors.accent} />
        )}
      </View>
    );
  }

  const download = async () => {
    if (busy || !onLoad) return;
    setBusy(true);
    try {
      const bytes = await onLoad(attachment);
      if (bytes) triggerDownload(bytesToUri(bytes, attachment.mime), attachment.name);
    } catch {
      /* surfaced by the disabled state resetting; user can retry */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Download ${attachment.name}`}
      onPress={download}
      style={[styles.fileCard, { backgroundColor: colors.paperAlt, borderColor: colors.lineFaint }]}
    >
      <View style={[styles.fileIcon, { backgroundColor: colors.fillDeep }]}>
        <Icon name="file" size={18} color={colors.inkSoft} />
      </View>
      <View style={styles.fileText}>
        <Txt variant="footnote" weight="medium" numberOfLines={1}>
          {attachment.name}
        </Txt>
        <Txt variant="micro" mono tone="inkMuted">
          {formatBytes(attachment.size)} · encrypted
        </Txt>
      </View>
      {busy ? <ActivityIndicator size="small" color={colors.accent} /> : <Icon name="arrow-r" size={15} color={colors.accent} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  imageBox: {
    marginTop: spacing.xs,
    width: 260,
    maxWidth: '100%',
    height: 180,
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  fileCard: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    alignSelf: 'flex-start',
    maxWidth: 320,
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  fileIcon: { width: 34, height: 40, borderRadius: radii.xs, alignItems: 'center', justifyContent: 'center' },
  fileText: { flexShrink: 1, minWidth: 0 },
});
