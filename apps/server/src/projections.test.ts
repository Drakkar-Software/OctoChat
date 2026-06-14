import { describe, it, expect } from "vitest";
import type { WriteEvent } from "@drakkar.software/starfish-protocol";

import {
  countPublicRooms,
  projectObjIndex,
  projectSpaceRegistry,
} from "./projections.js";

// Minimal WriteEvent factory — only the fields our functions read.
function makeEvent(
  params: Record<string, string>,
  body?: unknown,
  timestamp = 1_000_000,
): WriteEvent {
  return { params, body, timestamp } as unknown as WriteEvent;
}

// ── countPublicRooms ──────────────────────────────────────────────────────────

describe("countPublicRooms", () => {
  it("returns 0 for non-object / null / undefined body", () => {
    expect(countPublicRooms(null)).toBe(0);
    expect(countPublicRooms(undefined)).toBe(0);
    expect(countPublicRooms("string")).toBe(0);
    expect(countPublicRooms(42)).toBe(0);
  });

  it("returns 0 when `objects` is missing or not an array", () => {
    expect(countPublicRooms({})).toBe(0);
    expect(countPublicRooms({ objects: "nope" })).toBe(0);
    expect(countPublicRooms({ objects: null })).toBe(0);
  });

  it("counts only room nodes with access='public' that are not archived", () => {
    const objects = [
      { type: "room", access: "public" },        // ✓ counts
      { type: "room", access: "public" },        // ✓ counts
      { type: "room", access: "space" },         // ✗ not public
      { type: "room", access: "invite" },        // ✗ not public
      { type: "room", access: "public", archived: true }, // ✗ archived
      { type: "category", access: "public" },   // ✗ not a room
      { type: "room" },                          // ✗ no access field
      null,                                      // ✗ non-object element
      "garbage",                                 // ✗ non-object element
    ];
    expect(countPublicRooms({ objects })).toBe(2);
  });

  it("returns 0 for an empty objects array", () => {
    expect(countPublicRooms({ objects: [] })).toBe(0);
  });

  it("treats archived=false as live (not archived)", () => {
    expect(countPublicRooms({ objects: [{ type: "room", access: "public", archived: false }] })).toBe(1);
  });
});

// ── projectObjIndex ───────────────────────────────────────────────────────────

describe("projectObjIndex", () => {
  it("returns null when spaceId is absent", () => {
    const e = makeEvent({}, { objects: [{ type: "room", access: "public" }] });
    expect(projectObjIndex(e)).toBeNull();
  });

  it("returns remove:true when the space has zero public rooms", () => {
    const e = makeEvent({ spaceId: "sp1" }, { objects: [{ type: "room", access: "space" }] });
    expect(projectObjIndex(e)).toEqual({ id: "sp1", remove: true });
  });

  it("returns remove:true for an empty objects array", () => {
    const e = makeEvent({ spaceId: "sp1" }, { objects: [] });
    expect(projectObjIndex(e)).toEqual({ id: "sp1", remove: true });
  });

  it("returns an upsert value with publicRooms count and timestamp", () => {
    const body = {
      objects: [
        { type: "room", access: "public" },
        { type: "room", access: "public" },
        { type: "room", access: "space" },
      ],
    };
    const e = makeEvent({ spaceId: "sp2" }, body, 999_888);
    expect(projectObjIndex(e)).toEqual({
      id: "sp2",
      value: { publicRooms: 2, ts: 999_888 },
    });
  });

  it("excludes archived public rooms from the count (remove when all archived)", () => {
    const e = makeEvent(
      { spaceId: "sp3" },
      { objects: [{ type: "room", access: "public", archived: true }] },
    );
    expect(projectObjIndex(e)).toEqual({ id: "sp3", remove: true });
  });
});

// ── private-space exclusion invariant ────────────────────────────────────────
//
// Both projections now target `_index/spaces/public`. Security property:
//   - projectSpaceRegistry emits { name, image } for ANY space (including private).
//   - projectObjIndex emits `remove: true` for spaces with zero public rooms.
//   - loadPublicSpaceIndex filters entries where publicRooms === 0 or absent.
//
// So private-space names land in the raw shard but are never shown in the Explore
// screen. The tests below document the critical invariant: projectSpaceRegistry's
// value has NO publicRooms field, which is what the client filter keys on.

describe("private-space exclusion invariant", () => {
  it("projectSpaceRegistry value has no publicRooms — client filter drops it", () => {
    const e = makeEvent({ spaceId: "sp-private" }, { name: "Secret Reef", image: null });
    const op = projectSpaceRegistry(e);
    // The op exists (name is emitted to the shard)…
    expect(op).not.toBeNull();
    expect((op as { id: string }).id).toBe("sp-private");
    // …but the value has no publicRooms field, which is the field toPublicEntry filters on.
    const value = (op as { value: Record<string, unknown> }).value;
    expect(value.publicRooms).toBeUndefined();
    // (The client's toPublicEntry returns null for entries without publicRooms > 0,
    // so this space will not appear in the Explore screen.)
  });

  it("projectObjIndex emits remove:true for a space with no public rooms", () => {
    const e = makeEvent({ spaceId: "sp-private" }, { objects: [{ type: "room", access: "space" }] });
    expect(projectObjIndex(e)).toEqual({ id: "sp-private", remove: true });
    // After this fires, the entry is removed from the public shard entirely, including
    // any name/image previously written by projectSpaceRegistry.
  });
});

// ── projectSpaceRegistry ──────────────────────────────────────────────────────

describe("projectSpaceRegistry", () => {
  it("returns null when spaceId is absent", () => {
    const e = makeEvent({}, { name: "Coral Reef", image: "🌊" });
    expect(projectSpaceRegistry(e)).toBeNull();
  });

  it("extracts name and image from the body", () => {
    const e = makeEvent({ spaceId: "sp1" }, { name: "Reef", image: "img.png" });
    expect(projectSpaceRegistry(e)).toEqual({
      id: "sp1",
      value: { name: "Reef", image: "img.png" },
    });
  });

  it("returns null for name/image when they are missing or non-string", () => {
    const e = makeEvent({ spaceId: "sp1" }, { name: 42, image: null });
    expect(projectSpaceRegistry(e)).toEqual({
      id: "sp1",
      value: { name: null, image: null },
    });
  });

  it("handles a completely absent / null body gracefully", () => {
    const e = makeEvent({ spaceId: "sp1" }, undefined);
    expect(projectSpaceRegistry(e)).toEqual({
      id: "sp1",
      value: { name: null, image: null },
    });
  });

  it("handles an empty body object", () => {
    const e = makeEvent({ spaceId: "sp1" }, {});
    expect(projectSpaceRegistry(e)).toEqual({
      id: "sp1",
      value: { name: null, image: null },
    });
  });
});
