# OctoChat DM via "DM me" link

From a **fresh identity**, open an **end-to-end-encrypted 1:1 DM** with someone
using **only their shareable profile link** — no space in common, no prior
contact — then **send a message + an image + a file** and **fetch the
conversation back**.

```
  new identity ──decode link──▶ token ──createDmViaLink──▶ dm space + room
       │                                                       │
       └── send: text · image attachment · file attachment ────┤
                                                                │
       fetch (pull + decrypt the append-log) ◀──────────────────┘
```

A **DM link** (`…/dm#<token>`) is just the owner's **identity made portable** —
their userId, display pseudo and published public keys (Ed25519 + KEM),
base64url-packed into a URL fragment. Opening it reuses the normal DM machinery:
a private `dm-` space with a keyring, a member cap, and an **anonymous sealed
delivery** into the owner's inbox. This example exercises the **sender's** side
(open → post → read-back), which is self-contained; the owner auto-accepts on
their own reconcile (the full both-sides loop is the SDK's
[`dm-link.e2e.test.ts`](../../packages/sdk/src/starfish/dm-link.e2e.test.ts)).

## How this differs from the bot examples

The [`stream-*-bot`](../stream-publish-bot) examples use **only** the published,
raw `@drakkar.software/starfish-*` SDK — they sign a request and append a
**plaintext** envelope to a **public** room. The DM flow is a different animal:
identity derivation, **keyring E2EE**, the DM-link token, and **sealed-inbox
delivery** all live in the TypeScript **`@drakkar.software/octochat-sdk`** (the
headless OctoChat core in [`packages/sdk`](../../packages/sdk)).

That package isn't published to npm, so this example **imports it by relative
path to its built entry** (`packages/sdk/dist/index.js`) and runs against the
**workspace's hoisted dependencies**. It is therefore **not** standalone-
installable like the bot examples — run it from inside the repo (below).

## Configure

```bash
cp .env.example .env        # optional — the defaults run end-to-end as-is
```

| Var | Default | Meaning |
| --- | --- | --- |
| `STARFISH_URL` | `http://localhost:8787` | Sync server base URL. |
| `STARFISH_NAMESPACE` | *(empty)* | Bare namespace for a deploy (`octochat`); empty for local. |
| `DM_LINK` | *(empty)* | A **real** user's `…/dm#<token>` link (or bare `#<token>`). **Empty** ⇒ the example self-creates a recipient so it runs with zero setup. |
| `SENDER_NAME` | `Reef Wanderer` | Display name of the fresh identity doing the messaging. |
| `RECIPIENT_NAME` | `Coral Friend` | Display name of the self-created peer (only used when `DM_LINK` is empty). |

## Run — TypeScript

This example consumes the **in-repo** SDK, so run it from the repo root (reuses
the workspace's hoisted deps + `tsx` — no per-example install):

```bash
# from the repo root
pnpm --filter @drakkar.software/octochat-sdk build   # ensure dist/ is current
node_modules/.bin/tsx examples/dm-via-link/ts/src/dm.ts
```

Point it at a fresh local server (no NATS / Whistlers needed):

```bash
STARFISH_DATA_DIR=$(mktemp -d) PORT=8799 pnpm --filter @octochat/server start &
STARFISH_URL=http://127.0.0.1:8799 \
  node_modules/.bin/tsx examples/dm-via-link/ts/src/dm.ts
```

Typecheck: `node_modules/.bin/tsc -p examples/dm-via-link/ts/tsconfig.json`.

## What you'll see

```
[dm] OctoChat DM-via-link example
[dm] server   http://127.0.0.1:8799  (local, no namespace)
[dm] recipient created "Coral Friend" (b6c5bbc4…) → https://octochat.app/dm#eyJ2Ijox…
[dm] sender    "Reef Wanderer" (c1b1b490…)
[dm] opened DM with Coral Friend → space dm-d91eda0b51c17843db9a8f4bd0f1711f
[dm] sent image  reef.png (70 B, kind=image)
[dm] sent file   hello.txt (74 B, kind=file)
[dm] sent text   "Hey! 👋 …"
[dm] fetched 3 message(s) from the DM:
[dm]   Reef Wanderer: 📎 reef.png [image] — 70 B decrypted
[dm]   Reef Wanderer: 📎 hello.txt [file] — 74 B decrypted
[dm]   Reef Wanderer: Hey! 👋 Starting an encrypted DM straight from your link.
[dm] done.
```

## Python — not provided (and why)

The sibling bot examples ship a Python mirror because they only need **raw**
Starfish operations (sign a request, append a plaintext envelope, mint/redeem a
public cap), all exposed by the published Python `starfish-*` SDK.

This example does **not** have a Python port. The blocker is **not** missing
crypto — the Python SDK does expose the low-level primitives (`starfish-identities`
for Ed25519, `starfish-keyring` for the keyring cipher, `starfish-sharing` for
caps, `starfish-protocol` for signing). The blocker is that the entire **DM
protocol layer** lives only in the TypeScript `@drakkar.software/octochat-sdk`
and has no Python counterpart:

- the **DM-link token** format + identity binding (`dm-link.ts`),
- **`createDmViaLink`**: private `dm-` space creation, keyring mint, member-cap
  `inviteToSpace`, the X25519 **account-seal**, and the **anonymous sealed
  delivery** into `dminbox/<ownerId>/<month>` (`dm.ts`, `members.ts`,
  `account-seal.ts`, `paths.ts`),
- the **space keyring encryptor** that seals each message envelope and each
  attachment blob (`attachments.ts`, keyring ops via octospaces-sdk),
- the registry/`_spaces` doc shapes and `reconcileDmInbox`.

Mirroring that in Python means re-implementing a dozen interdependent modules and
keeping them **byte-compatible** with the TS wire format — a substantial port
that would drift from the source, not an example. A `python/` mirror only becomes
practical once the OctoChat DM core is published with a Python counterpart (or
extracted to a language-neutral spec).

## What's been checked

- **TypeScript** — typechecked (`tsc --noEmit`) against the in-repo
  `@drakkar.software/octochat-sdk`, **and run end-to-end against a local
  `apps/server`** (the output above is a real run): both identities created, DM
  opened from the link, image + file + text sent, then all three fetched back and
  the attachments decrypted.
- **Python** — intentionally absent; see the section above.
