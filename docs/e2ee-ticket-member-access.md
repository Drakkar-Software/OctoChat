# Design: All Space Members Can Read Accepted E2EE Tickets

> Status: **proposed** — not yet implemented. This doc captures the approach for a
> future dedicated pass.

## Problem

Today an accepted E2EE ticket (`access:'invite'` + `enc:true`) is readable only by:
- the **space owner** (who holds the per-node keyring via `ownerEnsureNodeKeyring`)
- the **requester** (granted via the original `inviteToNode` accept flow)
- any **explicitly assigned agent** (`assignTicket` in `orchestrator.ts`)

All other space members (support teammates, co-owners) cannot read the ticket — not
its sealed header (`readSealedTicketInfo` returns null) and not its messages. The
user asked for all keyring space members to have access when the owner accepts a
ticket.

## Why one grant is not enough

Reading an E2EE ticket requires **two** separate grants:

| Grant | What it provides | How it's minted |
|---|---|---|
| **Decrypt** | keyring recipiency + `nodekeyring` read cap | `addNodeKeyringRecipient` or `inviteToNode` |
| **Fetch** | per-node `objinvlog` stream cap | `inviteToNode` (full bundle) or `ensureDeskNodeStreamAccess` (owner-only) |

`addNodeKeyringRecipient` (used by `assignTicket` in `orchestrator.ts:106`) gives
decryption ONLY. The member still cannot **fetch** the `objinvlog` stream because:
- `space:member` scope does NOT cover `objinvlog` (excluded in `starfish-spaces`
  scope definitions)
- `node:member` scope also does NOT cover `objinvlog`
- Presenting either cap → server 403

Calling `addNodeKeyringRecipient` alone is therefore **insufficient** for member
ticket access.

## Recommended approach

### Step 1 — Mint full per-node access via `inviteToNode`

The SDK function `inviteToNode(session, spaceId, nodeId, joinReqJson, {enc:true},
name, {isolated:true})` mints the complete bundle in one call:
- keyring recipiency
- `nodekeyring` read cap (→ decrypt)
- `nodeCap` (node membership)
- `streamCap` (→ fetch `objinvlog`)

It only needs a signed **JoinRequest** JSON. A member's published profile
`{edPub, kemPub, userId, kemSig}` IS a valid JoinRequest — `parseJoinRequest`
validates `kemSig` against `edPub`, and the profile already carries `kemSig`
(`kemPub` signed by `edPriv`). So no separate join ceremony is needed.

### Step 2 — Fan out to space members at accept time

Add a new SDK function (e.g. in `packages/sdk/src/desk/member-access.ts`):

```ts
/**
 * Grant full read access to an accepted E2EE ticket node for all current space
 * members. Mints a complete bundle (decrypt + fetch) per member via `inviteToNode`
 * and delivers it to each member's inbox as a node grant so they can claim it.
 * Best-effort: one member's failure does not abort the rest.
 */
export async function grantTicketToSpaceMembers(
  session: Session,
  spaceId: string,
  ticketId: string,
  title: string,
): Promise<void>
```

Implementation sketch:
1. `readSpaceAccess(client, spaceId, session).members` → `userIds[]`; exclude the
   owner (`session.userId`) and the original requester (held in the sealed ticket
   header or passed in).
2. Batch-read `readProfiles(members)` → `{edPub, kemPub, kemSig}` per member.
   **Skip** any member without a published `kemPub` (can't build a JoinRequest).
3. Per member: build JoinRequest JSON from profile →
   `inviteToNode(session, spaceId, ticketId, joinReqJson, {enc:true}, title,
   {isolated:true})` → grants bundle.
4. Seal the bundle to the member's inbox (the `acceptResourceGrant`-compatible grant
   carrier used by the existing requester flow).
5. Catch + log per-member errors; don't abort the batch.

### Step 3 — Call at accept time

In `packages/sdk/src/desk/intake.ts`, after `writeSealedTicketInfo` in **both** accept paths:
- `acceptNodeRequest` (manual accept, ≈ line 218)
- `reconcileTicketRequests` auto-accept loop (≈ line 134)

Guard with `enc && pending.req.nodeType === 'ticket'`. Wrap in `try/catch`
(best-effort, mirrors the `writeSealedTicketInfo` guard).

### Step 4 — Member-side claim (the missing half)

Today `claimGrantedNodes` (in `requester.ts:247`) calls `acceptResourceGrant`
(stores per-node caps) but then injects a **synthetic guest Space** via
`addJoinedSpace` / `buildSpace`. That is correct for a *requester* who has no
existing space entry, but WRONG for a space member who already has the space in their
registry — it would add a duplicate/phantom space entry.

Add a **ticket-grant claim variant** (e.g. `claimMemberTicketGrants`) that:
- calls `acceptResourceGrant` (stores the per-node caps)
- does NOT call `addJoinedSpace`

Wire it to run periodically for the current user across their **member** spaces
(e.g. inside `spaces-context.tsx`'s `refresh()`, analogous to how `reconcileDmInbox`
is called there). Today only the requester claims grants
(`use-resource-request.ts` → `useResourceRequest`).

After claiming, `readSealedTicketInfo` + the normal `buildNodeAccessShared` path
(`access:'invite'`, `enc:true`) let the member fetch + decrypt the ticket header
and messages without any further changes.

## Open questions / caveats

| Question | Options |
|---|---|
| **Future members** (join after accept) | (a) Re-run `grantTicketToSpaceMembers` for open tickets on each reconcile pass — adds O(members × open-tickets) cap mints but auto-heals; (b) Accept the gap — teammates who join later don't see old tickets. |
| **Member leave / revocation** | Keyring rotation + `objinvlog` cap invalidation are out of scope here. Track as a follow-up (cf. `revokeTicketAgent` in `orchestrator.ts`). |
| **Large teams** | O(members × open-tickets) cap mints + inbox writes. Throttle `grantTicketToSpaceMembers` for teams > N members; fine for small teams. |
| **Members without published kemPub** | Skip at grant time (cannot build JoinRequest). They can publish their profile later; the next reconcile grants them at that point (if option (a) above is chosen). |

## Reference file pointers (from research)

| Symbol | File | Purpose |
|---|---|---|
| `inviteToNode` | `@drakkar.software/starfish-spaces` | The one call that mints decrypt + fetch in a bundle |
| `addNodeKeyringRecipient` | `@drakkar.software/starfish-spaces` | Decrypt-only (what `assignTicket` uses) |
| `acceptResourceGrant` | `@drakkar.software/starfish-spaces` | Claim-side: stores per-node caps |
| `claimGrantedNodes` | `packages/sdk/src/desk/requester.ts:247` | Current requester-side claim (with guest-space injection) |
| `assignTicket` | `packages/sdk/src/desk/orchestrator.ts:106` | Template showing decrypt-only path |
| `ensureDeskNodeStreamAccess` | `packages/sdk/src/desk/registry-write.ts:57` | Owner self-heal for `objinvlog` stream cap |
| `writeSealedTicketInfo` | `packages/sdk/src/desk/intake.ts:34` | Call sites for the new fan-out (after these calls) |
| `acceptNodeRequest` | `packages/sdk/src/desk/intake.ts:202` | Manual accept path — call fan-out here |
| `reconcileTicketRequests` | `packages/sdk/src/desk/intake.ts:92` | Auto-accept path — call fan-out here |
| `readSpaceAccess` | `@drakkar.software/starfish-spaces` | Get member list for fan-out |
| `readProfiles` | `@drakkar.software/octochat-sdk` | Batch-read member profiles for JoinRequest construction |
