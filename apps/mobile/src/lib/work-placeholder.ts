/**
 * Placeholder content for the **Docs** and **Projects** view modes — docs,
 * knowledge, projects and boards land here later. For now each ships a
 * Notion-style page tree so the modes read as real surfaces ("to have a look")
 * without any backing data or routing. Every row is inert; the
 * {@link WorkSection.future} flag dims a group the feature hasn't reached yet.
 *
 * Lives in `lib` (not a component) so the sidebar/screen stay declarative and
 * the sample trees are swapped for live data in one place when these ship.
 */
import type { IconName } from '@/components/ui/Icon';

export interface WorkItem {
  id: string;
  /** Leading emoji, Notion-style. */
  emoji: string;
  label: string;
  /** Secondary line (page count, status…). */
  hint?: string;
}

export interface WorkSection {
  /** Section heading + the area it stands in for. */
  title: string;
  iconName: IconName;
  items: WorkItem[];
  /** Greyed as a not-yet-built area. */
  future?: boolean;
}

/** The **Docs** mode tree — written documents plus the knowledge base. */
export const DOCS_SECTIONS: WorkSection[] = [
  {
    title: 'Docs',
    iconName: 'book',
    items: [
      { id: 'doc-welcome', emoji: '👋', label: 'Welcome to the workspace', hint: 'Encrypted' },
      { id: 'doc-zk', emoji: '🔐', label: 'Zero-Knowledge Sync', hint: '3 pages' },
      { id: 'doc-handbook', emoji: '📒', label: 'Engineering Handbook', hint: '2 pages' },
      { id: 'doc-notes', emoji: '🗒️', label: 'Meeting Notes', hint: 'Encrypted' },
    ],
  },
  {
    title: 'Knowledge',
    iconName: 'layers',
    items: [
      { id: 'kn-security', emoji: '🛡️', label: 'Security Audits', hint: 'Restricted' },
      { id: 'kn-playbook', emoji: '💬', label: 'Support Playbook', hint: 'Shared' },
      { id: 'kn-glossary', emoji: '📖', label: 'Glossary', hint: 'Knowledge base' },
    ],
    future: true,
  },
];

/** The **Projects** sub-tree — initiatives plus their boards. */
export const PROJECTS_SECTIONS: WorkSection[] = [
  {
    title: 'Projects',
    iconName: 'target',
    items: [
      { id: 'proj-roadmap', emoji: '🗺️', label: 'Roadmap 2026', hint: 'In progress' },
      { id: 'proj-design', emoji: '🎨', label: 'Design System', hint: 'Shared' },
      { id: 'proj-launch', emoji: '🚀', label: 'Launch Plan', hint: 'Draft' },
    ],
  },
  {
    title: 'Boards',
    iconName: 'layers',
    items: [
      { id: 'board-sprint', emoji: '🏃', label: 'Current Sprint', hint: 'Kanban' },
      { id: 'board-backlog', emoji: '📋', label: 'Backlog', hint: 'Prioritized' },
      { id: 'board-bugs', emoji: '🐛', label: 'Bug Triage', hint: 'Open issues' },
    ],
    future: true,
  },
];

/** The **Work** tree — docs, knowledge, projects and boards in one surface. */
export const WORK_SECTIONS: WorkSection[] = [...DOCS_SECTIONS, ...PROJECTS_SECTIONS];
