import * as DocumentPicker from 'expo-document-picker';

/** A file the user picked, read fully into memory for sealing + upload. */
export interface PickedFile {
  bytes: Uint8Array;
  name: string;
  mime: string;
}

/**
 * Open the OS file picker and read the chosen file into memory.
 *
 * expo-document-picker is universal (web, iOS, Android), so this is a single
 * implementation. Bytes are read via `fetch(uri)` — a blob/data URL on web, a
 * `file://` URI on native — giving the same in-memory shape on every platform.
 *
 * `accept` is a MIME filter for the OS picker (e.g. `'image/*'`); defaults to any.
 */
export async function pickFile(accept = '*/*'): Promise<PickedFile | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: accept, copyToCacheDirectory: true });
  const asset = res.canceled ? undefined : res.assets?.[0];
  if (!asset) return null;
  const buf = await (await fetch(asset.uri)).arrayBuffer();
  return {
    bytes: new Uint8Array(buf),
    name: asset.name,
    mime: asset.mimeType ?? 'application/octet-stream',
  };
}
