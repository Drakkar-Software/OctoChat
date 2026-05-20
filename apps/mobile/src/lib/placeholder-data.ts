/**
 * Placeholder data for the frontend-only build. Content mirrors the OctoChat
 * wireframes (Octopus Collective space, #design-crit room, Maya Liu profile).
 * Swap these selectors for real encrypted data sources later.
 */

import type {
  Message,
  Profile,
  Room,
  Space,
  Thread,
  User,
} from './types';

export const SEED_WORDS = [
  'anchor', 'bluefin', 'coral', 'drift',
  'estuary', 'fathom', 'grotto', 'harbor',
  'isobath', 'kelp', 'lagoon', 'mariana',
] as const;

export const FINGERPRINT = 'F7C2 · 9A1E · 88BD';

const maya: User = { id: 'u-maya', name: 'Maya Liu', handle: '@maya', initials: 'ML', presence: 'online' };
const alex: User = { id: 'u-alex', name: 'Alex Park', handle: '@alex', initials: 'AP', presence: 'online' };
const kai: User = { id: 'u-kai', name: 'Kai Ravi', handle: '@kai', initials: 'KR', presence: 'away' };
const pat: User = { id: 'u-pat', name: 'Pat Okonkwo', handle: '@pat', initials: 'PO', presence: 'dnd' };

export const CURRENT_USER = maya;

const USERS: Record<string, User> = {
  [maya.id]: maya,
  [alex.id]: alex,
  [kai.id]: kai,
  [pat.id]: pat,
};

export function getUser(id: string): User {
  return USERS[id] ?? maya;
}

export const SPACES: Space[] = [
  { id: 's-oc', name: 'Octopus Collective', short: 'OC', members: 14 },
  { id: 's-mp', name: 'Mariana Press', short: 'MP', members: 6, unread: 3 },
  { id: 's-rd', name: 'Reef Design', short: 'RD', members: 23 },
  { id: 's-ck', name: 'Curiosity Kitchen', short: 'CK', members: 4, unread: 12 },
];

export const ACTIVE_SPACE_ID = 's-oc';

export function getSpace(id: string): Space {
  return SPACES.find((s) => s.id === id) ?? SPACES[0]!;
}

/** Rooms of the active space, in render order; `category` buckets them. */
export const ROOMS: Room[] = [
  { id: 'r-announcements', spaceId: 's-oc', category: 'PINNED', name: 'announcements', kind: 'channel' },
  { id: 'r-random', spaceId: 's-oc', category: 'PINNED', name: 'random', kind: 'channel' },

  { id: 'r-design-crit', spaceId: 's-oc', category: 'DESIGN', name: 'design-crit', kind: 'channel', topic: 'Critiques & feedback on in-flight work' },
  { id: 'r-figma-feed', spaceId: 's-oc', category: 'DESIGN', name: 'figma-feed', kind: 'channel', unread: 4, mention: true },
  { id: 'r-icons', spaceId: 's-oc', category: 'DESIGN', name: 'icons', kind: 'channel' },

  { id: 'r-backend', spaceId: 's-oc', category: 'ENGINEERING', name: 'backend', kind: 'channel', unread: 12 },
  { id: 'r-frontend', spaceId: 's-oc', category: 'ENGINEERING', name: 'frontend', kind: 'channel' },
  { id: 'r-sec-incident', spaceId: 's-oc', category: 'ENGINEERING', name: 'sec-incident', kind: 'private', unread: 1, mention: true },

  { id: 'r-dm-alex', spaceId: 's-oc', category: 'DIRECT MESSAGES', name: 'Alex Park', kind: 'dm', avatar: 'AP' },
  { id: 'r-dm-kai', spaceId: 's-oc', category: 'DIRECT MESSAGES', name: 'K. Ravi', kind: 'dm', avatar: 'KR', unread: 2 },
  { id: 'r-dm-squad', spaceId: 's-oc', category: 'DIRECT MESSAGES', name: 'design squad (3)', kind: 'dm', avatar: 'DS' },
];

export const CATEGORY_ORDER = ['PINNED', 'DESIGN', 'ENGINEERING', 'DIRECT MESSAGES'] as const;

export function getRoom(id: string): Room {
  return ROOMS.find((r) => r.id === id) ?? ROOMS[2]!;
}

export interface RoomCategory {
  name: string;
  rooms: Room[];
}

export function getRoomsByCategory(): RoomCategory[] {
  return CATEGORY_ORDER.map((name) => ({
    name,
    rooms: ROOMS.filter((r) => r.category === name),
  })).filter((c) => c.rooms.length > 0);
}

/** Total unread across the active space, for the rooms tab badge. */
export function totalUnread(): number {
  return ROOMS.reduce((sum, r) => sum + (r.unread ?? 0), 0);
}

const PARENT_MESSAGE_ID = 'm-1';

const MESSAGES: Record<string, Message[]> = {
  'r-design-crit': [
    {
      id: PARENT_MESSAGE_ID,
      roomId: 'r-design-crit',
      authorId: alex.id,
      time: '09:08',
      text: 'Latest mock for the channel switcher — falling back to list + peek panel.',
      attachment: { kind: 'image', label: 'mockup.png', ratio: 16 / 9 },
      reactions: [
        { emoji: '🐙', count: 4, mine: true },
        { emoji: '👀', count: 2 },
      ],
      threadCount: 6,
    },
    {
      id: 'm-2',
      roomId: 'r-design-crit',
      authorId: kai.id,
      time: '09:14',
      text: "here's the security audit — skim §3 before standup",
      attachment: { kind: 'file', name: 'security-audit-q2.pdf', meta: 'PDF · 1.4 MB · encrypted' },
      unreadBefore: true,
    },
    {
      id: 'm-3',
      roomId: 'r-design-crit',
      authorId: maya.id,
      time: '09:21',
      text: '§3 raised a question about the recovery flow:',
      attachment: {
        kind: 'link',
        title: 'Recovery seeds & social backup — a comparison',
        domain: 'eprint.iacr.org',
        blurb: 'Trade-offs between 12-word seeds, Shamir splits, and hardware attestation.',
      },
      reactions: [{ emoji: '✅', count: 3 }],
      mention: true,
    },
  ],
};

export function getMessages(roomId: string): Message[] {
  return MESSAGES[roomId] ?? MESSAGES['r-design-crit']!;
}

const THREADS: Record<string, Thread> = {
  't-1': {
    id: 't-1',
    roomId: 'r-design-crit',
    parentId: PARENT_MESSAGE_ID,
    replies: [
      {
        id: 'tr-1',
        roomId: 'r-design-crit',
        authorId: maya.id,
        time: '09:12',
        text: 'love the peek panel idea. does keyboard nav land you in the panel or the list?',
      },
      {
        id: 'tr-2',
        roomId: 'r-design-crit',
        authorId: alex.id,
        time: '09:14',
        text: 'peek follows focus — esc back to list. trying it now',
        reactions: [{ emoji: '💯', count: 2, mine: true }],
      },
      {
        id: 'tr-3',
        roomId: 'r-design-crit',
        authorId: kai.id,
        time: '09:18',
        text: "+1, and could the peek be its own scroll region so long DM threads don't push it off-screen?",
      },
    ],
  },
};

export function getThread(id: string): Thread {
  return THREADS[id] ?? THREADS['t-1']!;
}

/** The thread anchored to a given parent message, if any. */
export function getThreadForMessage(messageId: string): Thread | undefined {
  return Object.values(THREADS).find((t) => t.parentId === messageId);
}

export function getParentMessage(thread: Thread): Message {
  return getMessages(thread.roomId).find((m) => m.id === thread.parentId) ?? getMessages(thread.roomId)[0]!;
}

export const PROFILE: Profile = {
  user: maya,
  pronouns: 'she / her',
  description: 'Senior designer · Lisbon · likes pelagic invertebrates',
  status: '🐙 deep in design',
  fingerprint: FINGERPRINT,
  security: [
    { id: 'sec-seed', icon: 'shield', title: 'Recovery seed', detail: 'Verified · last backed up Apr 12', level: 'verified' },
    { id: 'sec-devices', icon: 'devices', title: 'Devices', detail: '3 active · iPhone, MacBook, Office desktop', level: 'verified' },
    { id: 'sec-fp', icon: 'key', title: 'Identity fingerprint', detail: FINGERPRINT, level: 'verified', mono: true },
  ],
};

export const EMOJI_QUICK = ['🐙', '👀', '💯', '✅', '🦑'] as const;
