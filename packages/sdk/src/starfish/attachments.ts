export type { ByteSealer, AttachmentRef, AttachmentStore } from '@drakkar.software/octospaces-sdk';
export { MAX_ATTACHMENT_BYTES, attachmentKind, createAttachmentStore } from '@drakkar.software/octospaces-sdk';

import { createAttachmentStore } from '@drakkar.software/octospaces-sdk';

const _store = createAttachmentStore({
  persistPrefix: 'octochat.attach.blob.',
  persistIndex: 'octochat.attach.index',
});

export const { uploadAttachment, loadAttachment, clearAttachmentCache } = _store;
