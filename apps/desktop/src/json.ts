/**
 * Parse a fetched HTTP body as JSON, throwing a descriptive error on a non-JSON
 * content-type or a parse failure.
 *
 * Split out of `updater.ts` (which imports electron `net`) so this guard — the
 * part that silently broke when a static host answered a missing manifest path
 * with an SPA-fallback `index.html` and HTTP 200 — is unit-testable in plain
 * Node, with no electron mock.
 */
export function parseJsonResponse<T>(url: string, contentType: string, body: string): T {
  if (!contentType.includes('json')) {
    const preview = body.slice(0, 120).replace(/\s+/g, ' ').trim();
    throw new Error(
      `Expected JSON from ${url} but got "${contentType || 'no content-type'}" ` +
        `— is the manifest deployed? First 120 chars: ${preview}`,
    );
  }
  try {
    return JSON.parse(body) as T;
  } catch (err) {
    throw new Error(`Invalid JSON from ${url}: ${(err as Error).message}`);
  }
}
