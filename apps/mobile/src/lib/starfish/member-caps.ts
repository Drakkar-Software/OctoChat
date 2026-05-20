/**
 * Member caps for rooms this identity has JOINED (vs. owns). Maps roomId →
 * member cap-cert JSON so `useRoom` can open someone else's room as a recipient.
 * Web: localStorage. (Native uses the same web shim until storage.native lands.)
 */
type CapMap = Record<string, string>;

const KEY = 'octochat.membercaps.v1';

function ls(): Storage | undefined {
  return (globalThis as { localStorage?: Storage }).localStorage;
}

function read(): CapMap {
  try {
    return JSON.parse(ls()?.getItem(KEY) ?? '{}') as CapMap;
  } catch {
    return {};
  }
}

export function getMemberCap(roomId: string): string | null {
  return read()[roomId] ?? null;
}

export function saveMemberCap(roomId: string, capJson: string): void {
  const m = read();
  m[roomId] = capJson;
  try {
    ls()?.setItem(KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}
