/**
 * Faux content for the **Work** placeholder detail screens — a believable doc
 * page and a believable project board, so tapping a row previews *what the
 * feature will look like* rather than an empty/loading state. None of it is
 * real or persisted; it's swapped for live data when Docs/Projects ship. Lives
 * in `lib` so the screens stay declarative (see {@link DocPlaceholder} /
 * {@link ProjectPlaceholder}).
 */
import type { PillTone } from '@/components/ui/Pill';

// ── Doc viewer ──────────────────────────────────────────────────────────────

export type DocBlock =
  | { type: 'h2'; text: string }
  | { type: 'p'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'bullets'; items: string[] };

/** A short, on-theme article body — reads as a real page at any doc title. */
export const DOC_BODY: DocBlock[] = [
  {
    type: 'p',
    text: 'This page lives in your space’s encrypted knowledge base. Every block is sealed with the room keyring before it leaves your device, so the server stores ciphertext it can never read.',
  },
  { type: 'h2', text: 'Overview' },
  {
    type: 'p',
    text: 'Docs sit beside your conversations, sharing the same members and the same end-to-end encryption. Mention a teammate, link a channel, or pin a page to a room — the access list is the keyring, nothing more.',
  },
  {
    type: 'quote',
    text: 'Zero-knowledge by default: the people in the room are the only ones who can read what’s in it.',
  },
  { type: 'h2', text: 'What lands here' },
  {
    type: 'bullets',
    items: [
      'A block editor with headings, lists, callouts and code.',
      'Live presence and cursors, sealed per keystroke.',
      'Version history you — and only you — can decrypt.',
    ],
  },
  {
    type: 'p',
    text: 'Until then, this is a preview of the surface. Open a project to see the board view, or head back to the workspace index.',
  },
];

// ── Project board ───────────────────────────────────────────────────────────

export interface BoardCard {
  id: string;
  title: string;
  tag: string;
  tone: PillTone;
  /** Monogram labels for the assignee avatars. */
  assignees: string[];
}

export interface BoardColumn {
  id: string;
  title: string;
  cards: BoardCard[];
}

/** A three-lane kanban — enough cards to read as a working board. */
export const BOARD_COLUMNS: BoardColumn[] = [
  {
    id: 'todo',
    title: 'To do',
    cards: [
      { id: 'c1', title: 'Draft the keyring rotation spec', tag: 'Spec', tone: 'neutral', assignees: ['AM'] },
      { id: 'c2', title: 'Audit attachment sealing path', tag: 'Security', tone: 'danger', assignees: ['PR', 'KO'] },
      { id: 'c3', title: 'Design the docs block editor', tag: 'Design', tone: 'accent', assignees: ['DS'] },
    ],
  },
  {
    id: 'doing',
    title: 'In progress',
    cards: [
      { id: 'c4', title: 'Wire SSE reconnect backoff', tag: 'Sync', tone: 'accent', assignees: ['PR'] },
      { id: 'c5', title: 'Per-room presence indicators', tag: 'UI', tone: 'neutral', assignees: ['AM', 'DS'] },
    ],
  },
  {
    id: 'done',
    title: 'Done',
    cards: [
      { id: 'c6', title: 'BIP-39 seed onboarding', tag: 'Shipped', tone: 'success', assignees: ['KO'] },
      { id: 'c7', title: 'Space switcher + rails', tag: 'Shipped', tone: 'success', assignees: ['DS'] },
    ],
  },
];

/** Headline metrics shown under a board title. */
export const BOARD_PROGRESS = { done: 2, total: 7 };
