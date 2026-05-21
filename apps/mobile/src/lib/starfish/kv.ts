/**
 * Async key/value persistence — web (localStorage). Native uses `kv.native.ts`
 * (AsyncStorage). Used for non-secret state (joined-room member caps, the
 * revocation ledger); the recovery seed lives in `storage*.ts` instead.
 */
function ls(): Storage | undefined {
  return (globalThis as { localStorage?: Storage }).localStorage;
}

export async function kvGet(key: string): Promise<string | null> {
  try {
    return ls()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: string): Promise<void> {
  try {
    ls()?.setItem(key, value);
  } catch {
    /* ignore */
  }
}
