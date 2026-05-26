# Examples

Standalone, runnable examples that integrate with an OctoChat / Starfish backend
using only the published `@drakkar.software/starfish-*` SDK — no app code. They sit
**outside** the pnpm workspace (`apps/*`, `packages/*`), so they don't affect the
app's `pnpm install` or `pnpm typecheck`; each example installs on its own.

| Example | Language(s) | What it shows |
| --- | --- | --- |
| [`stream-publish-bot`](./stream-publish-bot) | TS + Python | Publish one message into a public stream room as a bot, then exit — the **post** half only (audience-cap `createPublicLink` → `redeemPublicLink`). No `/events`. |
| [`stream-webhook-bot`](./stream-webhook-bot) | TS | Use `/events` as a webhook trigger **and** append to a public stream room as a bot — the trigger + post halves wired together. |

Some examples ship a single language at the example root (e.g. `stream-webhook-bot/`);
two-language ones split into `ts/` and `python/` subfolders that mirror each other.
