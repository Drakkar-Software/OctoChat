/**
 * Per-room secret-param storage. The synced `_rooms` registry doc carries the
 * non-secret half of an automation's `params`; high-value strings (API keys,
 * webhook tokens) stay in device-local kv keyed by `userId + roomId`. The
 * `ParamField.secret` flag in a provider's `paramFields` is what routes a field
 * here at create time.
 */
import { kvGet, kvRemove, kvSet } from '../starfish/kv';

const key = (userId: string, roomId: string) => `octochat.automated.secrets.v1.${userId}.${roomId}`;

export async function loadAutomationSecrets(
  userId: string,
  roomId: string,
): Promise<Record<string, unknown>> {
  const raw = await kvGet(key(userId, roomId));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function saveAutomationSecrets(
  userId: string,
  roomId: string,
  secrets: Record<string, unknown>,
): Promise<void> {
  if (!Object.keys(secrets).length) {
    await kvRemove(key(userId, roomId));
    return;
  }
  await kvSet(key(userId, roomId), JSON.stringify(secrets));
}

export async function clearAutomationSecrets(userId: string, roomId: string): Promise<void> {
  await kvRemove(key(userId, roomId));
}
