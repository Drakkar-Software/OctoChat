# Examples

Runnable examples that integrate with an OctoChat / Starfish backend. They sit
**outside** the pnpm workspace (`apps/*`, `packages/*`), so they don't affect the
app's `pnpm install` or `pnpm typecheck`.

Most use **only** the published `@drakkar.software/starfish-*` SDK — no app code —
and install standalone. The exception is `dm-via-link`, which needs the
**end-to-end-encrypted DM machinery** that lives only in the in-repo
`@drakkar.software/octochat-sdk`; it runs from the repo root against the workspace
deps rather than installing on its own (see its README).

| Example | Language(s) | What it shows |
| --- | --- | --- |
| [`stream-publish-bot`](./stream-publish-bot) | TS + Python | Publish one message into a public stream room as a bot, then exit — the **post** half only (audience-cap `createPublicLink` → `redeemPublicLink`). No `/events`. |
| [`stream-webhook-bot`](./stream-webhook-bot) | TS | Use `/events` as a webhook trigger **and** append to a public stream room as a bot — the trigger + post halves wired together. |
| [`dm-via-link`](./dm-via-link) | TS *(Python n/a)* | From a fresh identity, open an **E2EE DM** from a user's `…/dm#…` profile link and send a message + image + file, then fetch the conversation. Uses the in-repo OctoChat SDK; [Python isn't feasible](./dm-via-link#python--not-provided-and-why) (the DM/keyring layer is TS-only). |
| [`create-ticket`](./create-ticket) | TS *(Python n/a)* | From a fresh agent identity, create an **OctoDesk ticket** in a new space, send a reply, update the status to `pending`, assign it, and read the conversation back. Uses the in-repo OctoChat SDK; Python port not feasible (OctoDesk layer is TS-only). |

Some examples ship a single language at the example root (e.g. `stream-webhook-bot/`);
two-language ones split into `ts/` and `python/` subfolders that mirror each other.
