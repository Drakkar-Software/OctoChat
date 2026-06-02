/**
 * Static copy for the Work hero lockup (the marine header on the Work tab). The docs
 * and projects themselves are now live (see {@link useObjects} / {@link WorkObjects});
 * only the hero's facet chips remain placeholder copy, kept here so the hero stays
 * declarative.
 */
import type { IconName } from '@/components/ui/Icon';

/** A top-level area the Work surface stands in for — the hero's facet chips. */
export interface WorkFacet {
  iconName: IconName;
  label: string;
  /** One-line description of what the facet holds. */
  meta: string;
}

/** The two halves the Work hero previews — fed to the hero chips. */
export const WORK_FACETS: WorkFacet[] = [
  { iconName: 'book', label: 'Docs', meta: 'Pages & knowledge' },
  { iconName: 'target', label: 'Projects', meta: 'Boards & roadmaps' },
];
