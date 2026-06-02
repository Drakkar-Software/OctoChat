# Unified Object model — post-migration cleanup checklist

Temporary scaffolding + dead code introduced while migrating a space's rooms from
the legacy `_rooms` registry into the unified **object index** (`objects/_index`).
Every active space has now migrated (its index holds its `room`/`category` nodes),
so the **dead-code** removals below are done. What REMAINS (§1–3) is not dead code —
it is a **behavior change to the E2EE space-create path**, gated on implementing the
index seed in `createSpace` (§3). Do NOT remove §1's migration/fallback before §3
lands, or **new spaces render an empty channel list** (the migration is the only
thing that seeds a freshly-created space's index today).

Grep anchors: `TEMP MIGRATION`, `roomsToObjects`, `legacyCategories`, `_rooms` fallback.

---

## REMAINING — coupled create-path rewrite (gated, not dead code)

### 1. Temporary on-device migration (remove WITH §3, not before)
- **`apps/mobile/src/lib/use-rooms.ts`**
  - The `// ── TEMP MIGRATION …` `useEffect` that calls `seedIfEmpty(roomsToObjects(...))`.
  - The `legacyCategories(...)` fallback in the `categories` useMemo → keep only the
    `objectsToRoomCategories(nodes, …)` (index) branch; drop the `?? legacyCategories(...)`.
  - The `legacyCategories()` helper function (becomes unused).
  - The `reg.rooms` / `reg.categories` reads (only owner/members/name + `reg.loaded`
    stay needed). The `roomsToObjects` import.
- **`apps/mobile/src/lib/starfish/objects.ts`** — `roomsToObjects()` (migration seed builder).
- **`apps/mobile/src/lib/use-objects.ts`** — `seedIfEmpty()` (and its entry in `ObjectsHook`).

### 2. Legacy `_rooms` room-list fallback in the provider (slim to index-only)
- **`apps/mobile/src/lib/rooms-registry-context.tsx`**
  - In `fetchEntry`, the fallback `idx?.rooms ?? rooms` / `idx?.categories ?? categories`
    → make the index the sole source. **Caution:** this fallback only fires when the
    index read fails (keyring not open yet, offline). Removing it turns those transient
    windows into blank chat — keep until §3 is verified.

### 3. Slim `_rooms` to the access record — THE BLOCKER
- **`apps/mobile/src/lib/starfish/registry.ts`**
  - `createSpace()` must take a `Session` (caller `spaces-context.tsx` already has one)
    and seed the **encrypted** object index (`objindex` is `delegated` — no plaintext
    seed path; mint the keyring + `client.push` an encrypted `{ objects: [general] }`)
    instead of `_rooms.rooms`. Until this lands, removing §1 ships empty new spaces.
  - `writeRooms()` then stops writing `rooms[]` + `categories[]`; reduce the `_rooms`
    doc to `{ v, owner, members, name, image }`. `normalizeCategories()` becomes unused
    → remove (also drop its use + the `categories` field in `readRooms`).
- Server configs need **no** schema change (the `rooms` collection stays the access
  record; only its body shrinks): `apps/server/src/config.ts` + Infra `collections.py`.
- **Not runtime-verifiable by typecheck** — the test is "create a brand-new space →
  does `general` appear?". Verify in-app before any OTA that includes this.

---

## DONE — dead-code / docs / infra removed (this pass)

### ✅ 4. Dead room/category mutation funcs (zero callers — the live ones are `useRooms` methods)
- **`registry.ts`** — removed `createRoom`, `createCategory`, `renameCategory`,
  `deleteCategory`, `reorderCategories`, `moveRoom`, and the now-orphaned
  `updateRoomsRegistry` (+ its private `sameName`, `RoomKind`/`roomSlug` imports).
  `CategoryError` kept (still used by `useRooms`). `createPublicRoom` kept (orchestrator).
- **`pubspace.ts`** — removed `createPublicCategory`, `renamePublicCategory`,
  `deletePublicCategory`, `reorderPublicCategories`, `movePublicRoom` (+ orphaned
  `sameName`, `CategoryError` import). `updatePublicRoomsRegistry` kept (automations).

### ✅ 5. Migration diagnostics
- Deleted `use-space-migrated.ts` + `SpaceMigratedCheck.tsx`; removed the `SpacePicker`
  mount and the `circle` icon. The generic `ListRow` `trailing` slot stays (reusable).

### ✅ 6. Stale docs — the `@drakkar.software/starfish-*` pin line is already `alpha.19`.

### ✅ 7. Infra public-space directory projection
- **`server/drakkar_sync/apps/octochat/projections.py`** — verified: its `len(rooms)`
  read folds the **public** `_rooms` doc, which §3 does NOT slim (only private `_rooms`).
  No change needed.

### ✅ 8. Infra housekeeping — added `venv/` to `Infra/.gitignore` (`.venv/` already present).

---

## Do-not-remove (permanent — listed to avoid accidental cleanup)
- `objectsToRoomCategories`, `categoryId`, tree builder + reducers (`objects.ts`).
- `use-merge-doc.ts`, `use-objects/use-doc/use-project`, `object-types.ts`, `project-board.ts`.
- `readIndexRooms` / `readPrivateIndexRooms` in `rooms-registry-context.tsx`.
- The 6 object collections (TS `config.ts` + Infra `collections.py`) + the
  `octochat.object.changed` queue topics, bridge SSE subscription, and `/events`
  proxy forwarding.
- `events.shared.ts` object-content routing; `use-doc`/`use-project` live-sync.
