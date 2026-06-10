import { describe, expect, it } from 'vitest';

import { splitDigestSections } from './digest-sections';

describe('splitDigestSections', () => {
  it('splits a clean single-# summary into sections', () => {
    const out = splitDigestSections('# general\n- hello\n- world\n\n# random\n- hi');
    expect(out).toEqual([
      { room: 'general', body: '- hello\n- world' },
      { room: 'random', body: '- hi' },
    ]);
  });

  it('tolerates ## headings (the leaked double-hash case)', () => {
    const out = splitDigestSections('## general\n- a');
    expect(out).toEqual([{ room: 'general', body: '- a' }]);
  });

  it('tolerates a heading with no blank line before bullets', () => {
    const out = splitDigestSections('# general\n- a\n# random\n- b');
    expect(out).toEqual([
      { room: 'general', body: '- a' },
      { room: 'random', body: '- b' },
    ]);
  });

  it('strips a # echoed into the room name so the resolver can match', () => {
    expect(splitDigestSections('## #general\n- a')[0].room).toBe('general');
  });

  it('tolerates a heading with no space after the hashes', () => {
    expect(splitDigestSections('##general\n- a')[0].room).toBe('general');
  });

  it('keeps header-less preamble as a body-only section', () => {
    const out = splitDigestSections('Some stray intro line.\n# general\n- a');
    expect(out).toEqual([
      { room: '', body: 'Some stray intro line.' },
      { room: 'general', body: '- a' },
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(splitDigestSections('')).toEqual([]);
    expect(splitDigestSections('   \n  ')).toEqual([]);
  });
});
