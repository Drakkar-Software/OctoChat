# Space Contributor Capabilities — Design

> **Status: design doc — not yet implemented.**  
> Covers both private and public spaces. Spans OctoChat + Infra repos; changes must ship in
> lockstep.

---

## 1. Problem

After the unified object-model migration (commit `07eec25`), room and category creation moved
from the owner-only `_rooms` access record onto the `space:member`-writable object index
(`objindex`). As a result **any space member can now create, rename, move, and delete rooms
and categories** — which was previously owner-only.

The desired model is **three tiers**, selectable per-invitee at invite time:

| Tier | Can post messages | Can manage rooms/categories | Receives keyring |
|---|---|---|---|
| **Viewer** | No | No | Yes (read-only) |
| **Contributor** | Yes | No | Yes |
| **Manager** | Yes | Yes | Yes |

Today only Viewer (`canWrite=false`) and Manager (`canWrite=true`, today's member) exist.
The Contributor tier — post without room management — is missing.

---

## 2. Why a cap alone cannot express the Contributor tier

### How authorization works (two-layer AND)

Every request must pass **both** checks independently:

1. **Cap-scope check** (`cap_resolver.py` → `match_scope_path` / `_synthesize_roles`;
   TS twin in `apps/server/src/config.ts`):
   - The member cap carries `scope = { ops, collections, paths }` — a **single preset**.
   - `_synthesize_roles` cross-products `scope.ops × scope.collections` into
     `cap:{op}:{col}` roles (e.g. `cap:write:chat`).
   - `match_scope_path` globs `scope.paths` against the request path. Deny rules (`!`-prefix)
     cover the path **and all descendants** and strip **read AND write** together — there is no
     op-specific denial.

2. **Role check** — the collection's `read_roles`/`write_roles` must be satisfied by the
   union of **synthesized cap roles** + **enricher-added roles**.

### Why the cap shape blocks a "write messages, not rooms" split

`spaceMemberScope` (`packages/sdk/src/starfish/paths.ts`) issues one scope:

```ts
{
  ops:         ['read', 'list', 'write'],   // or ['read','list'] for canWrite=false
  collections: ['chat'],
  paths:       ['spaces/${spaceId}/**'],
}
```

Both `streamchat` (messages) and `objindex` (rooms/categories) sit under the same
`spaces/{spaceId}/**` glob, and `ops` is **uniform** across all paths. A deny rule on the
`objindex` path would also remove read — breaking the sidebar tree. There is no way to say
"write `streamchat` but only read `objindex`" with a single-preset scope.

**Conclusion:** the Contributor tier is not cap-expressible. It requires a new server-side
role (`space:contributor`) so the role check can grant `streamchat` write while keeping
`objindex` write owner+manager-only.

### Tiers expressible with caps today (no server change needed)

| Tier | `spaceMemberScope(spaceId, canWrite)` |
|---|---|
| Viewer | `canWrite=false` → `ops: ['read','list']` |
| Manager | `canWrite=true` → `ops: ['read','list','write']` |

---

## 3. The `space:contributor` role — private spaces

### 3.1 Roster change: `_rooms` access record

**File:** `packages/sdk/src/starfish/registry.ts`  
**File (server config):** `apps/server/src/config.ts` collection `rooms`,
`Infra/sync/server/drakkar_sync/apps/octochat/collections.py` collection `rooms`

Add a `contributors` array alongside `members` in the `_rooms` doc (owner-written, plaintext):

```ts
// Current shape
{ v: 1, owner: string, members: string[], name?: string, image?: string }

// New shape
{ v: 1, owner: string, members: string[], contributors: string[], name?: string, image?: string }
```

SDK touch points (all in `registry.ts`):
- `readRooms` — include `contributors` in the return type.
- `writeRooms` — thread `contributors` through; back-compat: absent field = `[]`.
- `addSpaceMember(spaceId, userId, tier)` — append to `members` (Manager) or `contributors`
  (Contributor) depending on the `tier` argument.
- `inviteToSpace` / `acceptSpaceInvite` — pass tier through so `addSpaceMember` targets
  the right list.

### 3.2 Enricher: emit `space:contributor`

**Files (must stay in lockstep):**
- `Infra/sync/server/drakkar_sync/apps/octochat/role_enricher.py` — extend
  `make_registry_role_enricher` (or fork a 3-role variant) to also emit `space:contributor`
  when `userId ∈ doc["contributors"]`.
- `packages/sdk/src/starfish/space-role.ts` — TS twin; identical logic.
- `Infra/sync/server/tests/test_starfish_enricher_equivalence.py` — must stay green;
  add a contributor test case.

Current 2-role primitive:
```python
# grants space:owner if userId == doc["owner"]
# grants space:member if userId == doc["owner"] or userId in doc["members"]
```

Extended 3-role logic:
```python
# same as above, plus:
# grants space:contributor if userId in doc.get("contributors", [])
```

Note: Manager-tier invitees still go in `members[]`, so they get `space:member` (no change to
existing behaviour). A Contributor gets `space:contributor` only (not `space:member`), so the
collection config below determines exactly what they can access.

### 3.3 Collection config — what the role gates

**Files (identical change in both):**
- `Infra/sync/server/drakkar_sync/apps/octochat/collections.py`
- `apps/server/src/config.ts`

| Collection | Current `write_roles` | New `write_roles` | Current `read_roles` | New `read_roles` |
|---|---|---|---|---|
| `streamchat` | `["space:member"]` | `["space:member","space:contributor"]` | `["space:member"]` | `["space:member","space:contributor"]` |
| `attachments` | `["space:member"]` | `["space:member","space:contributor"]` | `["space:member"]` | `["space:member","space:contributor"]` |
| `objindex` | `["space:member"]` | **unchanged** `["space:member"]` | `["space:member"]` | `["space:member","space:contributor"]` |
| `rooms` (`_rooms`) | `["space:owner"]` | unchanged | `["space:member"]` | `["space:member","space:contributor"]` |
| `chatkeyring` | `["space:owner"]` | unchanged | `["space:member"]` | `["space:member","space:contributor"]` |
| `threads` (if separate) | `["space:member"]` | `["space:member","space:contributor"]` | same | same |

Critical: `objindex.write_roles` stays `["space:member"]` — Contributors can read the sidebar
tree but **cannot** write to it (room/category management denied by role). The cap still
carries `write` op across the full `spaces/{spaceId}/**` path; the objindex write is blocked
by the role check, not the cap.

### 3.4 Keyring recipiency

`streamchat` is delegated-encrypted. A Contributor must be added as a `chatkeyring`
recipient (sealed to their kemPub) so they can decrypt messages. This is the same path
`addSpaceMember` already uses for Manager-tier invitees — extend it to Contributors too.
The keyring is still **owner-written** (`chatkeyring.write_roles = ["space:owner"]`); the
owner's device performs the re-seal when the Contributor accepts.

### 3.5 Cap (no change needed)

The Contributor's member cap is issued identically to a Manager's — `write` op, all
`spaces/{spaceId}/**` paths. Objindex write is blocked by the role check at the server; the
cap never needs to know about the tier split.

---

## 4. Public-space mirror: `pubspace:contributor`

Public spaces have an analogous role gap. Today `pubspace:writer` can write both `pubstream`
(messages) and `pubobjindex` (rooms/categories).

### 4.1 Roster / enricher

Public spaces use **issuer-bound roles** rather than a `_rooms` doc. The pubspace-role enricher
(`Infra/.../role_enricher.py`, `packages/sdk/src/starfish/pubspace-role.ts`) must be extended
to emit `pubspace:contributor` when the issuer of the cap falls into the contributor tier.
The invite link generation path must set a tier marker on the cap or in the pubspace registry.

### 4.2 Collection config — public

| Collection | Current `write_roles` | New `write_roles` | Note |
|---|---|---|---|
| `pubstream` | `["pubspace:owner","pubspace:writer"]` | `["pubspace:owner","pubspace:writer","pubspace:contributor"]` | contributors can post |
| `pubobjindex` | `["pubspace:owner","pubspace:writer"]` | `["pubspace:owner","pubspace:writer"]` — **unchanged** | contributors cannot manage rooms |
| `pubspace` (`_rooms`) | `["pubspace:owner"]` | unchanged | |

### 4.3 Automation tick write-back — critical caveat

`orchestrator.runAutomationTick` → `patchRoomAutomation` → `updatePublicObjectIndex` patches
`lastRunAt`/`lastError` on an existing automation node. This write runs on whichever device
is the elected runner — which may be a non-owner joiner currently holding `pubspace:writer`.

If the runner device is ever downgraded to `pubspace:contributor`, the status write-back
silently fails. **Safe approaches:**

- **Option A (simplest):** Only owners and Manager-tier invitees run the automation ticker.
  The `runAutomationTick` caller already checks `isOwner` in the UI; ensure the headless
  runner also gates on this.
- **Option B:** Carve the status field onto a separate append-only collection with
  `pubspace:contributor` write — but this is extra schema work.
- **Option C (default/interim):** Keep `pubobjindex.write_roles` including `pubspace:writer`
  until automation ticketing is verified to be owner-only, then tighten.

---

## 5. Invite-time UX

The invite flow gains a tier picker with three options:

| Label | Tier | Cap issued | Roster target |
|---|---|---|---|
| **Viewer** | view-only | `canWrite=false` | `members[]` (read-only cap) |
| **Contributor** | post-only | `canWrite=true` | `contributors[]` |
| **Manager** | full access | `canWrite=true` | `members[]` |

"Manager" is today's default member — no behaviour change for existing invites. The picker
defaults to Contributor (safest non-trivial permission) or Manager depending on product
preference.

---

## 6. Cross-repo lockstep and risks

- **Python + TS server must deploy together.** The enricher emits the new role; the
  collection config must already know to grant/deny it. A partial deploy where only one side
  ships leaves Contributors either locked out (enricher missing) or over-privileged (config
  missing).
- **Enricher equivalence test** (`tests/test_starfish_enricher_equivalence.py`) — add
  Contributor test cases; CI blocks a divergent deploy.
- **E2EE constraint**: the server cannot inspect node types inside the delegated-encrypted
  `objindex`. The `space:contributor` role gate is the only server-enforceable boundary. Any
  "only block room creation, allow doc creation" split would require a separate, non-E2EE
  index or a second delegated doc — out of scope.
- **Back-compat**: absence of `contributors[]` in an existing `_rooms` doc is treated as
  `[]`. All current members stay in `members[]` and get `space:member` as before. No
  migration needed.
- **Owned spaces with Contributors**: if the space owner invites someone as Contributor, the
  owner's device must seal a keyring entry for them during the `acceptSpaceInvite` flow.

---

## 7. Cheaper alternatives (documented but not chosen)

### 7.1 Owner-only rooms globally (no per-invite choice)

Flip `objindex.write_roles` from `["space:member"]` to `["space:owner"]` in both
`collections.py` and `config.ts`. One line per file, no enricher or roster change. Restores
the pre-migration behaviour where only the owner can manage rooms — but there is no way to
delegate room management to specific members. All members are post-only.

### 7.2 Client-only gate (POC acceptable, bypassable)

Add `if (!isOwner) return;` at the top of `createRoom`, `createCategory`, etc. in
`apps/mobile/src/lib/use-rooms.ts`. Zero server change. A crafted API request bypasses it
trivially — acceptable for a POC, not for production.

---

## 8. Files to change (implementation checklist)

### OctoChat

- `packages/sdk/src/starfish/registry.ts` — `readRooms`, `writeRooms`, `addSpaceMember`,
  `inviteToSpace`, `acceptSpaceInvite`
- `packages/sdk/src/starfish/paths.ts` — `SpaceMemberTier` type + any scope helpers
- `packages/sdk/src/starfish/space-role.ts` — 3-role enricher logic
- `apps/server/src/config.ts` — `streamchat`, `attachments`, `objindex` role arrays
- `apps/mobile/src/lib/use-rooms.ts` — (optional) client-side tier-aware UI gating
- Invite flow component — tier picker UI

### Infra

- `sync/server/drakkar_sync/apps/octochat/collections.py` — same role array changes as `config.ts`
- `sync/server/drakkar_sync/apps/octochat/role_enricher.py` — 3-role enricher
- `sync/server/tests/test_starfish_enricher_equivalence.py` — Contributor test cases
