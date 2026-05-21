/** Display helpers shared across screens — keep formatting logic out of components. */

/**
 * Count + correctly pluralized noun, e.g. `plural(1, 'reply', 'replies')` →
 * "1 reply" and `plural(3, 'member')` → "3 members".
 */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
