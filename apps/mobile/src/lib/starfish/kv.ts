/**
 * Async key/value persistence — web (localStorage). Native uses `kv.native.ts`
 * (AsyncStorage). Holds account-scoped state: joined-space member caps and the
 * pubspace access map. NOTE: the pubspace map includes a throwaway ephemeral
 * Ed25519 PRIVATE key (the public-link bearer secret, also shipped in the invite
 * link), so this store is NOT strictly secret-free. The recovery seed — the only
 * high-value secret — lives in `storage*.ts` (Keychain/secure-store), never here.
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

export async function kvRemove(key: string): Promise<void> {
  try {
    ls()?.removeItem(key);
  } catch {
    /* ignore */
  }
}
