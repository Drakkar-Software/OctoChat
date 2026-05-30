# Plan — Direct Messages as a virtual "DM space"

> **Scope.** Turn Direct Messages from a section pinned at the top of every space's
> room list into its own **virtual space**: a dedicated rail tile that, when selected,
> shows the list of DM conversations in the room-list area exactly where a normal
> space shows its channels. The DM space is **UI-only** — not a real Starfish space:
> it can't be joined, left, renamed, invited-to, or have categories. DMs appear
> **only** in the DM space (the old top-of-list `Direct Messages` section is removed
> everywhere).
>
> **Out of scope.** The separate bug "DM Message button does nothing on native" is a
> different issue, tackled later. Do not touch the DM-open flow (`use-dm.ts`,
> `starfish/dm.ts`) here.
>
> No automated tests exist; a **manual QA checklist** is at the end.

---

## 0. Background — how things work today

- **Real spaces** are held in `SpacesProvider` (`src/lib/spaces-context.tsx`).
  `activeId` is the currently-selected space id; `setActiveId` switches it.
  DM spaces (`dm-` prefix) are **filtered out** of the rail by `railSpaces`
  (`spaces-context.tsx:50`) and surface separately.
- **DM data**: `useDms()` (`src/lib/use-dms.ts`) returns `DmEntry[]`
  (`{ spaceId, roomId, peerUserId, name, initials, unread }`), sorted by peer name.
- **Two rails** render the space switcher (BOTH must be touched — this is the class
  of bug that made the previous DM fix web-only):
  - **Mobile**: `SpaceRail` (`src/components/chat/SpaceRail.tsx`), embedded in
    `SpaceHeader` (`src/components/chat/SpaceHeader.tsx`), used by
    `src/app/(tabs)/rooms.tsx`.
  - **Desktop**: `DesktopSpacesRail` (`src/components/chat/DesktopSpacesRail.tsx`),
    rendered by `DesktopNav` (`src/components/chat/DesktopNav.tsx`) alongside
    `DesktopRoomSidebar` (`src/components/chat/DesktopRoomSidebar.tsx`).
- **The old DM section** `DirectMessagesSection`
  (`src/components/chat/DirectMessagesSection.tsx`) is rendered in exactly two
  places: `rooms.tsx:108` and `DesktopRoomSidebar.tsx:173`. Both get removed.
- **Data hooks that must NEVER receive the sentinel** (verified — each triggers a
  one-shot `_rooms`/cross-room fetch for any truthy space id, so the sentinel would
  fetch a non-existent doc — the exact web-only-bug class to avoid):
  - `useRooms(spaceId)` — `useRooms(null)` returns empty, non-loading state safely
    (`use-rooms.ts`). Called in `rooms.tsx:29` AND `DesktopNav.tsx:33`.
  - `useSpaceNav(spaceId)` — loads threads/pins in a `useEffect` whenever `spaceId`
    is truthy (`use-space-nav.ts:25-28`); `useSpaceNav(null)` no-ops. Called in
    `DesktopNav.tsx:36` with the **raw** `activeId` today.
  - **Pass `isDmHome ? null : activeId` to every one of these.** Single most
    important correctness point in the plan — see step 8a for the DesktopNav fix.

### Architecture decisions (read before coding)

1. **The DM space is a UI sentinel, NOT a synthesized `Space`.** Do not push a fake
   `Space` object through `railSpaces`/`useSpaces`/`useRooms`. Every space hook keys
   off real registry docs; a fake id would require `if`-guards in a dozen hooks.
   Instead: a constant id (`DM_HOME_ID`) that `activeId` may hold, handled by an
   early branch in the few components that render the room list.
2. **The sentinel must not collide with `isDmSpaceId`.** `isDmSpaceId` checks the
   `dm-` prefix. The sentinel is `'dms-home'` (prefix `dms`, not `dm-`) so it can
   never be mistaken for a real per-peer DM space.
3. **Selection reuses `activeId`.** `activeId === DM_HOME_ID` means "DM space is
   selected". This makes both rails' active-highlight (`s.id === activeId`) and the
   persistent desktop shell stay in sync for free.
4. **`useRooms` AND `useSpaceNav` are guarded**: pass `isDmHome ? null : activeId` in
   both screens (see the background note above — both fetch on a truthy id).
5. **Both rails + both `DirectMessagesSection` call sites** are touched. Parity is a
   checklist item, not an afterthought.
6. **The DM rail tile** uses the `people` icon token (verified: `Icon.tsx:51`,
   `people → Feather 'users'`), no lock/globe privacy corner, pinned **first**.
7. **DM-tile unread badge** = sum of `useDms().unread` (new `useTotalDmUnread()`
   selector for reuse).

---

## 1. New module — the DM-home sentinel

**File:** `src/lib/dm-home.ts` *(new)*

- [ ] Create the file:

```ts
/**
 * The "DM space" is a UI-only virtual space: a rail tile that lists the identity's
 * Direct Messages where a normal space lists its channels. It is NOT a real Starfish
 * space — it can't be joined, left, renamed or invited-to. This module is the single
 * source of its identity + the `activeId` sentinel that marks it selected.
 *
 * The id is `dms-` (NOT `dm-`) on purpose: `isDmSpaceId` (starfish/dm-ids) keys the
 * `dm-` prefix to detect a real per-peer DM space, and this sentinel must never be
 * mistaken for one.
 */
export const DM_HOME_ID = 'dms-home';
export const DM_HOME_NAME = 'Direct Messages';
/** Two-letter monogram for the rail tile fallback (icon is preferred). */
export const DM_HOME_SHORT = 'DM';

/** True when the DM space is the active selection. */
export const isDmHomeId = (id: string | null | undefined): boolean => id === DM_HOME_ID;
```

> **Why a lib module:** keeps the constant + predicate in one place (project rule:
> "Logic lives in `src/lib`"). Components import the predicate, never re-check the
> string literal.

---

## 2. DM-unread selector (reused by both rails)

**File:** `src/lib/use-dms.ts` *(edit)*

- [ ] Append a thin selector below `useDms` so both rails compute the tile badge
      identically:

```ts
/** Total unread across every DM — the DM space rail tile's badge count. */
export function useTotalDmUnread(): number {
  const dms = useDms();
  return useMemo(() => dms.reduce((n, d) => n + d.unread, 0), [dms]);
}
```

> `useMemo` is already imported in this file. No other change here.

---

## 3. Shared DM list content (rows + empty state)

This replaces `DirectMessagesSection`. It renders **only** the DM rows (no internal
"Direct Messages" header — the space header already names the view) and an empty
state explaining how to start a DM.

**File:** `src/components/chat/DmList.tsx` *(new)*

- [ ] Create it (lift the synthetic-`Room`→`ChannelRow` mapping straight from the old
      `DirectMessagesSection`, add the empty state):

```tsx
import type { Room } from '@/lib/types';
import type { DmEntry } from '@/lib/use-dms';
import { EmptyState } from '@/components/ui/EmptyState';

import { ChannelRow } from './ChannelRow';

interface DmListProps {
  dms: DmEntry[];
  activeRoomId?: string;
  onOpen: (dm: DmEntry) => void;
}

/**
 * The contents of the virtual DM space: one {@link ChannelRow} per conversation
 * (reusing the `kind:'dm'` person-monogram + unread path), or an empty state that
 * explains how to start a DM. Used by the mobile rooms screen AND the desktop room
 * sidebar so both surfaces stay identical. Each DM's name/initials are the PEER's
 * (viewer-correct — see `use-dms`).
 */
export function DmList({ dms, activeRoomId, onOpen }: DmListProps) {
  if (dms.length === 0) {
    return (
      <EmptyState
        iconName="people"
        title="No direct messages yet"
        subtitle="Open someone’s profile and tap Message to start a private, encrypted conversation. You can DM anyone you share a private space with."
      />
    );
  }
  return (
    <>
      {dms.map((dm) => {
        // Synthetic Room so the shared ChannelRow renders the DM (monogram + unread).
        const room: Room = {
          id: dm.roomId,
          spaceId: dm.spaceId,
          category: '',
          name: dm.name,
          kind: 'dm',
          avatar: dm.initials,
          unread: dm.unread,
        };
        return <ChannelRow key={dm.spaceId} room={room} active={dm.roomId === activeRoomId} onPress={() => onOpen(dm)} />;
      })}
    </>
  );
}
```

- [ ] **Delete** `src/components/chat/DirectMessagesSection.tsx` — but only AFTER its
      two usages are removed (steps 6 & 8b), so the tree always compiles.

> **EmptyState centering caveat:** `EmptyState`'s `wrap` is `flex:1`, which collapses
> to zero height inside a `ScrollView` content container that isn't height-bounded.
> The mobile rooms body is a `ScrollView` (via `StackScreen`), so the call site wraps
> `DmList` in `<View style={{ minHeight: 320 }}>` (step 6). The desktop sidebar
> `ScrollView` is height-bounded by the shell, so it's fine there.

---

## 4. Mobile rail — leading DM tile

**File:** `src/components/chat/SpaceRail.tsx` *(edit)*

`RailItem` hardcodes a privacy corner (`isPublic ? 'globe' : 'lock'`, lines 63-65).
The DM tile shows a `people` glyph instead and no privacy corner.

- [ ] Extend `SpaceRailProps`:

```ts
interface SpaceRailProps {
  spaces: Space[];
  activeId: string;
  onSelect?: (id: string) => void;
  onAdd?: () => void;
  /** Select the virtual DM space (always shown as the leading tile). */
  onSelectDms?: () => void;
  /** Whether the DM space is the active selection. */
  dmsActive?: boolean;
  /** Aggregate unread across all DMs, for the DM tile badge. */
  dmUnread?: number;
}
```

- [ ] Give `RailItem` an optional `icon?: IconName` (import `IconName` from
      `@/components/ui/Icon` — `Icon` is already imported). When present, render the
      glyph centered in the tile and **skip** the privacy corner:

```tsx
// add to RailItem's props:  icon?: IconName,
// tile body — replace the image/label branch:
{icon ? (
  <Icon name={icon} size={18} color={active ? colors.accentInk : colors.inkSoft} />
) : image ? (
  <Image .../>            // unchanged
) : (
  <Txt ...>{label}</Txt>  // unchanged
)}
// privacy corner — gate it off for the icon (DM) tile:
{icon ? null : (
  <View style={[styles.corner, ...]}><Icon name={isPublic ? 'globe' : 'lock'} .../></View>
)}
```

- [ ] In `SpaceRail`, render the DM tile **first**, before `spaces.map`:

```tsx
return (
  <View style={styles.rail}>
    <RailItem
      label={DM_HOME_SHORT}
      icon="people"
      active={!!dmsActive}
      unread={dmUnread}
      onPress={onSelectDms}
    />
    {spaces.map((s) => ( /* unchanged */ ))}
    <Pressable ... onPress={onAdd} ... />   {/* unchanged add tile */}
  </View>
);
```

- [ ] Import `DM_HOME_SHORT` from `@/lib/dm-home`.

> Reuse the existing `styles.tile` / active-border treatment verbatim — the DM tile
> differs only in glyph and the missing privacy corner.

---

## 5. Desktop rail — leading DM tile

**File:** `src/components/chat/DesktopSpacesRail.tsx` *(edit)*

This rail inlines its tile in `SpaceTile` (no shared `RailItem`). Mirror step 4.

- [ ] Extend `DesktopSpacesRailProps` with the same three props
      (`onSelectDms`, `dmsActive`, `dmUnread`).
- [ ] Before `spaces.map` (inside the `ScrollView`, after the `Octopus`+rule, ~line
      107), add a leading tile mirroring the `SpaceTile` markup but: render
      `<Icon name="people" .../>` in the tile, **no** privacy corner,
      `active={dmsActive}`, `onPress={onSelectDms}`, badge from `dmUnread`:

```tsx
<Pressable
  accessibilityRole="button"
  accessibilityLabel={DM_HOME_NAME}
  onPress={onSelectDms}
  style={styles.tileWrap}
>
  <View style={[styles.tile, {
    borderRadius: dmsActive ? radii.lg : radii.xl,
    backgroundColor: dmsActive ? colors.accent : colors.fill,
    borderColor: dmsActive ? 'transparent' : colors.lineFaint,
    borderWidth: dmsActive ? 0 : 1,
  }, dmsActive ? glowShadow(colors.glow, 0.3, 8) : null]}>
    <Icon name="people" size={20} color={dmsActive ? colors.onAccent : colors.inkSoft} />
  </View>
  {dmUnread ? <View style={styles.badge}><Badge count={dmUnread} /></View> : null}
</Pressable>
```

- [ ] Import `DM_HOME_NAME` from `@/lib/dm-home`. (`glowShadow`, `radii`, `Badge`,
      `Icon` are already imported.)

---

## 6. Mobile screen — render the DM space

**File:** `src/app/(tabs)/rooms.tsx` *(edit)*

- [ ] Imports: add
      `import { DM_HOME_ID, isDmHomeId } from '@/lib/dm-home';`,
      change the existing `useDms` import to
      `import { useDms, useTotalDmUnread, type DmEntry } from '@/lib/use-dms';`, add
      `import { DmList } from '@/components/chat/DmList';`, and **remove** the
      `DirectMessagesSection` import.
- [ ] Compute DM-home state and guard `useRooms`:

```ts
const { spaces, activeId, setActiveId, loading: spacesLoading } = useSpaces();
const isDmHome = isDmHomeId(activeId);
const { categories, loading: roomsLoading, isPublic, memberCount, isOwner, createRoom, createCategory, moveRoom } =
  useRooms(isDmHome ? null : activeId);   // sentinel must never reach useRooms
const dms = useDms();
const dmUnread = useTotalDmUnread();
```

- [ ] Header: the DM space is **always present**, so always render `SpaceHeader`
      (drop the `AppBar` fallback). Pass the DM rail props + an `isDmHome` flag:

```tsx
header={
  <SpaceHeader
    space={isDmHome ? undefined : space}
    isDmHome={isDmHome}
    spaces={spaces}
    activeId={activeId ?? DM_HOME_ID}
    isPublic={isPublic}
    memberCount={memberCount}
    onSelectSpace={setActiveId}
    onSelectDms={() => setActiveId(DM_HOME_ID)}
    dmsActive={isDmHome}
    dmUnread={dmUnread}
    onAddSpace={() => router.push('/join')}
    onSearch={() => router.push('/search')}
    onOpenSpace={() => space && router.push({ pathname: '/space/[id]', params: { id: space.id, name: space.name } })}
    onMenu={() => router.push('/join')}
  />
}
```

- [ ] Body: branch on `isDmHome`. Remove the old `<DirectMessagesSection .../>`
      (line 108). When DM-home, render `<DmList .../>`; otherwise the existing
      categories block (unchanged):

```tsx
{!session ? (
  <SignInPrompt subtitle="Create an identity to see your spaces." />
) : spacesLoading || (!isDmHome && roomsLoading) ? (
  <ChannelListSkeleton />
) : isDmHome ? (
  // EmptyState is flex:1, which collapses inside a ScrollView content container —
  // give it a floor so the empty case centers. (rooms.tsx body is in a ScrollView.)
  <View style={{ minHeight: 320 }}>
    <DmList dms={dms} onOpen={openDm} />
  </View>
) : (
  <>
    {!online ? <OfflineBanner message="You’re offline — showing your last-synced rooms." /> : null}
    {categories.length === 0 && !isOwner ? (
      <EmptyState iconName="hash" title="No rooms yet" subtitle="Create a channel to get started." />
    ) : (
      <> {/* SidebarLinkRow(s) + RoomCategoryList — unchanged */} </>
    )}
  </>
)}
```

- [ ] `openDm` stays as-is (`router.push('/room/[id]', { id: dm.roomId, name: dm.name, kind: 'dm' })`).
- [ ] **Desktop resting state** (the `if (inShell) return <EmptyState .../>` block,
      lines 45-55): unchanged — desktop renders DMs in the sidebar (step 8).

> `space` can be `undefined` when the user has no real spaces and DM-home is active;
> every consumer above is already null-guarded (`space &&`, `space?.`).

---

## 7. `SpaceHeader` — DM-home title + forward rail props

**File:** `src/components/chat/SpaceHeader.tsx` *(edit)*

- [ ] Make `space` optional and add the DM props:

```ts
interface SpaceHeaderProps {
  space?: Space;            // undefined when the DM space is active
  isDmHome?: boolean;
  spaces: Space[];
  activeId: string;
  isPublic: boolean;
  memberCount?: number | null;
  onSelectSpace?: (id: string) => void;
  onSelectDms?: () => void;
  dmsActive?: boolean;
  dmUnread?: number;
  onAddSpace?: () => void;
  onSearch?: () => void;
  onMenu?: () => void;
  onOpenSpace?: () => void;
}
```

- [ ] In the title block: when `isDmHome`, show a `people`-glyph avatar substitute +
      "Direct Messages", suppress the privacy `SpaceMeta`, and make the title row
      **non-pressable** (no settings screen for a virtual space):

```tsx
<View style={styles.top}>
  {isDmHome ? (
    <View style={styles.titleRow}>
      <View style={styles.dmIcon}><Icon name="people" size={18} color={colors.accent} /></View>
      <View style={styles.titleCol}>
        <Txt variant="heading" weight="bold" numberOfLines={1}>{DM_HOME_NAME}</Txt>
      </View>
    </View>
  ) : space ? (
    <Pressable ...existing title row... />
  ) : null}
  <IconButton name="search" onPress={onSearch} accessibilityLabel="Search" />
  <IconButton name="plus" onPress={onMenu} accessibilityLabel="Join or create a space" />
</View>
<SpaceRail
  spaces={spaces}
  activeId={activeId}
  onSelect={onSelectSpace}
  onAdd={onAddSpace}
  onSelectDms={onSelectDms}
  dmsActive={dmsActive}
  dmUnread={dmUnread}
/>
```

- [ ] Imports: `Icon` from `@/components/ui/Icon`, `DM_HOME_NAME` from `@/lib/dm-home`,
      `useTheme` for `colors` (already used? add if missing).
- [ ] Add a `dmIcon` style ≈34×34 (matching the `Avatar size={34}` footprint), with
      `radii`, centered, `colors.accentBg` bg / `colors.accentBorder` border — theme
      tokens only, no hardcoded colors/sizes — so the header height matches a normal
      space.

---

## 8. Desktop — render the DM space in the sidebar

### 8a. `DesktopNav` — wire selection + guard BOTH fetch hooks

**File:** `src/components/chat/DesktopNav.tsx` *(edit)*

- [ ] Imports: `DM_HOME_ID, isDmHomeId` from `@/lib/dm-home`; add `useDms`,
      `useTotalDmUnread` from `@/lib/use-dms`.
- [ ] Compute + guard (note BOTH `useRooms` and `useSpaceNav`):

```ts
const isDmHome = isDmHomeId(activeId);
const navId = isDmHome ? null : activeId;   // never let the sentinel reach a fetch
const { categories, loading: roomsLoading, isPublic, memberCount, isOwner, createRoom, createCategory, moveRoom } =
  useRooms(navId);
const { hasThreads, hasPins } = useSpaceNav(navId);   // was useSpaceNav(activeId) — MUST change (line 36)
const dms = useDms();
const dmUnread = useTotalDmUnread();
```

> **`useSpaceNav(activeId)` at `DesktopNav.tsx:36` is the exact gap that reproduces
> the web-only-bug pattern** — it loads threads/pins for `dms-home`, a non-existent
> doc. Changing it to `useSpaceNav(navId)` is mandatory, not optional.

- [ ] Pass DM props to `DesktopSpacesRail`:

```tsx
<DesktopSpacesRail
  spaces={spaces}
  activeId={activeId}
  onSelect={selectSpace}
  onSelectDms={() => { setActiveId(DM_HOME_ID); router.push('/(tabs)/rooms'); }}
  dmsActive={isDmHome}
  dmUnread={dmUnread}
  onAdd={() => router.push('/join')}
  meLabel={meLabel}
  meAvatar={profile?.avatar}
  onOpenProfile={() => router.push('/(tabs)/you')}
/>
```

- [ ] Render the room sidebar for DM-home even when `space` is undefined. Replace the
      `{showRoomSidebar && (space ? <DesktopRoomSidebar .../> : <no-spaces fallback/>)}`
      block with a three-way branch:

```tsx
{showRoomSidebar &&
  (isDmHome ? (
    <DesktopRoomSidebar
      isDmHome
      dms={dms}
      userId={session?.userId ?? ''}
      activeRoomId={activeRoomId}
      onOpenRoom={openRoom}
    />
  ) : space ? (
    <DesktopRoomSidebar ...existing props... />
  ) : (
    /* existing no-spaces fallback (loading spinner / "No spaces yet") — unchanged */
  ))}
```

### 8b. `DesktopRoomSidebar` — DM-home mode

**File:** `src/components/chat/DesktopRoomSidebar.tsx` *(edit)*

- [ ] Add props: `isDmHome?: boolean;` and `dms?: DmEntry[];` (import `DmEntry` from
      `@/lib/use-dms`, `DmList` from `./DmList`, `DM_HOME_NAME` from `@/lib/dm-home`).
      Make `space`, `isPublic`, `categories` optional (absent in DM-home).
- [ ] Remove the existing `<DirectMessagesSection .../>` (line 173) and its import.
- [ ] At the top of the render, branch: when `isDmHome`, reuse the sidebar shell
      (`styles.sidebar`, header, `ScrollView`) with a "Direct Messages" header and
      `<DmList .../>` instead of the nav group + categories:

```tsx
if (isDmHome) {
  return (
    <View style={[styles.sidebar, { width: layout.sidebarWidth, backgroundColor: colors.paperAlt, borderRightColor: colors.lineSoft }]}>
      <View style={[styles.header, { borderBottomColor: colors.lineFaint }]}>
        <View style={styles.headerText}>
          <Txt variant="subhead" weight="semibold" numberOfLines={1}>{DM_HOME_NAME}</Txt>
        </View>
        <Icon name="people" size={15} color={colors.inkMuted} />
      </View>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        <DmList
          dms={dms ?? []}
          activeRoomId={activeRoomId}
          onOpen={(dm) => onOpenRoom({ id: dm.roomId, spaceId: dm.spaceId, category: '', name: dm.name, kind: 'dm' })}
        />
      </ScrollView>
    </View>
  );
}
// ...existing normal-space render unchanged below...
```

> Reuses the existing `styles` (`sidebar`, `header`, `headerText`, `list`,
> `listContent`) — no new layout constants. Header is non-pressable (no settings) and
> omits `SpaceMeta`.

---

## 9. Default selection (optional polish)

**File:** `src/lib/spaces-context.tsx` *(edit, optional)*

- [ ] So a brand-new identity with **no spaces** lands somewhere meaningful, fall back
      the default `activeId` to the DM space instead of `null`:
      - line ~68: `setActiveId((prev) => prev ?? rail[0]?.id ?? DM_HOME_ID);`
      - line ~112 (primed branch): `setActiveId((prev) => prev ?? rail[0]?.id ?? DM_HOME_ID);`
      - import `DM_HOME_ID` from `@/lib/dm-home`.

> **New-user dead-end caveat:** a brand-new identity has no spaces AND no DMs, so
> landing on DM-home shows "open a profile and tap Message" — but they share no
> private space with anyone yet, so there's no one to DM and no rail tile besides DM
> + the `+`. The desktop no-spaces fallback surfaces a prominent "Join a space" CTA;
> DM-home does not. If that matters, **skip this step** and keep `null`/first-space as
> the default — the DM tile is always tappable regardless, and a user with no spaces
> still sees the desktop "Join a space" branch. Recommended: skip step 9 for v1.

---

## 10. Parity & cleanup checklist

- [ ] `DirectMessagesSection.tsx` deleted; no remaining imports
      (`grep -rn DirectMessagesSection src` returns nothing).
- [ ] DM tile appears **first** on BOTH `SpaceRail` (mobile) and
      `DesktopSpacesRail` (desktop), with the `people` glyph and no privacy corner.
- [ ] BOTH `useRooms` AND `useSpaceNav` receive `null` (never `DM_HOME_ID`) in
      `rooms.tsx` and `DesktopNav.tsx`.
- [ ] DMs no longer appear at the top of any normal space's room list.
- [ ] `pnpm typecheck` is clean.

---

## 11. Manual QA (no automated tests)

Run `pnpm web` and a native target (`pnpm ios`/`pnpm android`).

**Mobile (native + mobile-web):**
- [ ] DM tile is the first rail tile, `people` glyph, no lock/globe corner.
- [ ] Tapping it: header becomes "Direct Messages", body lists DM rows.
- [ ] With ≥1 DM: rows show peer monogram + name + unread; tapping opens the DM room.
- [ ] With 0 DMs: empty state explains how to start a DM (and is vertically centered).
- [ ] Switching to a real space tile restores that space's channels; DM tile loses
      the active ring.
- [ ] No "Direct Messages" section at the top of a normal space anymore.
- [ ] DM-tile badge equals the sum of per-DM unread; clears as DMs are read.

**Desktop (wide web / tablet):**
- [ ] DM tile first in the vertical rail; selecting it shows the "Direct Messages"
      sidebar with DM rows (or empty state).
- [ ] Selecting a real space restores its sidebar; rail highlight tracks selection.
- [ ] No DM section above a normal space's categories.

**Regression:**
- [ ] Opening a normal channel, threads, automations, search, space settings all work.
- [ ] A per-peer DM space settings screen (`/space/[id]` for a `dm-…` id) still hides
      CATEGORIES + INVITE (the earlier change) and is unaffected by this work.
- [ ] New identity with no spaces: lands on first-space/null (step 9 skipped) and the
      desktop "Join a space" CTA still shows; DM tile is tappable and shows its empty
      state.

---

## File-change summary

| File | Action |
|------|--------|
| `src/lib/dm-home.ts` | **new** — sentinel id, name, `isDmHomeId` |
| `src/lib/use-dms.ts` | add `useTotalDmUnread()` |
| `src/components/chat/DmList.tsx` | **new** — DM rows + empty state |
| `src/components/chat/DirectMessagesSection.tsx` | **delete** |
| `src/components/chat/SpaceRail.tsx` | leading DM tile + `icon` RailItem variant + props |
| `src/components/chat/DesktopSpacesRail.tsx` | leading DM tile + props |
| `src/components/chat/SpaceHeader.tsx` | optional `space`, `isDmHome` title, forward DM rail props |
| `src/components/chat/DesktopRoomSidebar.tsx` | `isDmHome` mode renders `DmList`; remove DM section |
| `src/components/chat/DesktopNav.tsx` | wire DM selection, guard `useRooms` + `useSpaceNav`, DM-home sidebar branch |
| `src/app/(tabs)/rooms.tsx` | DM-home branch, guard `useRooms`, remove DM section, always-`SpaceHeader` |
| `src/lib/spaces-context.tsx` | *(optional, recommended skip)* default `activeId` → `DM_HOME_ID` |
