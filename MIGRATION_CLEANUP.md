# Unified Object model — post-migration cleanup checklist

Temporary scaffolding + dead code introduced while migrating a space's rooms from
the legacy `_rooms` registry into the unified **object index** (`objects/_index`).
Remove **only once every active space has migrated** (every space's index holds its
`room`/`category` nodes — the signal `useSpaceMigrated` reports). Until then the
legacy `_rooms` path is the fallback that keeps chat working, so do NOT remove early.

Grep anchors: `TEMP MIGRATION`, `roomsToObjects`, `legacyCategories`, `_rooms` fallback.

---

## OctoChat repo (`DK/OctoChat`)

### 1. Temporary on-device migration (remove wholesale)
- **`apps/mobile/src/lib/use-rooms.ts`**
  - The `// ── TEMP MIGRATION …` `useEffect` that calls `seedIfEmpty(roomsToObjects(...))`.
  - The `legacyCategories(...)` fallback in the `categories` useMemo → keep only the
    `objectsToRoomCategories(nodes, …)` (index) branch; drop the `?? legacyCategories(...)`.
  - The `legacyCategories()` helper function (becomes unused).
  - The `reg.rooms` / `reg.categories` reads (only owner/members/name + `reg.loaded`
    stay needed). The `roomsToObjects` import.
- **`apps/mobile/src/lib/starfish/objects.ts`**
  - `roomsToObjects()` — the migration seed builder. (Keep `objectsToRoomCategories`,
    `categoryId`, the tree builder, reducers — those are permanent.)
- **`apps/mobile/src/lib/use-objects.ts`**
  - `seedIfEmpty()` (and its entry in `ObjectsHook`) — only the migration uses it.

### 2. Legacy `_rooms` room-list fallback in the provider (slim to index-only)
- **`apps/mobile/src/lib/rooms-registry-context.tsx`**
  - In `fetchEntry`, the fallback `idx?.rooms ?? rooms` / `idx?.categories ?? categories`
    → make the index the sole source (`readIndexRooms` / `readPrivateIndexRooms` stay;
    they become primary). Stop reading `rooms[]` / `categories[]` from `readRooms`.
  - Keep `readRooms` ONLY for the access record (`owner`/`members`/`name`/`image`).

### 3. Slim `_rooms` to the access record (deferred task 4)
- **`apps/mobile/src/lib/starfish/registry.ts`**
  - `writeRooms()` / `createSpace()` should stop writing `rooms[]` + `categories[]`
    into `_rooms`; `createSpace` should seed the index (a `general` channel node)
    instead of `_rooms.rooms`. Reduce the `_rooms` doc to `{ v, owner, members, name, image }`.
  - `normalizeCategories()` becomes unused once `_rooms.rooms` is gone → remove.
- Server configs need **no** schema change (the `rooms` collection stays as the
  access record; only its body shrinks): `apps/server/src/config.ts` + Infra `collections.py`.

### 4. Dead room/category mutation funcs (already unused after the rewire — remove now or with cleanup)
- **`apps/mobile/src/lib/starfish/registry.ts`** — `createRoom`, `createCategory`,
  `renameCategory`, `deleteCategory`, `reorderCategories`, `moveRoom`. (Verify
  `updateRoomsRegistry` — still used by `pubspace.ts createPublicRoom`; keep if so.)
- **`apps/mobile/src/lib/starfish/pubspace.ts`** — `createPublicCategory`,
  `renamePublicCategory`, `deletePublicCategory`, `reorderPublicCategories`,
  `movePublicRoom` (zero callers). **Keep `createPublicRoom`** (used by
  `lib/automations/orchestrator.ts`).

### 5. Migration diagnostics (remove when migration is universal)
- **`apps/mobile/src/lib/use-space-migrated.ts`** — the per-space index probe.
- **`apps/mobile/src/components/chat/SpaceMigratedCheck.tsx`** — the trailing glyph.
- Its mount in **`SpacePicker.tsx`**; the `circle` icon added to `Icon.tsx` (drop if
  unused elsewhere). The generic trailing slot on `ListRow.tsx` may stay (reusable).

### 6. Stale docs
- **`CLAUDE.md`** (root + `apps/mobile`): the "`@drakkar.software/starfish-*` … pinned
  npm deps (`3.0.0-alpha.4`)" line is stale — now `alpha.19`. Update.
- This file (`MIGRATION_CLEANUP.md`) — delete once the list is done.

---

## Infra repo (`DK/Infra/sync`)

The object collections + `octochat.object.changed` relay are **PERMANENT** (not
migration scaffolding) — nothing to remove there. Only follow-ups:

### 7. If `_rooms` is slimmed (step 3), check the public-space directory projection
- **`server/drakkar_sync/apps/octochat/projections.py`** — verify it does NOT depend on
  `_rooms.rooms` for the `_index/spaces/public` directory. If it folds room counts from
  `_rooms`, point it at the public object index (`pubobjindex`) instead, or it will
  report stale/empty room counts after the slim.

### 8. Housekeeping (not migration-related)
- `venv/` is untracked and was left out of the commit — add it to `.gitignore`.

---

## Do-not-remove (permanent — listed to avoid accidental cleanup)
- `objectsToRoomCategories`, `categoryId`, tree builder + reducers (`objects.ts`).
- `use-merge-doc.ts`, `use-objects/use-doc/use-project`, `object-types.ts`, `project-board.ts`.
- `readIndexRooms` / `readPrivateIndexRooms` in `rooms-registry-context.tsx`.
- The 6 object collections (TS `config.ts` + Infra `collections.py`) + the
  `octochat.object.changed` queue topics, bridge SSE subscription, and `/events`
  proxy forwarding.
- `events.shared.ts` object-content routing; `use-doc`/`use-project` live-sync.
