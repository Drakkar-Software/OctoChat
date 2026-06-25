/**
 * Automation scheduling, owned by `expo-conductor`.
 *
 * Replaces the bespoke `background-task*.ts`: one Conductor task per automated room this
 * device runs, with the engine owning *when* a tick fires (interval cadence, OS background
 * wake, foreground app-state, cross-instance single-flight) and this module owning only
 * *what* a tick does — the chat-domain `runAutomationTick` in the SDK.
 *
 * `Conductor.defineTask` runs at MODULE scope (via the bare side-effect import in
 * `_layout.tsx`) so the handler is registered on EVERY launch, including a cold headless
 * background wake where React never mounts — same rule the old `TaskManager.defineTask`
 * followed. The whole tick chain is headless-safe (plain async, no hooks/context): it
 * rehydrates the SDK platform + session from the persisted vault exactly as the FCM
 * background handler does, since no provider tree ran in a cold task.
 *
 * The OS-wake bridge that drives `runDueTasks()` headlessly on native lives in the
 * platform-branched `conductor-background.native.ts` (no-op on web).
 */
import Conductor, { TaskResult } from '@drakkar.software/expo-conductor';
import type { Recurrence, TaskDefinition, TaskExecutionContext, Trigger } from '@drakkar.software/expo-conductor';

import {
  activeAccountOf,
  batchPullManySpaceData,
  effectiveSchedule,
  getSpaceClient,
  hydrateSpaceAccessStore,
  isDmSpaceId,
  isDueForScheduledTick,
  objIndexPull,
  readIndexRooms,
  readSpaces,
  runAutomationTick,
  sessionFromPersisted,
} from '@drakkar.software/octochat-sdk';
import type { AutomationMeta, AutomationSchedule, Room, Session } from '@drakkar.software/octochat-sdk';

import { initOctoChat } from '../octochat-init';
import { configureStarfishPlatform, loadVault } from '@drakkar.software/octochat-sdk/platform';

/** The single JS handler name every per-room automation task dispatches to. Tasks carry a
 *  dynamic id (per room); Conductor maps each id → this handler name. */
const HANDLER = 'octochat.automation.tick';

/** Stable Conductor task id for a room's automation. The space + room ids are encoded into
 *  the id so the headless handler can resolve them with no per-fire data payload (recurrence
 *  / background / appState fires carry none). */
export function automationTaskId(spaceId: string, roomId: string): string {
  return `${HANDLER}/${encodeURIComponent(spaceId)}/${encodeURIComponent(roomId)}`;
}

function parseTaskId(id: string): { spaceId: string; roomId: string } | null {
  const prefix = `${HANDLER}/`;
  if (!id.startsWith(prefix)) return null;
  const parts = id.slice(prefix.length).split('/');
  if (parts.length !== 2) return null;
  return { spaceId: decodeURIComponent(parts[0]!), roomId: decodeURIComponent(parts[1]!) };
}

/** Read a space's automated rooms from its plaintext object index, headless-safe.
 *  The objindex is always plaintext in the per-node model, so no keyring is needed
 *  to enumerate rooms. Returns [] when the space is unreachable. */
async function readSpaceRooms(session: Session, spaceId: string): Promise<Room[]> {
  const client = getSpaceClient(spaceId, session);
  const idx = await readIndexRooms(client, null, objIndexPull(spaceId), spaceId).catch(() => null);
  return idx?.rooms ?? [];
}

/** Resolve one automated room from the synced object index (headless-safe). */
async function resolveAutomatedRoom(
  session: Session,
  spaceId: string,
  roomId: string,
): Promise<Room | null> {
  const rooms = await readSpaceRooms(session, spaceId);
  return rooms.find((r) => r.id === roomId) ?? null;
}

/**
 * Rehydrate the session from the persisted vault, headless-safe. Returns null when signed
 * out / locked (the seed vault is `WHEN_UNLOCKED`, so a locked device can't tick). Mirrors
 * the FCM background handler's boot — both run where no provider tree mounted.
 */
async function headlessSession(): Promise<Session | null> {
  configureStarfishPlatform();
  initOctoChat();
  const load = await loadVault();
  if (load.kind !== 'ready') return null;
  const account = activeAccountOf(load.vault);
  if (!account?.derived?.userId) return null;
  const session = await sessionFromPersisted(account);
  // Rehydrate space-access entries from kv so joined spaces are accessible headlessly.
  await hydrateSpaceAccessStore(session.userId, {}, {});
  return session;
}

/** The automation tick handler. Resolves the room named by the task id, enforces the
 *  enabled + elected-runner + due gate, runs one tick, and reports a normalized result so
 *  Conductor's retry/backoff applies. Content-hash dedup inside `runAutomationTick` turns an
 *  unchanged feed into `NO_DATA` (no repost). */
async function handleTick(ctx: TaskExecutionContext): Promise<TaskResult> {
  const parsed = parseTaskId(ctx.taskId);
  if (!parsed) return TaskResult.NO_DATA;
  const session = await headlessSession();
  if (!session) return TaskResult.NO_DATA;
  const room = await resolveAutomatedRoom(session, parsed.spaceId, parsed.roomId);
  if (!room?.automation) return TaskResult.NO_DATA;
  const now = Date.now();
  // Gate enforces enabled + this device is the elected runner + the cadence timing
  // (interval / daily / weekly / cron / onOpen), reconciled against the SYNCED lastRunAt.
  // 0.2.0's engine already dispatch-gates the OS wake on its own nextRunAt; this gate
  // backstops that and is the only thing that knows if ANOTHER device already ran.
  if (!isDueForScheduledTick(room, session.keys.edPub, now)) return TaskResult.NO_DATA;
  const outcome = await runAutomationTick({ session, room, trigger: 'scheduled', now });
  if (outcome.kind === 'failed') throw new Error(outcome.error); // → onTaskError + retry
  // posted → NEW_DATA; skipped (polled, content unchanged) → SUCCESS. Both advance lastRunAt
  // on the server, so the driver may patch the cache. The early not-due returns above stay
  // NO_DATA — nothing ran, so lastRunAt must NOT advance.
  return outcome.kind === 'posted' ? TaskResult.NEW_DATA : TaskResult.SUCCESS;
}

// Module scope: registered on every launch, including a cold headless wake.
Conductor.defineTask(HANDLER, handleTick);

/** Map an automation's effective cadence to a Conductor recurrence. The engine owns
 *  the OS-wake timing; the SDK's `isDueForScheduledTick` (same UTC math) is the final
 *  due-gate, so the two agree on when daily/weekly/cron fire. */
function recurrenceFor(s: AutomationSchedule): Recurrence {
  switch (s.kind) {
    case 'interval':
      return { kind: 'interval', everyMs: s.everyMin * 60_000 };
    case 'daily':
      return { kind: 'daily', hour: s.hour, minute: s.minute };
    case 'weekly':
      return { kind: 'weekly', weekday: s.weekday, hour: s.hour, minute: s.minute };
    case 'cron':
      return { kind: 'cron', expression: s.expression };
  }
}

/** The trigger set for a room's automation, or null when there's nothing to schedule
 *  (no cadence and not an on-open automation). */
function triggersFor(a: AutomationMeta): Trigger[] | null {
  const triggers: Trigger[] = [];
  const schedule = effectiveSchedule(a);
  if (schedule) triggers.push({ type: 'recurrence', recurrence: recurrenceFor(schedule) });
  // `onOpen` ticks when the app returns to the foreground. On web this fires per tab via
  // visibilitychange; the room screen also forces an immediate tick on focus (see the driver).
  if (a.onOpen) triggers.push({ type: 'appState', on: 'foreground' });
  return triggers.length > 0 ? triggers : null;
}

function taskDefFor(spaceId: string, roomId: string, a: AutomationMeta): TaskDefinition | null {
  const triggers = triggersFor(a);
  if (!triggers) return null;
  return {
    id: automationTaskId(spaceId, roomId),
    handler: { name: HANDLER, type: 'js' },
    triggers,
    policy: {
      // One leader per room across same-account instances (two web tabs / a tab + Electron),
      // so a changed feed posts once, not once per tab. Native is a single instance (no-op).
      singleFlight: roomId,
      retry: { maxAttempts: 2, backoffMs: 30_000, maxBackoffMs: 300_000 },
      // A scheduled tick is a network poll (RSS/HTTP) — let the engine SKIP it when offline
      // instead of waking the handler to fail (which burns a scarce background slot and bumps
      // retry/backoff on a transient no-network condition). `unmetered` keeps background polls
      // off cellular data; the foreground `runNow` focus tick is user-initiated and not gated.
      constraints: { network: 'unmetered' },
    },
  };
}

/** All currently-registered automation task ids (those owned by this module). */
async function automationTaskIds(): Promise<string[]> {
  const tasks = await Conductor.getTasks();
  return tasks.flatMap((t) => t.id.startsWith(`${HANDLER}/`) ? [t.id] : []);
}

/**
 * Serialize reconcile/cancel so they never interleave. The background hook fires a cleanup
 * `cancelAll` and the next session's `sync` UNAWAITED across a session switch — without this,
 * a slow cancel could run after the new sync and drop its freshly-scheduled tasks. FIFO,
 * failure-isolated (one rejection doesn't stall the queue).
 */
let opQueue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = opQueue.then(fn, fn);
  opQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Reconcile Conductor's automation tasks against the synced registry: schedule one task per
 * enabled automated room THIS device runs, and cancel tasks for rooms whose automation was
 * removed, disabled, or handed to another runner. Idempotent — safe to call on session-ready
 * and after any automation create/edit/delete.
 */
export function syncAutomationTasks(session: Session): Promise<void> {
  return serialize(() => reconcile(session));
}

async function reconcile(session: Session): Promise<void> {
  const desired = new Map<string, TaskDefinition>();
  try {
    const { spaces } = await readSpaces(session.spacesRegistryClient, session);
    // DM spaces never host automations. For the rest, batch ALL object-index reads into ONE
    // /batch/pull (collections=spaceregistry,objindex) instead of one objindex GET per space —
    // the same plaintext member-gated objindex the rooms-registry prefetch already batches via
    // the device account cap. batchPullManySpaceData rethrows 429 (caught below → leave tasks
    // untouched) and degrades gracefully to per-space pulls on non-429 / no-batch-support servers.
    const spaceIds = spaces.filter((s) => !isDmSpaceId(s.id)).map((s) => s.id);
    const batch = await batchPullManySpaceData(session, spaceIds);
    for (const spaceId of spaceIds) {
      const rooms = (batch.get(spaceId)?.index?.rooms ?? []) as Room[];
      for (const room of rooms) {
        const a = room.automation;
        if (!a || !a.enabled) continue;
        if (a.runOnDeviceId !== session.keys.edPub) continue; // only the elected runner schedules
        const def = taskDefFor(spaceId, room.id, a);
        if (def) desired.set(def.id, def);
      }
    }
  } catch (e) {
    console.error('[automations] sync: spaces read failed', e);
    return; // can't compute the desired set — leave existing tasks untouched
  }

  for (const id of await automationTaskIds()) {
    if (!desired.has(id)) await Conductor.cancelTask(id);
  }
  for (const def of desired.values()) {
    try {
      await Conductor.schedule(def, handleTick);
    } catch (e) {
      // 0.2.0 validates a cron expression fail-fast at registration and throws. One bad
      // expression from the synced registry must not abort scheduling for sibling rooms.
      console.error('[automations] sync: schedule failed', def.id, e);
    }
  }
}

/** Cancel every automation task (on sign-out). Serialized against {@link syncAutomationTasks}
 *  so a session-switch cancel can't race the next session's reconcile. */
export function cancelAllAutomationTasks(): Promise<void> {
  return serialize(async () => {
    for (const id of await automationTaskIds()) await Conductor.cancelTask(id);
  });
}
