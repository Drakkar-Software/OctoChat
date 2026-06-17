# "DM me" links — start a DM with no space in common

A **DM link** is a shareable URL (`https://oc.drakkar.software/dm#<token>`) any
OctoChat user can open to start a 1:1 end-to-end-encrypted DM with the link's
owner. It removes the one constraint of the regular DM flow: the initiator no
longer needs to **share a private space** with the peer (the shared space was
only ever the *delivery channel* for the invite — see `dm-inbox.ts`).

The link is deliberately **nothing but the owner's identity, made portable**:
their `userId`, display pseudo and published public keys (Ed25519 + KEM),
base64url-packed into the URL fragment. No credential, no server state, no
lifecycle — every account has the same permanent link, derivable on any of its
devices (`myDmLink`), and anyone holding it (or, equivalently, the owner's
userId) can deliver a DM invite.

## How it works

```
Owner                                       Visitor (any device)
─────                                       ────────────────────
myDmLink()                                  opens …/dm#<token>
 └ link = {ownerId, pseudo, edPub, kemPub}   ├ decodeDmLink → confirm screen
   (derived — nothing stored)                └ createDmViaLink()
                                                ├ verify ownerId == sha256(edPub)
                                                ├ cross-check keys vs public profile
                                                ├ dedup via dms map
                                                ├ create dm- space + inviteToSpace()
                                                ├ seal invite to owner's kemPub
                                                └ ANONYMOUS signed append
                                                      → dminbox/<ownerId>/<month>
reconcileDmInbox()  ◄───────────────────────────────┘
 └ trial-unseal + acceptSpaceInvite → the DM appears (auto-accept)
```

The **same delivery path also backs profile-initiated DMs**: the profile screen's
*Message* button needs only the peer's userId + published keys (both public), so it
works for any peer — when you share no space, it delivers through the inbox exactly
like a link does (`createOrOpenDmViaInbox`); when you do share a private space, it
still prefers that space's carrier (no public-inbox write). See `use-dm.ts`.

- **The inbox** is the `dminbox` collection (`dminbox/{identity}/{shard}`,
  apps/server/src/config.ts): an append-only log per user **per UTC month**
  holding invite elements `{ sealed, ts }`, where `sealed` is the normal DM
  invite bundle sealed to the owner's published KEM key (`sealToRecipient`) — the
  server only ever holds opaque blobs.
- **Delivery is an anonymous signed append.** The collection is public-write
  (like the `pairing` rendezvous), so the visitor POSTs with no `Authorization`
  at all — but the append **author proof** (default-on server-side) is still
  required and verified, signed with the visitor's own identity key, so every
  element is self-attested by its sender.
- **Reads are owner-only with zero custom machinery**: the storage path uses the
  built-in `{identity}` binding (the same own-doc gate as `_spaces`), so only
  the owner's cap can pull the inbox — an anonymous or foreign-cap read is
  rejected. No role enricher is involved anywhere in this feature.
- **Acceptance** is the existing DM machinery: the owner's `reconcileDmInbox()`
  (already run by the app on load / navigation / foreground) scans the personal
  inbox (the **current + previous** month shard) exactly like a shared-space
  carrier, trial-unseals, verifies the member cap binds to the owner's own
  identity, and auto-accepts — applying the same `dmWinner` dedup as carrier
  invites. Like carrier DMs, acceptance happens on the **primary (root) device**
  (invites seal to the published root keys) and other devices pick the DM up from
  the synced `dms` map.

The storage/role contract:

| Collection | Storage path                 | Enc.   | Read / Write roles            |
|------------|------------------------------|--------|-------------------------------|
| `dminbox`  | `dminbox/{identity}/{shard}` | `none` | `cap:read:dminbox` / `public` |

## Key trust (why the link embeds the keys)

Embedding the keys makes **first contact independent of the server**:

- `ownerId` must equal `sha256(edPub)` — checked offline by the opener, so the
  routing id and the signing key can never disagree.
- The KEM key is *not* derivable from `edPub`, so the opener additionally
  cross-checks the embedded keys against the owner's public profile whenever it
  is reachable and **fails loudly on a mismatch**. A lying server (key
  substitution in the profile) is caught by the link; a tampered link (kem swap)
  is caught by the profile; only both colluding — or full link replacement —
  defeats it.
- **Wholesale link substitution** (sending you Mallory's link labelled "Alice")
  is out of scope for *any* link design — the pseudo is a hint, not a proof.
  When it matters, verify the fingerprint (userId) out-of-band; the
  `ownerId == sha256(edPub)` binding is what makes that verification meaningful.

## Abuse posture

This design **deliberately accepts** that anyone who knows your userId can
deliver DM invites — the link is your identity, there is nothing to revoke
(no reset, no expiry). Unsolicited volume is bounded, not gated:

- per-IP push rate limit (30/min) and `maxBodyBytes: 16 KB` per element throttle
  the fill rate,
- **month-sharding caps the blast radius of a flood.** Each shard holds at most
  `maxItems: 500` and then 409s — but that only freezes the *current* month, and
  the shard **self-heals at the next UTC-month boundary** (senders write the new
  shard, the owner scans current + previous). So a spammer can deny delivery for
  at most the rest of a month, never *permanently*: an append-only log has no
  client-side trim and the identity link has no rotation, so a single unsharded
  log with a hard cap would otherwise brick a user's inbox forever,
- every element carries a verified author proof (senders are pseudonymous but
  cryptographically consistent),
- a DM only ever *appears* after the owner's own client verifies and accepts
  the sealed invite; garbage that doesn't trial-unseal is skipped silently.

The residual is that an invite is only scanned during its delivery month and the
next one, so an owner who never opens the app for ~2 months may miss an invite
from the start of that window — acceptable for an auto-accept best-effort channel
(the sender still holds the DM and can re-send).

The server learns delivery metadata only (sender author key, inbox owner,
timestamps) — invite contents, the DM keyring and all messages stay end-to-end
encrypted, and the token rides the URL `#fragment`, which browsers never send
to any server.

## App surface

- **Share** — Profile → *DM LINK* card (`DmLinkCard`, `use-dm-link.ts`):
  copy/share the permanent link, or show it as a QR. Nothing to generate or
  manage; available on every device.
- **Open** — `src/app/dm.tsx`: **verifies the link's identity binding**
  (`ownerId == sha256(edPub)`, via `verifyDmLinkBinding`) before rendering
  anything about the owner — a tampered token never shows a misleading profile —
  then starts the DM on an explicit tap (opening a link never silently creates a
  conversation). Re-opening a link lands in the existing DM (dedup).
- **Message button** — `src/app/profile/[id].tsx` (`use-dm.ts`): now offered for
  any peer with published keys, no shared space required (it routes through the
  inbox when there's no common space).
- **Deep links** — `/dm` is registered alongside `/join` for Android App Links /
  iOS universal links; see [deep-links.md](deep-links.md) (the hosted AASA /
  `assetlinks.json` must include `/dm`, and native builds need a rebuild).

## Eventing

v1 ships **without** a queue topic for `dminbox` appends: the owner's reconcile
already runs on load/navigation/foreground, matching carrier-DM latency, and
publishing on `octospaces.log.changed` would mis-format an FCM "new message" push
for something that isn't a room message yet. If live inbox notifications become
worth it, register the collection on a dedicated topic (e.g.
`octospaces.dminbox.changed`) in `apps/server/src/index.ts` and add a push
formatter for it.
