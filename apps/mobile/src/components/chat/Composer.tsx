import { useCallback, useState, type MutableRefObject } from 'react';
import type { NativeSyntheticEvent, StyleProp, TextInputKeyPressEventData, TextStyle } from 'react-native';
import { ActivityIndicator, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { fonts, glowShadow, radii, spacing, type as typeScale } from '@/theme';
import { submitOnEnter } from '@/lib/composer-keys';
import { useDraft } from '@/lib/use-draft';
import { formatBytes } from '@/lib/format';
import { tapFeedback } from '@/lib/haptics';
import { pickFile, type PickedFile } from '@/lib/pick-file';
import { QUICK_REACTIONS } from '@/lib/reactions';
import { useEmojiAutocomplete } from '@/lib/use-emoji-autocomplete';
import { useImagePaste } from '@/lib/use-image-paste';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Txt } from '@/components/ui/Txt';

import { EmojiSuggestions } from './EmojiSuggestions';

// Web-only: drop the UA focus outline; the bar itself lifts to an accent ring on focus.
const WEB_OUTLINE_RESET = (Platform.OS === 'web' ? { outlineStyle: 'none' } : null) as unknown as StyleProp<TextStyle>;

interface ComposerProps {
  placeholder: string;
  /** Send text and/or a picked file. May be async (e.g. while the file uploads). */
  onSend?: (text: string, file?: PickedFile) => void | Promise<void>;
  /** Edit the viewer's last message — wired to ArrowUp on an empty composer (web).
   *  Omit to disable the shortcut (e.g. nothing editable here). */
  onEditLast?: () => void;
  /** kv key under which to persist the unsent text as a local draft (survives
   *  refresh and re-entry). Omit to keep the input ephemeral. */
  draftKey?: string;
}

/** Message input bar — attach a file, insert an emoji, and send. */
export function Composer({ placeholder, onSend, onEditLast, draftKey }: ComposerProps) {
  const { colors } = useTheme();
  const { text, setText, clearDraft } = useDraft(draftKey);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pending, setPending] = useState<PickedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  // Web only: paste a clipboard image straight into the pending attachment slot.
  const pasteRef = useImagePaste((file) => setPending(file));
  // `:shortcode:` emoji autocomplete — tracks the caret and swaps the typed token
  // for a glyph. Shares the same <TextInput> node as the paste listener.
  const emoji = useEmojiAutocomplete(text, setText);
  const setInputRef = useCallback(
    (node: TextInput | null) => {
      (pasteRef as MutableRefObject<TextInput | null>).current = node;
      (emoji.inputRef as MutableRefObject<TextInput | null>).current = node;
    },
    [pasteRef, emoji.inputRef],
  );
  const hasContent = text.trim().length > 0 || !!pending;

  const submit = async () => {
    if (!hasContent || busy) return;
    setBusy(true);
    try {
      await onSend?.(text.trim(), pending ?? undefined);
      clearDraft();
      setPending(null);
      setEmojiOpen(false);
    } finally {
      setBusy(false);
    }
  };

  // Let the emoji popup capture Arrow/Enter/Tab/Escape first (web); otherwise fall
  // through to the composer's submit + edit-last shortcuts.
  const onComposerKey = submitOnEnter(submit, onEditLast, () => !hasContent);
  const handleKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (emoji.onKeyPress(e)) return;
    onComposerKey?.(e);
  };

  const attach = async () => {
    tapFeedback();
    const file = await pickFile();
    if (file) setPending(file);
  };

  const insertEmoji = (emoji: string) => {
    tapFeedback();
    setText((t) => t + emoji);
  };

  return (
    <View style={[styles.wrap, { backgroundColor: colors.paper, borderTopColor: colors.lineSoft }]}>
      {emoji.open ? (
        <EmojiSuggestions
          suggestions={emoji.suggestions}
          activeIndex={emoji.activeIndex}
          onChoose={emoji.choose}
          onHover={emoji.setActive}
        />
      ) : null}

      {emojiOpen && !emoji.open ? (
        <View style={[styles.palette, { backgroundColor: colors.paperAlt, borderColor: colors.lineSoft }]}>
          {QUICK_REACTIONS.map((glyph) => (
            <Pressable
              key={glyph}
              accessibilityRole="button"
              accessibilityLabel={`Insert ${glyph}`}
              onPress={() => insertEmoji(glyph)}
              style={styles.paletteItem}
            >
              <Txt variant="subhead">{glyph}</Txt>
            </Pressable>
          ))}
        </View>
      ) : null}

      {pending ? (
        <View style={[styles.pending, { backgroundColor: colors.paperAlt, borderColor: colors.lineSoft }]}>
          <View style={[styles.pendingIcon, { backgroundColor: colors.accentBg, borderColor: colors.accentBorder }]}>
            <Icon name={pending.mime.startsWith('image/') ? 'image' : 'file'} size={15} color={colors.accent} />
          </View>
          <View style={styles.pendingText}>
            <Txt variant="footnote" weight="medium" numberOfLines={1}>
              {pending.name}
            </Txt>
            <Txt variant="micro" mono tone="inkMuted">
              {formatBytes(pending.bytes.length)}
            </Txt>
          </View>
          <IconButton name="x" size={14} accessibilityLabel="Remove attachment" onPress={() => setPending(null)} />
        </View>
      ) : null}

      {/* Glow lives on an absolutely-positioned sibling, not on the TextInput's
          ancestor. On Android, flipping `elevation` on an ancestor during the
          focus commit creates a new native render layer and eats the focus event
          — the keyboard opens and dismisses immediately. Same fix as TextField. */}
      <View style={styles.barWrap}>
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.barGlow,
            { backgroundColor: colors.paperAlt },
            focused ? glowShadow(colors.glow, 0.22, 12) : null,
          ]}
        />
        <View
          style={[
            styles.bar,
            { borderColor: focused ? colors.accentBorder : colors.lineSoft },
          ]}
        >
          <IconButton name="plus" size={18} color={colors.inkSoft} accessibilityLabel="Attach a file" onPress={attach} />
          <TextInput
            ref={setInputRef}
            value={text}
            onChangeText={setText}
            onSelectionChange={emoji.onSelectionChange}
            placeholder={placeholder}
            placeholderTextColor={colors.inkMuted}
            style={[styles.input, { color: colors.ink }, WEB_OUTLINE_RESET]}
            multiline
            numberOfLines={1}
            editable={!busy}
            onKeyPress={handleKeyPress}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          <IconButton
            name="smile"
            size={18}
            color={emojiOpen ? colors.accent : colors.inkSoft}
            accessibilityLabel="Insert emoji"
            onPress={() => {
              tapFeedback();
              setEmojiOpen((v) => !v);
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !hasContent || busy }}
            accessibilityLabel="Send"
            disabled={!hasContent || busy}
            onPress={submit}
            style={({ pressed }) => [
              styles.send,
              { backgroundColor: colors.fill },
              hasContent ? glowShadow(colors.glow, 0.3, 7) : null,
              pressed && hasContent ? styles.sendPressed : null,
            ]}
          >
            {hasContent ? (
              <LinearGradient colors={[colors.accentGradTop, colors.accentGradBottom]} style={[StyleSheet.absoluteFill, styles.sendFill]} />
            ) : null}
            {busy ? (
              <ActivityIndicator size="small" color={colors.onAccent} />
            ) : (
              <Icon name="send" size={15} color={hasContent ? colors.onAccent : colors.inkMuted} />
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
  },
  palette: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    marginBottom: spacing.sm,
    padding: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  paletteItem: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  pending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    marginBottom: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  pendingIcon: {
    width: 30,
    height: 30,
    borderRadius: radii.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingText: { flexShrink: 1, minWidth: 0 },
  barWrap: {},
  barGlow: { borderRadius: radii.sheet },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
    paddingLeft: spacing.md,
    paddingRight: 6,
    borderRadius: radii.sheet,
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  input: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: typeScale.body.fontSize,
    maxHeight: 96,
    paddingTop: 0,
    paddingBottom: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  send: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Tactile press dip on the send button (web + native), via Pressable's `pressed`.
  sendPressed: { transform: [{ scale: 0.9 }] },
  sendFill: { borderRadius: 17 },
});
