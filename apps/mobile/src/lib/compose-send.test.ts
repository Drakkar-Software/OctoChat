/**
 * Tests for the composeSend orchestration helper. Guards the two reported symptoms:
 *   1. Attachment + empty text → nothing sent (the `!t && !attachment` guard in useRoom
 *      dropped the whole send when the ref was null because the encryptor was missing).
 *   2. Attachment + text → only text sent (the null ref was coalesced to undefined and
 *      `send` was called without the attachment).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { composeSend, type ComposeSendFile, type ComposeSendOptions } from './compose-send';
import type { AttachmentRef } from '@drakkar.software/octochat-sdk';

const FILE: ComposeSendFile = {
  bytes: new Uint8Array([1, 2, 3]),
  name: 'photo.jpg',
  mime: 'image/jpeg',
};

const REF: AttachmentRef = {
  blobId: 'blob-1',
  name: 'photo.jpg',
  mime: 'image/jpeg',
  size: 3,
  kind: 'image',
};

let send: ComposeSendOptions['send'];
let sendText: ComposeSendOptions['sendText'];
let uploadAttachment: ComposeSendOptions['uploadAttachment'];

beforeEach(() => {
  send = vi.fn() as ComposeSendOptions['send'];
  sendText = vi.fn(async () => {}) as ComposeSendOptions['sendText'];
  uploadAttachment = vi.fn(async () => REF) as ComposeSendOptions['uploadAttachment'];
});

// ── Happy paths ────────────────────────────────────────────────────────────────

describe('composeSend — file present', () => {
  it('uploads the file, then calls send with the ref', async () => {
    const result = await composeSend({ text: 'hello', file: FILE, uploadAttachment, send, sendText });
    expect(uploadAttachment).toHaveBeenCalledWith(FILE.bytes, FILE.name, FILE.mime);
    expect(send).toHaveBeenCalledWith('hello', undefined, REF);
    expect(sendText).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it('allows attachment-only send (empty text) — send is still called', async () => {
    // Guards symptom #1: attachment + empty text must send (not be dropped by the
    // `!t && !attachment` guard in use-room.ts send()).
    const result = await composeSend({ text: '', file: FILE, uploadAttachment, send, sendText });
    expect(send).toHaveBeenCalledWith('', undefined, REF);
    expect(result).toEqual({ ok: true });
  });

  it('threads parentId into send for thread replies', async () => {
    const result = await composeSend({ text: 'reply', file: FILE, parentId: 'msg-parent', uploadAttachment, send, sendText });
    expect(send).toHaveBeenCalledWith('reply', 'msg-parent', REF);
    expect(result).toEqual({ ok: true });
  });
});

// ── Upload failure path ────────────────────────────────────────────────────────

describe('composeSend — upload returns null (client not ready / network error)', () => {
  beforeEach(() => {
    uploadAttachment = vi.fn(async () => null) as ComposeSendOptions['uploadAttachment'];
  });

  it('does NOT call send when upload returns null (never silently drop the message)', async () => {
    // Guards symptom #2: the old code did `send(t, undefined, null ?? undefined)`,
    // which sent text-only. composeSend must NOT call send at all.
    const result = await composeSend({ text: 'hello', file: FILE, uploadAttachment, send, sendText });
    expect(send).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, attachmentFailed: true });
  });

  it('reports failure even for attachment-only send with empty text', async () => {
    const result = await composeSend({ text: '', file: FILE, uploadAttachment, send, sendText });
    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, attachmentFailed: true });
  });
});

// ── Text-only path ─────────────────────────────────────────────────────────────

describe('composeSend — no file', () => {
  it('calls sendText (offline outbox path) when no file is attached', async () => {
    const result = await composeSend({ text: 'hello', file: undefined, uploadAttachment, send, sendText });
    expect(sendText).toHaveBeenCalledWith('hello');
    expect(send).not.toHaveBeenCalled();
    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it('calls sendText even when text is empty (the guard lives in sendText/useRoom)', async () => {
    const result = await composeSend({ text: '', file: null, uploadAttachment, send, sendText });
    expect(sendText).toHaveBeenCalledWith('');
    expect(result).toEqual({ ok: true });
  });

  it('does not pass parentId to sendText (outbox routes it independently)', async () => {
    await composeSend({ text: 'hi', file: undefined, parentId: 'msg-parent', uploadAttachment, send, sendText });
    // sendText receives only the text; parentId is threaded through useRoomSend separately.
    expect(sendText).toHaveBeenCalledWith('hi');
  });
});

// ── Thread variant ─────────────────────────────────────────────────────────────

describe('composeSend — thread (parentId set)', () => {
  it('file + text + parentId → send called with all three', async () => {
    await composeSend({ text: 'threaded reply', file: FILE, parentId: 'msg-42', uploadAttachment, send, sendText });
    expect(send).toHaveBeenCalledWith('threaded reply', 'msg-42', REF);
  });

  it('file + empty text + parentId → attachment-only thread reply', async () => {
    await composeSend({ text: '', file: FILE, parentId: 'msg-42', uploadAttachment, send, sendText });
    expect(send).toHaveBeenCalledWith('', 'msg-42', REF);
  });

  it('text only + parentId → sendText (no parentId forwarded)', async () => {
    await composeSend({ text: 'text reply', file: undefined, parentId: 'msg-42', uploadAttachment, send, sendText });
    expect(sendText).toHaveBeenCalledWith('text reply');
    expect(send).not.toHaveBeenCalled();
  });
});
