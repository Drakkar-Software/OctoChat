import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { radii, spacing } from '@/theme';
import type { Attachment as AttachmentModel } from '@/lib/types';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { Txt } from '@/components/ui/Txt';

/** Marine gradient stand-in for real media — reads as a thumbnail, not a box. */
function MediaSurface({ ratio, children }: { ratio: number; children?: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <LinearGradient
      colors={[colors.accentSoft, colors.fillDeep, colors.fill]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.media, { aspectRatio: ratio }]}
    >
      {children}
    </LinearGradient>
  );
}

function ImageAttachment({ label, ratio }: { label: string; ratio: number }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.frame, { borderColor: colors.lineFaint }]}>
      <MediaSurface ratio={ratio}>
        <Icon name="image" size={26} color={colors.accentInk} />
      </MediaSurface>
      <View style={styles.caption}>
        <Pill label={label} iconName="image" mono />
      </View>
    </View>
  );
}

function VideoAttachment({ label, duration, ratio = 16 / 9 }: { label: string; duration: string; ratio?: number }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.frame, { borderColor: colors.lineFaint }]}>
      <MediaSurface ratio={ratio}>
        <View style={[styles.play, { backgroundColor: colors.scrim }]}>
          <Icon name="video" size={20} color="#ffffff" />
        </View>
      </MediaSurface>
      <View style={styles.caption}>
        <Pill label={`${label} · ${duration}`} iconName="video" mono />
      </View>
    </View>
  );
}

function FileCard({ name, meta }: { name: string; meta: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.fileRow, { backgroundColor: colors.paperAlt, borderColor: colors.lineSoft }]}>
      <View style={[styles.fileIcon, { backgroundColor: colors.accentBg, borderColor: colors.accentBorder }]}>
        <Icon name="file" size={18} color={colors.accent} />
      </View>
      <View style={styles.fileText}>
        <Txt variant="callout" weight="semibold" numberOfLines={1}>
          {name}
        </Txt>
        <Txt variant="caption" tone="inkMuted" mono numberOfLines={1}>
          {meta}
        </Txt>
      </View>
      <Icon name="chev" size={16} color={colors.inkMuted} />
    </View>
  );
}

function LinkCard({ title, domain, blurb }: { title: string; domain: string; blurb: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.linkRow, { backgroundColor: colors.paperAlt, borderColor: colors.lineSoft }]}>
      <LinearGradient
        colors={[colors.accent, colors.accentStrong]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.linkThumb}
      >
        <Icon name="link" size={18} color="#ffffff" />
      </LinearGradient>
      <View style={styles.linkText}>
        <Txt variant="micro" weight="semibold" mono uppercase tone="accent">
          {domain}
        </Txt>
        <Txt variant="callout" weight="semibold" numberOfLines={2}>
          {title}
        </Txt>
        <Txt variant="caption" tone="inkMuted" numberOfLines={2}>
          {blurb}
        </Txt>
      </View>
    </View>
  );
}

/** Renders any message attachment by kind. */
export function Attachment({ data }: { data: AttachmentModel }) {
  switch (data.kind) {
    case 'image':
      return <ImageAttachment label={data.label} ratio={data.ratio} />;
    case 'video':
      return <VideoAttachment label={data.label} duration={data.duration} />;
    case 'file':
      return <FileCard name={data.name} meta={data.meta} />;
    case 'link':
      return <LinkCard title={data.title} domain={data.domain} blurb={data.blurb} />;
  }
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
    marginTop: 4,
  },
  media: {
    width: '100%',
    maxHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  play: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: { position: 'absolute', left: spacing.sm, bottom: spacing.sm },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    marginTop: 4,
  },
  fileIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileText: { flex: 1, gap: 2 },
  linkRow: {
    flexDirection: 'row',
    borderRadius: radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
    marginTop: 4,
  },
  linkThumb: { width: 60, alignItems: 'center', justifyContent: 'center' },
  linkText: { flex: 1, padding: spacing.md, gap: 3 },
});
