import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import type { PickedFile } from '@/lib/pick-file';

/**
 * Web-only: capture a file drop ANYWHERE on the window and hand it to `onFile`
 * as a {@link PickedFile}. Mirrors {@link useImagePaste} for drag-and-drop —
 * the composer absorbs the dropped file as its pending attachment, exactly like
 * a paste. On native there is no DOM drag/drop API, so the effect is a no-op.
 *
 * Why window-level: the room/thread screens take the full viewport, and dropping
 * "into the room" — not strictly onto the composer bar — is the expected UX.
 * Composer mounts only on those screens, so the listener teardown on navigation
 * away guarantees only the active conversation absorbs drops.
 *
 * Multi-file drops take the first item only, matching the single-slot pending
 * model already shared by paste and the OS file picker.
 */
export function useFileDrop(onFile: (file: PickedFile) => void) {
  // Hold the latest callback so the listener binds once but never goes stale.
  // The listener reads `.current` lazily at drop time, long after this commits.
  const onFileRef = useRef(onFile);
  useEffect(() => {
    onFileRef.current = onFile;
  });

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined') return;

    const onDragOver = (e: DragEvent) => {
      // `drop` only fires on the window if every preceding `dragover` calls
      // preventDefault — gate it on the file-bearing case so text drops into
      // form fields (e.g. dragging selected text into the composer) still work.
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault();
      }
    };
    const onDrop = (e: DragEvent) => {
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      e.preventDefault(); // otherwise the browser opens the dropped file in a new tab
      void file.arrayBuffer().then((buf) => {
        const ext = file.type ? file.type.split('/')[1] || '' : '';
        onFileRef.current({
          bytes: new Uint8Array(buf),
          name: file.name || `dropped-${Date.now()}${ext ? '.' + ext : ''}`,
          mime: file.type || 'application/octet-stream',
        });
      });
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
}
