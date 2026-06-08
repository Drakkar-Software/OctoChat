import { describe, expect, it } from 'vitest';

import { APP_NAME, notificationTitle, roomDisplayName } from './notification-format';

describe('roomDisplayName', () => {
  it('prefixes channels and automations with #, leaves DMs bare', () => {
    expect(roomDisplayName('general', 'channel')).toBe('#general');
    expect(roomDisplayName('digest', 'automated')).toBe('#digest');
    expect(roomDisplayName('Alice', 'dm')).toBe('Alice');
    expect(roomDisplayName('general')).toBe('#general'); // unknown kind → channel-style
  });
});

describe('notificationTitle', () => {
  it('joins space and room as "Space › #room"', () => {
    expect(notificationTitle('Design', 'general', 'channel')).toBe('Design › #general');
    expect(notificationTitle('Design', 'Alice', 'dm')).toBe('Design › Alice');
  });

  it('degrades to whichever part resolved', () => {
    expect(notificationTitle(null, 'general', 'channel')).toBe('#general'); // room only
    expect(notificationTitle('Design', null)).toBe('Design'); // space only (roomless push)
  });

  it('falls back to the app name when neither name resolves', () => {
    expect(notificationTitle(null, null)).toBe(APP_NAME);
    expect(notificationTitle(undefined, undefined)).toBe(APP_NAME);
  });
});
