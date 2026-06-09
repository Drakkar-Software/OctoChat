import { useCallback, useState, type MutableRefObject } from 'react';
import type { NativeSyntheticEvent, StyleProp, TextInputKeyPressEventData, TextStyle } from 'react-native';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { fonts, glowShadow, radii, spacing, type as typeScale } from '@/theme';
import { submitOnEnter } from '@/lib/composer-keys';
import { useDraft } from '@/lib/use-draft';
import { formatBytes } from '@drakkar.software/octochat-sdk';
import { tapFeedback } from '@/lib/haptics';
import { pickFile, type PickedFile } from '@/lib/pick-file';
import { COMPOSER_EMOJIS } from '@drakkar.software/octochat-sdk';
import { useEmojiAutocomplete } from '@/lib/use-emoji-autocomplete';
import { useFileDrop } from '@/lib/use-file-drop';
import { useImagePaste } from '@/lib/use-image-paste';
import { useTheme } from '@/lib/use-theme';
import { useReplySuggestion, type ReplySuggestionContext } from '@/lib/ai/use-reply-suggestion';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Txt } from '@/components/ui/Txt';

import { EmojiSuggestions } from './EmojiSuggestions';
import { ReplySuggestionChip } from './ReplySuggestionChip';

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
  /** Device is offline. Text still sends (it's queued in the outbox and shown as a
   *  pending bubble), but a file CAN'T be queued — so sending an attachment is
   *  blocked with a hint until the connection is back. */
  offline?: boolean;
  /** Context for on-device AI reply suggestions. Omit to disable the feature for
   *  this composer (e.g. thread replies, read-only rooms). */
  suggestionContext?: ReplySuggestionContext;
}

export type { ReplySuggestionContext };

/** Message input bar — attach a file, insert an emoji, and send. */
export function Composer({ placeholder, onSend, onEditLast, draftKey, offline, suggestionContext }: ComposerProps) {
  const { colors } = useTheme();
  const { text, setText, clearDraft } = useDraft(draftKey);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pending, setPending] = useState<PickedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const reply = useReplySuggestion(suggestionContext, { text, focused, setText });
  // Web only: paste a clipboard image straight into the pending attachment slot.
  const pasteRef = useImagePaste((file) => setPending(file));
  // Web only: drop ANY file onto the room/thread screen → pending attachment.
  // Window-level; only active while a Composer is mounted, so navigating away
  // from the room tears the listener down.
  useFileDrop((file) => setPending(file));
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
  // Offline with a file attached: text would queue fine, but the file can't — so
  // block the send (and surface a hint) until the connection is back.
  const fileBlocked = !!offline && !!pending;

  const submit = async () => {
    if (!hasContent || busy || fileBlocked) return;
    setBusy(true);
    reply.dismiss();
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
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={[styles.palette, { backgroundColor: colors.paperAlt, borderColor: colors.lineSoft }]}
          contentContainerStyle={styles.paletteRow}
        >
          {COMPOSER_EMOJIS.map((glyph) => (
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
        </ScrollView>
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

      {fileBlocked ? (
        <View style={styles.offlineHint}>
          <Icon name="clock" size={12} color={colors.warning} />
          <Txt variant="micro" color={colors.warning}>
            You’re offline — files send when you’re back online. Text sends now.
          </Txt>
        </View>
      ) : null}

      {/* AI reply suggestion chip — only mounted when generating/ready so it
          never reserves layout space or captures touches while idle. */}
      {reply.status !== 'idle' ? (
        <ReplySuggestionChip
          status={reply.status}
          action={reply.action}
          onAccept={reply.accept}
          onDismiss={reply.dismiss}
        />
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
            // Android's TextInput otherwise inherits the OS `textColorPrimary`
            // for the cursor/selection — invisible against the dark paperAlt in
            // dark mode and off-brand in light mode.
            selectionColor={colors.accent}
            cursorColor={colors.accent}
            underlineColorAndroid="transparent"
            style={[styles.input, WEB_OUTLINE_RESET, { color: colors.ink }]}
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
            accessibilityState={{ disabled: !hasContent || busy || fileBlocked }}
            accessibilityLabel="Send"
            disabled={!hasContent || busy || fileBlocked}
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
    // Single horizontal scroller — never wraps to a second line. flexGrow:0 keeps
    // the bar's height tight to one row of items instead of stretching.
    flexGrow: 0,
    marginBottom: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  paletteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.xs,
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
  offlineHint: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginBottom: spacing.sm },
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
    // On Android, elevation — not document order — decides which sibling draws
    // on top. When focused, `barGlow` gains elevation 8 (its glow shadow) and
    // would otherwise paint its opaque paperAlt fill OVER this bar, hiding the
    // typed text (iOS ignores elevation, so it was fine there). A STATIC
    // elevation above the glow's keeps the input on top; static (never toggled
    // on focus) so it doesn't eat the focus event. No own shadow: bg is transparent.
    // `shadowColor: transparent` suppresses the grey elevation drop-shadow Android
    // casts from any elevated view (API 28+ tints elevation shadows) — otherwise it
    // shows as a dark box behind the bar in light mode (invisible in dark mode).
    elevation: 9,
    shadowColor: 'transparent',
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
