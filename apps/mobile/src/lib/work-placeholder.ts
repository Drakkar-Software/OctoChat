/**
 * Placeholder content for the **Work** view mode — docs, projects and knowledge
 * management land here later. For now it ships a Notion-style page tree so the
 * mode reads as a real surface ("to have a look") without any backing data or
 * routing. Every row is inert; the {@link WorkSection.future} flag dims a group
 * the feature hasn't reached yet.
 *
 * Lives in `lib` (not a component) so the sidebar/screen stay declarative and
 * the sample tree is swapped for live data in one place when Work ships.
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

export const WORK_SECTIONS: WorkSection[] = [
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
    title: 'Projects',
    iconName: 'target',
    items: [
      { id: 'proj-roadmap', emoji: '🗺️', label: 'Roadmap 2026', hint: 'In progress' },
      { id: 'proj-design', emoji: '🎨', label: 'Design System', hint: 'Shared' },
      { id: 'proj-launch', emoji: '🚀', label: 'Launch Plan', hint: 'Draft' },
    ],
    future: true,
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
