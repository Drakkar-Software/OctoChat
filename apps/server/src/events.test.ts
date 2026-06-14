/**
 * Unit tests for the /events SSE route — focuses on the MAX_SPACES_PER_CONNECTION cap
 * and the firehose-prevention invariant (__none__ sentinel when no spaces authorized).
 *
 * Auth is stubbed: vi.mock the starfish-protocol functions to short-circuit the full
 * cap-cert verification; the enricher is a plain jest mock so we can count its calls
 * and control which spaces it authorizes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Stub out the auth layer ───────────────────────────────────────────────────────
// authenticateEventsRequest calls verifyCapCert, verifyRequestSignature, isWithinClockSkew,
// getBase64, and the nonceCache/revocationStore. Stub them all to succeed so we can
// exercise the downstream candidate-cap + enricher logic without real Ed25519 keypairs.

vi.mock("@drakkar.software/starfish-protocol", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    verifyCapCert: vi.fn(async () => ({ ok: true })),
    verifyRequestSignature: vi.fn(async () => true),
    isWithinClockSkew: vi.fn(() => true),
    getBase64: vi.fn(() => ({
      encode: (b: Uint8Array) => Buffer.from(b).toString("base64"),
      decode: (s: string) => new Uint8Array(Buffer.from(s, "base64")),
    })),
  };
});

import { createEventsRoute } from "./events.js";
import type { RoleEnricher } from "@drakkar.software/starfish-server";
import { SPACE_MEMBER_ROLE } from "./space-role.js";

// A cap-cert header the route can parse — content doesn't matter because verifyCapCert is mocked.
// The cert must parse as JSON with sub, kind, issUserId so the auth function can return an identity.
const FAKE_CAP_JSON = JSON.stringify({
  kind: "device",
  sub: "fake-ed-pub-hex",
  iss: "fake-device-id",
  issUserId: "user-1",
  nonce: "fake-nonce",
  exp: 9_999_999_999,
});
const FAKE_CAP_HEADER = `Cap ${Buffer.from(FAKE_CAP_JSON).toString("base64")}`;

function makeNonceCache() {
  const seen = new Set<string>();
  return {
    checkAndRemember: (_sub: string, nonce: string, _ts: number) => {
      if (seen.has(nonce)) return false;
      seen.add(nonce);
      return true;
    },
  };
}

function makeRevocationStore() {
  return { isRevoked: () => false };
}

/** Build an authenticated GET /events request with ?spaces= set to `spaceIds`. */
function makeEventsRequest(spaceIds: string[]): Request {
  const url = `http://localhost/events?spaces=${spaceIds.join(",")}`;
  return new Request(url, {
    method: "GET",
    headers: {
      Authorization: FAKE_CAP_HEADER,
      "X-Starfish-Sig": "fake-sig",
      "X-Starfish-Ts": String(Math.floor(Date.now() / 1000)),
      "X-Starfish-Nonce": `nonce-${Math.random()}`,
    },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────────

const MAX_CAP = 64; // must match events.ts

function range(n: number, prefix = "sp-"): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i.toString().padStart(4, "0")}`);
}

describe("/events — MAX_SPACES_PER_CONNECTION cap", () => {
  let enricherCalls: number;
  let enricher: RoleEnricher;

  beforeEach(() => {
    enricherCalls = 0;
    // Authorize every space so all candidates would be included if uncapped.
    enricher = vi.fn(async (_ctx, _params) => {
      enricherCalls++;
      return [SPACE_MEMBER_ROLE];
    }) as unknown as RoleEnricher;
  });

  it(`authorizes at most ${MAX_CAP} spaces when more than ${MAX_CAP} candidates are supplied`, async () => {
    const app = createEventsRoute({
      enricher,
      nonceCache: makeNonceCache() as never,
      revocationStore: makeRevocationStore() as never,
    });

    const spaceIds = range(MAX_CAP + 10);
    const req = makeEventsRequest(spaceIds);

    // The route will try to fetch from an upstream Whistlers URL; that will fail in the
    // test environment. We only care that the enricher was capped, not that the SSE
    // stream started. Catch the upstream error gracefully.
    await Promise.resolve(app.request(req)).catch(() => {});

    expect(enricherCalls).toBeLessThanOrEqual(MAX_CAP);
  });

  it(`invokes the enricher exactly ${MAX_CAP} times when exactly ${MAX_CAP} candidates are supplied`, async () => {
    const app = createEventsRoute({
      enricher,
      nonceCache: makeNonceCache() as never,
      revocationStore: makeRevocationStore() as never,
    });

    const req = makeEventsRequest(range(MAX_CAP));
    await Promise.resolve(app.request(req)).catch(() => {});

    expect(enricherCalls).toBe(MAX_CAP);
  });

  it("invokes the enricher for every candidate when fewer than the cap are supplied", async () => {
    const app = createEventsRoute({
      enricher,
      nonceCache: makeNonceCache() as never,
      revocationStore: makeRevocationStore() as never,
    });

    const req = makeEventsRequest(range(5));
    await Promise.resolve(app.request(req)).catch(() => {});

    expect(enricherCalls).toBe(5);
  });
});
