import { useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { layout, radii, spacing } from '@/theme';
import { formatBytes } from '@drakkar.software/octochat-sdk';
import { saveAttachment } from '@/lib/save-attachment';
import { impactFeedback } from '@/lib/haptics';
import type { AttachmentRef } from '@drakkar.software/octochat-sdk';
import { useAttachmentImage } from '@/lib/use-attachment-image';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { Lightbox } from '@/components/ui/Lightbox';
import { Skeleton } from '@/components/ui/Skeleton';
import { Txt } from '@/components/ui/Txt';

// Inline-image height bounds derived from the width cap (no new theme constants):
// never taller than the cap is wide (a square ceiling, so portrait shots stay in
// the stream), and a 3:4 default footprint before the true ratio is measured.
const IMAGE_MAX_HEIGHT = layout.chatImageMaxWidth;
const IMAGE_FALLBACK_HEIGHT = Math.round((layout.chatImageMaxWidth * 3) / 4);

interface AttachmentViewProps {
  attachment: AttachmentRef;
  /** Fetch + decrypt the blob's bytes (bound to the room by the hook). */
  onLoad?: (ref: AttachmentRef) => Promise<Uint8Array | null>;
}

/** Renders a message attachment: image thumbnails decrypt in place; other files
 *  show a card that fetches + downloads on press. All bytes are E2EE at rest. */
export function AttachmentView({ attachment, onLoad }: AttachmentViewProps) {
  const { colors } = useTheme();
  const win = useWindowDimensions();
  const isImage = attachment.kind === 'image';
  const [busy, setBusy] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  // Decrypt → URI lifecycle with retry: images decrypt eagerly so they show
  // inline (files fetch only on download). `ratio` is the intrinsic aspect
  // (height ÷ width), measured once ready so the thumbnail keeps the photo's true
  // shape inside the width cap; `retry` re-attempts a failed load.
  const { uri, failed, ratio, retry } = useAttachmentImage(attachment, isImage, onLoad);

  const handleSave = async () => {
    if (!onLoad) return;
    const bytes = await onLoad(attachment);
    if (bytes) await saveAttachment(bytes, attachment.name, attachment.mime);
  };

  const handleLightboxDownload = uri
    ? Platform.OS === 'web'
      ? () => {
          const a = document.createElement('a');
          a.href = uri;
          a.download = attachment.name;
          a.click();
        }
      : () => { void handleSave(); }
    : undefined;

  if (isImage) {
    // Cap the inline thumbnail's width; preserve the photo's true aspect within it
    // (capping the height too so a tall screenshot doesn't dominate the stream).
    const boxWidth = layout.chatImageMaxWidth;
    const boxHeight = ratio != null ? Math.min(Math.round(boxWidth * ratio), IMAGE_MAX_HEIGHT) : IMAGE_FALLBACK_HEIGHT;
    const sizing = { width: boxWidth, maxWidth: '100%' as const, height: boxHeight };
    const boxStyle = [styles.imageBox, sizing, { backgroundColor: colors.fill, borderColor: colors.lineFaint }];
    if (!uri) {
      return failed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Retry loading ${attachment.name}`}
          onPress={retry}
          style={[styles.imageBox, sizing, styles.imageFail, { backgroundColor: colors.fill, borderColor: colors.lineFaint }]}
        >
          <Icon name="image" size={18} color={colors.inkMuted} />
          <Txt variant="micro" tone="inkMuted">
            Couldn&apos;t load image · tap to retry
          </Txt>
        </Pressable>
      ) : (
        // Shimmering placeholder that matches the app's loading language and the
        // thumbnail's footprint (width-capped; default height until measured).
        <Skeleton width={boxWidth} height={boxHeight} radius={radii.md} shimmer style={styles.imageSkeleton} />
      );
    }
    return (
      <>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View ${attachment.name} larger`}
          onPress={() => setZoomed(true)}
          onLongPress={Platform.OS !== 'web' ? () => { impactFeedback(); void handleSave(); } : undefined}
          delayLongPress={260}
          style={boxStyle}
        >
          {/* contain preserves aspect within the measured box (the box already
              matches the image ratio, so it fills edge-to-edge without cropping). */}
          <Image source={{ uri }} style={styles.image} resizeMode="contain" accessibilityLabel={attachment.name} />
        </Pressable>
        <Lightbox visible={zoomed} onClose={() => setZoomed(false)} closeLabel={`Close ${attachment.name} preview`} onDownload={handleLightboxDownload} downloadLabel={`Save ${attachment.name}`}>
          {/* Fractions of the viewport keep the full image on-screen; contain preserves aspect. */}
          <Image
            source={{ uri }}
            style={{ width: win.width * 0.92, height: win.height * 0.82 }}
            resizeMode="contain"
            accessibilityLabel={attachment.name}
          />
        </Lightbox>
      </>
    );
  }

  const download = async () => {
    if (busy || !onLoad) return;
    setBusy(true);
    try {
      const bytes = await onLoad(attachment);
      if (bytes) await saveAttachment(bytes, attachment.name, attachment.mime);
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
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageSkeleton: { marginTop: spacing.xs, maxWidth: '100%' },
  // Failed-to-decrypt slot: a small image glyph over the label for parity with the
  // file card's icon treatment.
  imageFail: { gap: spacing.xs },
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
