import { describe, expect, it } from 'vitest';

import { dedupeFetch, hashContent } from './hash';

describe('hashContent', () => {
  it('is stable for the same input', () => {
    expect(hashContent('hello')).toBe(hashContent('hello'));
  });
  it('differs for different input', () => {
    expect(hashContent('hello')).not.toBe(hashContent('hello!'));
  });
});

describe('dedupeFetch', () => {
  it('posts when there is no previous hash', () => {
    const { post, hash } = dedupeFetch('body', null);
    expect(post).toBe(true);
    expect(hash).toBe(hashContent('body'));
  });
  it('skips when the text matches the previous hash', () => {
    const prev = hashContent('body');
    expect(dedupeFetch('body', prev).post).toBe(false);
  });
  it('posts when the text changed', () => {
    const prev = hashContent('old');
    expect(dedupeFetch('new', prev).post).toBe(true);
  });
  it('treats undefined like a missing cursor', () => {
    expect(dedupeFetch('body', undefined).post).toBe(true);
  });
});
