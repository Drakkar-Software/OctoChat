import { type RefObject, useEffect, useRef } from 'react';
import { Platform, type TextInput } from 'react-native';

import type { PickedFile } from '@/lib/pick-file';

/**
 * Web-only: let the composer accept a pasted image as an attachment.
 *
 * Accepts a `ref` pointing at the composer's `<TextInput>`. On web the input
 * renders a real DOM `<textarea>`, so we listen for its native `paste` event
 * and, when the clipboard carries an image, read it into a {@link PickedFile}
 * and hand it to `onImage` (text pastes fall through untouched). On native there
 * is no paste-into-field gesture, so the effect is a no-op.
 */
export function useImagePaste(ref: RefObject<TextInput | null>, onImage: (file: PickedFile) => void) {
  // Hold the latest callback so the listener binds once but never goes stale.
  // Refresh after each render (not during — that trips react-hooks/refs); the
  // listener reads `.current` lazily at paste time, long after this commits.
  const onImageRef = useRef(onImage);
  useEffect(() => {
    onImageRef.current = onImage;
  });

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node?.addEventListener) return;

    const onPaste = (event: Event) => {
      const items = (event as ClipboardEvent).clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (!file) continue;
        event.preventDefault(); // keep the image out of the text field
        void file.arrayBuffer().then((buf) => {
          const ext = file.type.split('/')[1] || 'png';
          onImageRef.current({
            bytes: new Uint8Array(buf),
            name: file.name || `pasted-${Date.now()}.${ext}`,
            mime: file.type || 'image/png',
          });
        });
        return;
      }
    };

    node.addEventListener('paste', onPaste);
    return () => node.removeEventListener('paste', onPaste);
  }, [ref]);
}
