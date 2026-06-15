# Key rotation after member removal (forward-secrecy upgrade)

## Status: documented future work

Roster eviction (shipped in this branch) is the current implementation. This document
specifies the **heavier re-key path** to be picked up when forward secrecy is required.

---

## Why

Roster eviction (`_access.members` removal) denies a removed member all *new* server
reads immediately — `apps/server/src/space-role.ts`'s `makeSpaceRoleEnricher` re-reads
the roster on every request and revokes `space:member` on the next call. However, the
removed member keeps the space keyring CEK they already hold, so any ciphertext they
already pulled (messages, attachments) **stays readable**. To close that gap,
rotate the space keyring epoch on removal so a fresh CEK is wrapped only for retained
members — the removed member's decrypt key is then permanently useless for new content.

---

## Cryptographic model

A space has ONE keyring at `spaces/{spaceId}/_keyring`, keyed by member **KEM (X25519)
pubkeys** (`subKem`), with `userId` carried as metadata per entry. The roster
(`_access.members`) is keyed by **userId**. The two are bridged only at invite time:
`inviteToSpace` (`packages/sdk/src/starfish/members.ts`) calls both
`addCollectionRecipient` (keyring) and `addSpaceMember` (roster) in sequence.

`@drakkar.software/starfish-keyring@3.0.0-alpha.27` already exports the needed
primitives — OctoChat currently imports **none** of them except `addCollectionRecipient`:

| Function | Exported? | Used in OctoChat? |
|---|---|---|
| `addCollectionRecipient` | ✓ | ✓ (`members.ts`) |
| `removeRecipient` | ✓ | ✗ |
| `rotateEpoch` | ✓ | ✗ |
| `listRecipients` | ✓ | ✗ |
| `currentEpoch` | ✓ | ✗ |

`removeRecipient(client, collectionName, removeSubKems[], adder, opts)` — rotates the
epoch, drops the named recipients, mints a fresh CEK, re-wraps for every retained KEM.
Returns `{ newEpoch }`.

---

## Implementation approach

New owner-side function in `packages/sdk/src/starfish/members.ts`:

```ts
import { listRecipients, removeRecipient } from '@drakkar.software/starfish-keyring';
import { keyringName } from './paths';

/**
 * Owner: remove a member from the space — rotate keyring epoch (true forward
 * secrecy) then evict from the roster. Use this instead of the app-level
 * `removeMember` hook when cryptographic removal is required.
 */
export async function removeMemberFromSpace(
  session: Session,
  spaceId: string,
  memberUserId: string,
): Promise<void> {
  // 1. Resolve the member's KEM pubkey from the live keyring recipient list.
  //    More reliable than readProfile().kemPub — profile can rotate after join.
  const recipients = await listRecipients(session.chatClient, keyringName(spaceId));
  const recipient = recipients.find((r) => r.userId === memberUserId);
  if (!recipient) throw new Error('Member has no keyring entry — roster-only eviction required.');

  // 2. Rotate the epoch, dropping only this member's KEM. Retained members get
  //    the fresh CEK; the removed member's key is useless for new messages.
  //    ROTATE FIRST so even if the roster write below fails, new ciphertext is safe.
  await removeRecipient(
    session.chatClient,
    keyringName(spaceId),
    [recipient.subKem],
    { edPriv: session.keys.edPriv, edPub: session.keys.edPub, kemPriv: session.keys.kemPriv },
    { trustedAdders: [session.keys.edPub] },
  );

  // 3. Evict from the roster (revokes space:member server-side).
  const spaceClient = getSpaceClient(spaceId, session);
  const { owner, members: roster, name, image, hash } = await readSpaceAccess(spaceClient, spaceId);
  if (roster.includes(memberUserId)) {
    await writeSpaceAccess(
      spaceClient, spaceId, owner ?? session.userId,
      roster.filter((m) => m !== memberUserId), hash,
      { name, image },
    );
  }
}
```

Then in `use-space-settings.ts`, the existing `removeMember` callback can delegate to
this SDK function instead of the roster-only write.

Export is automatic — `packages/sdk/src/index.ts` already does
`export * from './starfish/members'`.

---

## Ordering & atomicity

**Rotate FIRST, then shrink the roster.** If the roster write fails after a successful
rotation, the member is locked out of new content anyway (new epoch CEK is already set).
The failure mode where we roster-evict but forget to rotate is the dangerous one — the
ex-member keeps decrypt access to new messages. Surface a clear error if the roster
write fails; the keyring is still the authoritative gate.

---

## Forward secrecy caveat

Rotation protects **post-rotation messages only**. Old-epoch docs stay readable to
old-epoch recipients (incl. the removed member) — standard group-E2EE semantics, not a
retroactive lockout. Retained members transparently re-pull the new epoch's CEK via
`buildEncryptor` on their next access (cf. per-epoch CEK notes in
`packages/sdk/src/starfish/attachments.ts`). This is expected and acceptable.

---

## Risks to verify before implementing

### 1. Adder signing on paired / secondary owner devices

Keyring entries are ROOT-signed (see `ownerTrustedAdders` in
`packages/sdk/src/starfish/client.ts:134-155`). The `trustedAdders` pin must reference
the **cap issuer** (`capCert.iss`), not the current device's `edPub` — the same trap
as device pairing (`[[octochat-device-pairing-linked-account]]` in memory). A
QR-paired secondary owner device may lack the root key and therefore be unable to call
`removeRecipient` successfully. This needs a device-pairing test before shipping.

### 2. Server enricher allows keyring epoch shrink

The `space:owner`-gated keyring write is expected to allow epoch bumps and recipient
shrinks (same gate as grows), but this has not been verified end-to-end against the
deployed `makeSpaceRoleEnricher`. Verify with a live call before relying on it.

### 3. Bot / automation recipients must be retained

Automation bots are real keyring recipients (`addDeviceToSpaceKeyring` is called for
them at space-creation time). They are filtered from the human member list in the UI
(`humanMembers`, `automationBotUserIds`) but **still appear in the keyring**. When
calling `removeRecipient`, only the target member's `subKem` is removed — retained
KEMs include bots. Verify that `listRecipients` returns bot entries correctly keyed
by their `userId` so the match logic (`r.userId === memberUserId`) doesn't
accidentally capture them.

### 4. Member with no keyring entry

A member who joined via a public invite link may be in the roster but not in the
keyring (public spaces have no E2EE). In that case `listRecipients` returns nothing for
their userId; the implementation above throws — add a fallback to roster-only eviction
for non-encrypted spaces (`!room.enc`).

---

## Verification checklist

1. Two identities via loopback origins (see memory: `octochat-multiuser-web-test-loopback-origins`).
2. Owner removes member B via the re-key path.
3. After removal, post-rotation message: B cannot decrypt (CEK mismatch). A retained
   member C CAN decrypt after pulling the updated keyring.
4. Old pre-rotation messages: B can still decrypt (expected — not a retroactive lockout).
5. `pnpm typecheck` + `pnpm --filter @octochat/mobile test` green.
6. Verify server allows the epoch-bump write (check server logs for `space:owner` grant
   on keyring PUSH).
