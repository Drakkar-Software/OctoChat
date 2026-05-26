# Examples

Standalone, runnable examples that integrate with an OctoChat / Starfish backend
using only the published `@drakkar.software/starfish-*` SDK — no app code. They sit
**outside** the pnpm workspace (`apps/*`, `packages/*`), so they don't affect the
app's `pnpm install` or `pnpm typecheck`; each example installs on its own.

| Example | What it shows |
| --- | --- |
| [`stream-webhook-bot`](./stream-webhook-bot) | Use `/events` as a webhook trigger and append to a public stream room as a bot (audience-cap `createPublicLink` → `redeemPublicLink`). |
