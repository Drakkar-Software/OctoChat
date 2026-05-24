import { describe, expect, it } from 'vitest';

import { parseJsonResponse } from './json';

const URL = 'https://oc.drakkar.software/desktop-update.json';

describe('parseJsonResponse', () => {
  it('parses a valid JSON body', () => {
    const body = JSON.stringify({ version: 'a0554ea2377b2ff9', files: [] });
    expect(parseJsonResponse(URL, 'application/json', body)).toEqual({
      version: 'a0554ea2377b2ff9',
      files: [],
    });
  });

  it('accepts a charset-qualified JSON content-type', () => {
    const body = JSON.stringify({ version: 'x' });
    expect(parseJsonResponse(URL, 'application/json; charset=utf-8', body)).toEqual({
      version: 'x',
    });
  });

  it('throws on an SPA-fallback HTML 200 (the bug that failed silently)', () => {
    const html = '<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <title>OctoChat</title>';
    expect(() => parseJsonResponse(URL, 'text/html', html)).toThrow(
      /Expected JSON .* but got "text\/html" .* is the manifest deployed/,
    );
  });

  it('includes a whitespace-collapsed body preview in the error', () => {
    const html = '<!DOCTYPE html>\n<html>\n  <body>nope</body>';
    expect(() => parseJsonResponse(URL, 'text/html', html)).toThrow(
      /First 120 chars: <!DOCTYPE html> <html> <body>nope/,
    );
  });

  it('throws a clear error when the content-type is JSON but the body is malformed', () => {
    expect(() => parseJsonResponse(URL, 'application/json', '{ not json')).toThrow(
      /Invalid JSON from /,
    );
  });

  it('throws when the content-type header is absent', () => {
    expect(() => parseJsonResponse(URL, '', '{}')).toThrow(/no content-type/);
  });
});
