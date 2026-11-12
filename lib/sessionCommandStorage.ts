/**
 * The tab-scoped store of a receipt-backed write whose outcome is not known yet: the caller-minted
 * request id and what it was minted for live in `sessionStorage` (this browser tab only) from before
 * the request leaves until an outcome is observed. A stored value is decoded exactly on the way back,
 * so it can never acquire new meaning; one that does not decode is removed. Pure: callers pass the
 * storage in. FriendingGO (`lib/friendinggoConsole.ts`) and the member page's outbound message panel
 * (`lib/outboundMessagingPanel.ts`) share these three functions.
 */

export type SessionCommandStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** This browser tab's session storage, or null where it cannot be used. */
export function sessionCommandStorage(): SessionCommandStorage | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
}

/** A stored value, decoded; `null` when absent or unreadable (and then removed); `undefined` when storage is unavailable. */
export function storedSessionCommand<T>(storage: SessionCommandStorage | null, key: string, decode: (value: unknown) => T | null): T | null | undefined {
  if (!storage) return undefined;
  let raw: string | null;
  try { raw = storage.getItem(key); } catch { return undefined; }
  if (raw === null) return null;
  let decoded: T | null = null;
  try { decoded = decode(JSON.parse(raw)); } catch { decoded = null; }
  if (decoded === null) storeSessionCommand(storage, key, null);
  return decoded;
}

/** Store (or, with `null`, remove) a value; `false` when the browser refused. */
export function storeSessionCommand(storage: SessionCommandStorage | null, key: string, value: unknown): boolean {
  if (!storage) return false;
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
