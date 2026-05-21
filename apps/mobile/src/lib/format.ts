/** Display helpers shared across screens — keep formatting logic out of components. */

/**
 * Count + correctly pluralized noun, e.g. `plural(1, 'reply', 'replies')` →
 * "1 reply" and `plural(3, 'member')` → "3 members".
 */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Human-readable byte size, e.g. 2_400_000 → "2.3 MB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}
