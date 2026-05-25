/**
 * Authenticated SSE proxy — gates the Whistlers room-change stream behind
 * cap-cert auth and per-space membership validation.
 *
 * Auth: verifies the cap-cert + per-request Ed25519 signature WITHOUT enforcing
 * scope.paths (meta-endpoint, not a data collection; access is controlled by the
 * per-space membership check that follows).
 *
 * Filter: client declares candidate spaceIds via ?spaces=sp-a,sp-b; server
 * validates each against `spaces/{id}/_rooms` membership (makeSpaceRoleEnricher),
 * maps the authorized ids to sanitized Whistlers destinationTopics, and proxies
 * only those topics upstream.
 *
 * ★ Firehose-prevention invariant: the upstream Whistlers URL ALWAYS carries at
 * least one ?topic= param. An empty authorized set substitutes the sentinel
 * "__none__" (matches nothing). Never omit all ?topic= — that makes Whistlers
 * stream the global firehose to an unauthorized client.
 *
 * Whistlers topic derivation: queue.ts onPublish emits
 * `octochat.chat.changed.<spaceId>`; Whistlers applies the `octochat` namespace
 * prefix then sanitizeTopic — every char outside [a-zA-Z0-9-_~%] → "-", giving
 * `octochat-octochat-chat-changed-<spaceId>`. This proxy reconstructs that exact
 * transform server-side so Whistlers' ?topic= filter matches.
 */
import { Hono, type Context } from "hono";
import {
  verifyCapCert,
  verifyRequestSignature,
  isWithinClockSkew,
  getBase64,
  type CapCert,
} from "@drakkar.software/starfish-protocol";
import type {
  NonceCache,
  RevocationStore,
  RoleEnricher,
} from "@drakkar.software/starfish-server";

import { SPACE_MEMBER_ROLE } from "./space-role.js";

const WHISTLERS_INTERNAL_URL =
  process.env.WHISTLERS_INTERNAL_URL ?? "http://localhost:8080/events";

/** Exact sanitizeTopic from Whistlers bridge.ts:30-32. */
const sanitizeTopic = (t: string) => t.replace(/[^a-zA-Z0-9\-_~%]/g, "-");

/** Whistlers namespace — MUST match the namespace key in infra/whistlers.config.json. */
const WHISTLERS_NAMESPACE = "octochat";

function parseCapHeader(authHeader: string): CapCert | null {
  if (!authHeader.startsWith("Cap ")) return null;
  const b64 = authHeader.slice("Cap ".length).trim();
  if (!b64) return null;
  try {
    const json = new TextDecoder().decode(getBase64().decode(b64));
    return JSON.parse(json) as CapCert;
  } catch {
    return null;
  }
}

/**
 * Authenticate a GET /events request: verify cap-cert + per-request Ed25519
 * signature, replay-protect via nonce cache, check revocation.
 *
 * Deliberately does NOT enforce scope.paths — /events is a meta-endpoint; the
 * per-space membership check (step 3 of the handler) gates actual access.
 * The nonce cache is shared with the main sync router for replay protection
 * across both endpoints.
 *
 * Returns the caller's identity string, or null on any auth failure.
 */
async function authenticateEventsRequest(
  c: Context,
  opts: { nonceCache: NonceCache; revocationStore: RevocationStore },
): Promise<string | null> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) return null;
  const cert = parseCapHeader(authHeader);
  if (!cert) return null;

  const sigB64 = c.req.header("X-Starfish-Sig");
  const tsStr = c.req.header("X-Starfish-Ts");
  const nonce = c.req.header("X-Starfish-Nonce");
  if (!sigB64 || !tsStr || !nonce) return null;

  const tsNum = Number(tsStr);
  if (!Number.isFinite(tsNum) || !isWithinClockSkew(tsNum, Date.now())) return null;

  const certResult = await verifyCapCert(cert, { now: Math.floor(Date.now() / 1000) });
  if (!certResult.ok) return null;

  // The per-request signature is signed by the cap's subject key (cert.sub).
  // As of starfish 3.0.0-alpha.1, `sub` is optional — absent on `audience` caps
  // (public links), which carry no single subject and cannot sign here. /events
  // only ever serves device/member caps, so require a concrete subject (also
  // narrows `cert.sub` to string for the signature/nonce/revocation checks below).
  if (!cert.sub) return null;

  // Verify the per-request signature, bound to this exact URL + host.
  let pathAndQuery: string;
  let host: string;
  try {
    const u = new URL(c.req.url);
    pathAndQuery = u.pathname + u.search;
    host = u.host;
  } catch {
    pathAndQuery = c.req.url;
    host = "";
  }

  // Per-request signature suite. As of starfish 3.0.0-alpha.4 `alg` is folded
  // into the signed canonical input, so the verifier must reconstruct it with
  // the same suite. For device/member caps (the only kinds /events serves — see
  // the `cert.sub` guard above) the authoritative suite is the cert's `subAlg`,
  // defaulting to the issuer suite when absent (tolerant-reader rule). We derive
  // it from the verified cert, NOT the attacker-controlled X-Starfish-Alg header
  // (that header is authoritative only for audience caps, which we reject here).
  const alg = cert.subAlg ?? cert.issAlg;
  const sigOk = await verifyRequestSignature(
    { method: "GET", pathAndQuery, host },
    { alg, sig: sigB64, ts: tsNum, nonce },
    cert.sub,
  );
  if (!sigOk) return null;

  // Replay protection — shared nonce cache with the sync router.
  if (!opts.nonceCache.checkAndRemember(cert.sub, nonce, Date.now())) return null;

  // Revocation check.
  if (opts.revocationStore.isRevoked(cert.iss, cert.sub, cert.nonce)) return null;

  // Bind identity (device cap → issuer; member cap → subject).
  if (cert.kind === "device") return cert.issUserId;
  if (cert.kind === "member" && cert.subUserId) return cert.subUserId;
  return null;
}

export interface EventsRouteOptions {
  enricher: RoleEnricher;
  nonceCache: NonceCache;
  revocationStore: RevocationStore;
}

export function createEventsRoute(opts: EventsRouteOptions): Hono {
  const { enricher, nonceCache, revocationStore } = opts;
  const app = new Hono();

  app.get("/events", async (c) => {
    // 1. Authenticate — reject unauthenticated requests.
    const identity = await authenticateEventsRequest(c, { nonceCache, revocationStore });
    if (!identity) {
      return c.json({ error: "unauthorized" }, 401);
    }

    // 2. Read candidate space ids from ?spaces=sp-a,sp-b (client-declared).
    const spacesParam = c.req.query("spaces") ?? "";
    const candidates = spacesParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // 3. Validate each against membership (spaces/{id}/_rooms).
    //    TOFU note: an unseen spaceId returns [OWNER, MEMBER] — harmless because no
    //    publisher writes that topic and ownership is only stamped on first registry write.
    const authorized: string[] = [];
    for (const spaceId of candidates) {
      const roles = await enricher({ identity, roles: [] }, { spaceId });
      if (roles.includes(SPACE_MEMBER_ROLE)) authorized.push(spaceId);
    }

    // 4. Map to sanitized destinationTopics server-side (never trust the client).
    //    Mirrors Whistlers' per-message derivation for `octochat.chat.changed.<spaceId>`.
    const topics = authorized.map(
      (s) => `${WHISTLERS_NAMESPACE}-${sanitizeTopic(`octochat.chat.changed.${s}`)}`,
    );

    // 5. ★ Firehose-prevention invariant.
    //    An empty topic list would make Whistlers stream the global firehose.
    //    Substitute a never-matching sentinel instead.
    const safeTopics = topics.length > 0 ? topics : ["__none__"];

    // 6. Proxy the upstream Whistlers SSE stream.
    //    Propagate the client's abort signal so disconnecting the browser closes
    //    the upstream connection — without this every disconnect leaks a connection.
    const qs = safeTopics.map((t) => `topic=${encodeURIComponent(t)}`).join("&");
    const upstreamUrl = `${WHISTLERS_INTERNAL_URL}?${qs}`;

    let upstream: Response;
    try {
      upstream = await fetch(upstreamUrl, {
        headers: { Accept: "text/event-stream" },
        signal: c.req.raw.signal,
      });
    } catch {
      return c.json({ error: "upstream unavailable" }, 503);
    }

    if (!upstream.ok || !upstream.body) {
      return c.json({ error: "upstream error" }, 502);
    }

    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  return app;
}
