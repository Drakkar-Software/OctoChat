# Migration: OctoChat automations scheduling → `expo-conductor`

> **Repo scope (OctoChat):** this is the sole home of this migration — all the
> app-side rewiring described below happens in `apps/mobile/src/lib/automations/*`.
> Starfish needs no changes (it's the sync backend; the automations registry rides
> on existing documents and the wire format is unchanged). The `expo-conductor`
> feature delta is captured below rather than in that repo, which is out of scope.
>
> **Status:** DONE (pending on-device verification + a lib republish). The
> `expo-conductor` feature delta (single-flight leader election + web `appState`
> firing) shipped on `master` of that repo and is published as
> `@drakkar.software/expo-conductor` (bump to `0.1.1` carries the post-review
> handoff fixes — republish to pick them up). The app-side rewiring below is
> implemented and `pnpm typecheck`-clean; what remains is a native prebuild +
> on-device run (the JS handler / OS-wake bridge / native `appState` can't be
> verified from a typecheck alone). See [Outcome](#outcome) at the end.

## Goal

Replace OctoChat's bespoke, platform-branched automation scheduler with the
[`expo-conductor`](https://github.com/Herklos/expo-conductor) task library, so
that triggering, retry/backoff, OS background wake, and foreground cadence are
owned by one cross-platform engine instead of hand-rolled per platform. OctoChat
keeps only the chat-domain logic (what a tick *does*); `expo-conductor` owns
*when* it runs.

## What `expo-conductor` provides (v0.1.0, `master`)

- `Conductor.schedule(definition, handler)` and `Conductor.defineTask(name, handler)`
  (register a JS handler at module scope), plus `cancelTask(id)`, `runNow(id)`,
  `getTasks()`.
- **Triggers**: `recurrence` (`interval` / `daily` / `weekly` / `cron`),
  `background` (`minimumIntervalMinutes`, native OS wake even when terminated),
  `appState` (`foreground` / `background`), `time`, `notification`, `push`, `alarm`.
- **Per-task policy**: `constraints` (execution window, charging, min battery,
  network requirement, idle, `expiresAt`), `retry` (`maxAttempts`, `backoffMs`,
  `maxBackoffMs`), `maxConcurrent`.
- `priority` (`Priority` enum), resource `weight` (`light`/`moderate`/`heavy`).
- Handler context `{ taskId, triggerType, data, firedAt, attempt }` → returns
  `TaskResult` (`success` / `failed` / `newData` / `noData`).
- Events: `onTaskExecute`, `onTaskComplete`, `onTaskSkipped`, `onTaskError`.
- Native engine (Kotlin/Swift) for terminated-app execution; a **Web engine**
  (`WebSchedulerEngine`) that schedules via chained `setTimeout`.

## OctoChat scheduling today → `expo-conductor`

| OctoChat piece (today) | Maps to | Disposition |
|---|---|---|
| `automations/background-task.native.ts` — global `TaskManager` task `octochat.automations.tick` via `expo-background-task`, 15-min OS wake, loops public spaces/rooms | `background` + `recurrence` trigger on the native engine, with built-in `retry` | **Replace** — one Conductor task per automated room; handler calls SDK `runAutomationTick` |
| `automations/background-task.ts` — web/default no-op | Conductor **Web engine** (unifies web + native) | **Delete** |
| `automations/use-automation-driver.ts` — foreground tick of the open room on focus / `AppState` active / on-leader / every 60 s; `onOpen` automations | `appState:'foreground'` + `recurrence` (interval) triggers | **Shrink** to a thin `onTaskComplete` listener that applies the optimistic `lastRunAt` cache patch |
| `isDueForScheduledTick(...)` interval math (SDK) | per-task `recurrence.everyMs` | **Offload** cadence to Conductor; handler returns `noData` when not due. Keep `enabled` + `runOnDeviceId` gating |
| `automations/use-automation-commands.ts` — `/command` watcher on the conversation store | — (chat-domain, not scheduling) | **Stays** in app; re-point only its leader gate |
| `automations/leader.ts` — per-room Web Lock; anti-double-post across tabs / Electron sharing one account `edPub` | ❌ **not provided by `expo-conductor`** | **Feature gap** — see below |
| SDK `automations/{runner-core,orchestrator,hash,secrets,providers,append,registry-write,types}` | — (domain logic the handler invokes) | **Unchanged** |

## Feature delta required in `expo-conductor`

`WebSchedulerEngine` has **no cross-tab coordination** (verified: no
`navigator.locks`, no multi-tab dedup — it is single-tab focused). OctoChat
depends on exactly this so that two web tabs, or a tab plus an Electron shell
sharing one account `edPub`, never both post. Add to `expo-conductor`:

1. **Cross-instance single-flight / leader election** *(required)* — a task
   option (e.g. `policy.singleFlight: true` or `leaderKey: string`). On web the
   engine acquires `navigator.locks.request(key, …)` and only the holder fires;
   non-holders defer (emit `onTaskSkipped` with a `DEFERRED_BY_LEADER`-style
   reason). On native (single instance) it's a no-op / always-holder. This is
   generic and useful to any multi-tab web scheduler, so it belongs in
   `expo-conductor`, not OctoChat — and it lets OctoChat delete `leader.ts`.
2. **`appState:'foreground'` on web** *(verify, possibly add)* — confirm the web
   engine wires `visibilitychange`/`focus` to fire foreground tasks. OctoChat's
   "tick on open/focus" depends on it; add it if missing.

Explicitly **not** an `expo-conductor` concern (stays OctoChat domain logic):
content-hash dedup (`automations/hash.ts`) and sealed credentials
(`automations/secrets.ts`). The handler hashes fetched content and returns
`TaskResult.noData` when unchanged — no library change needed.

## OctoChat code changes

- `apps/mobile/package.json` — add `expo-conductor` dependency (published or
  git-subpath; see Blockers).
- `apps/mobile/app.json` — add the `expo-conductor` config plugin; remove the
  `expo-background-task` plugin entry it replaces.
- **New** `apps/mobile/src/lib/automations/conductor-init.ts`:
  - `Conductor.defineTask('octochat.automation.tick', handler)` at module scope.
    The handler reads `ctx.data.roomId` / `ctx.data.spaceId`, resolves the
    session + room, enforces `enabled` + `runOnDeviceId === edPub`, calls SDK
    `runAutomationTick`, and returns `noData` when the content hash is unchanged.
  - `syncAutomationTasks(session)` — reconciles Conductor tasks against the
    synced automated-room registry: `schedule` per automated room (trigger set =
    `background` + `recurrence(intervalMin)` + `appState:'foreground'` for
    `onOpen`, with `policy.singleFlight`/`leaderKey = roomId`), `cancelTask` for
    rooms whose automation was removed/disabled.
- **Delete** `apps/mobile/src/lib/automations/background-task.ts` and
  `background-task.native.ts` (replaced by `conductor-init.ts`).
- **Delete** `apps/mobile/src/lib/automations/leader.ts` (replaced by
  `expo-conductor` single-flight) — *or* keep it scoped to the command watcher
  if we defer feature #1.
- `apps/mobile/src/lib/automations/use-automation-background.ts` — call
  `syncAutomationTasks` on session-ready and on registry change instead of
  `registerAutomationTask` / `unregisterAutomationTask`.
- `apps/mobile/src/lib/automations/use-automation-driver.ts` — drop the manual
  focus/AppState/60 s firing; keep only an `onTaskComplete` subscription that
  applies the optimistic `lastRunAt` cache patch for the open room.
- `apps/mobile/src/lib/automations/use-automation-commands.ts` — unchanged logic;
  re-point its `active` (leader) gate to `expo-conductor` leadership.
- SDK (`packages/sdk/src/automations/*`) — **no changes**; it remains the
  headless core the handler calls.

## Blockers

1. **Repo access** — `Herklos/expo-conductor` is outside this session's MCP
   scope and not cloned. To implement feature #1 + open a PR, add it to the
   environment's repository scope and authorize the Claude GitHub app on
   `Herklos` (or fork/move under `drakkar-software`).
2. **Not on npm** — `expo-conductor@0.1.0` is unpublished. OctoChat needs it
   either published or consumed as a git-subpath dependency
   (`packages/expo-conductor` lives in a monorepo).
3. **Native code** — `expo-conductor` ships a config plugin + Kotlin/Swift, so
   OctoChat must use a dev-client / prebuild; it will not run in Expo Go.
   Confirm this is acceptable for the build pipeline.

## Execution order (once unblocked)

1. Add cross-tab single-flight (+ verify web `appState`) to `expo-conductor`;
   PR + publish.
2. Add the dependency + config plugin to OctoChat.
3. Add `conductor-init.ts`; delete `background-task*.ts` and `leader.ts`.
4. Slim `use-automation-driver.ts`; re-point `use-automation-commands.ts`;
   rewire `use-automation-background.ts`.
5. `pnpm typecheck` + run automations end-to-end on web, iOS, Android.

## Outcome

Implemented. What landed, and the deltas from the plan above:

- **`expo-conductor` (lib).** Added `policy.singleFlight` (cross-instance leader
  election over `navigator.locks`; native = always-leader no-op) and real web
  `appState` trigger firing (`visibilitychange` + focus/blur, injectable +
  Node/SSR-safe). Web-only orchestration — no Kotlin/Swift/fixtures change.
  Adversarially reviewed; fixed 4 handoff edge cases (manual-run replay, one-shot
  not replayed on handoff, pause clears deferred markers, documented appState+timer
  non-atomicity). 116 tests. Published `@drakkar.software/expo-conductor`; `0.1.1`
  has the fixes.
- **App.** `conductor-init.ts` (module-scope handler + `syncAutomationTasks`
  reconcile, serialized to survive session switches), `conductor-background.{native,}.ts`
  (the `expo-conductor/task-manager` OS-wake bridge; web no-op), rewired
  `use-automation-background` (sync on session-ready) and re-sync at the
  create/edit/delete call sites, slimmed `use-automation-driver` to tick-completion
  listeners + a focus `runNow`. Deleted `background-task{,.native}.ts`. Added the
  dependency + config plugin (kept `expo-background-task`, which the bridge needs).
- **Kept `leader.ts`** scoped to the command watcher (the plan's allowed fallback):
  Conductor doesn't surface leadership to React, so the foreground command gate
  still uses the Web Lock. Scheduled ticks use `policy.singleFlight`.
- **`onOpen` semantics shift to flag.** `onOpen` now maps to `appState:'foreground'`
  (app-foreground) plus a focus `runNow` on the open room screen, rather than purely
  "this room's screen opened". Content-hash dedup bounds the cost to extra polls (no
  duplicate posts), but a content change can now surface on app-foreground for any
  onOpen room, not only on visiting it. Revisit if undesired.
- **Not verifiable here:** native JS-handler headless execution via the bridge,
  native `appState` firing, and the prebuild/dev-client (won't run in Expo Go).
