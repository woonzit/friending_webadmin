import { createAdminIdempotencyKey, datesAdminPrincipal, hasDatesCapability } from "@/lib/datesAdmin";
import {
  datesExternalBaseline, datesExternalRefusal, decodeDatesExternalReceipt, normalizeDatesExternalPendingBody,
  decodeDatesExternalList,
  type DatesExternalMutationAction, type DatesExternalMutationBaseline, type DatesExternalReceipt,
} from "@/lib/datesExternalAdmin";

/** One outstanding external-event command per operator/browser tab. */
export type DatesExternalPending = {
  version: 1;
  actor: string;
  issued_at: number;
  action: DatesExternalMutationAction;
  body: Record<string, unknown>;
  baseline: DatesExternalMutationBaseline | null;
};
export type DatesExternalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type DatesExternalPendingRead = { kind: "empty" } | { kind: "pending"; pending: DatesExternalPending } | { kind: "blocked" };
// Core command receipts expire after seven days. Stop one day earlier; never
// silently replay a create after its server receipt may have been collected.
export const DATES_EXTERNAL_RETRY_SECONDS = 6 * 86400;

const storageKey = (actor: string) => `friending:dates-external:pending:v1:${encodeURIComponent(actor)}`;
const actorValid = (actor: unknown): actor is string => typeof actor === "string" && actor === actor.trim().toLowerCase()
  && actor.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(actor);

/** Fresh operator identity and Core time, independent of a now-terminal target. */
export async function readDatesExternalMutationAccess(send: (action: string, body: Record<string, unknown>) => Promise<unknown>,
  command?: { action: DatesExternalMutationAction; body: Record<string, unknown> }) {
  try {
    const [identity, response] = await Promise.all([send("admin_me", {}), send("dates_external_event_list", { page: 1, limit: 1 })]);
    const principal = datesAdminPrincipal(identity), list = decodeDatesExternalList(response, { page: 1, limit: 1 });
    if (!principal || !actorValid(principal.email) || !hasDatesCapability(principal, "dates_external_event_manage")
      || !list?.capabilities.includes("dates_external_event_manage")) return null;
    if (command?.action === "dates_activity_command" && (!hasDatesCapability(principal, "dates_activity_command")
      || (command.body.action === "purge" && !hasDatesCapability(principal, "dates_activity_purge")))) return null;
    return { actor: principal.email, serverNow: list.server_now };
  } catch { return null; }
}

export function datesExternalBrowserStorage(): DatesExternalStorage | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
}

export function decodeDatesExternalPending(value: unknown, actor: string): DatesExternalPending | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !actorValid(actor)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join() !== ["version", "actor", "issued_at", "action", "body", "baseline"].sort().join()
    || row.version !== 1 || row.actor !== actor || !Number.isSafeInteger(row.issued_at) || Number(row.issued_at) <= 0
    || !["dates_external_event_publish", "dates_external_event_update", "dates_external_event_command", "dates_activity_command"].includes(String(row.action))
    || !row.body || typeof row.body !== "object" || Array.isArray(row.body)) return null;
  const body = row.body as Record<string, unknown>;
  if (!normalizeDatesExternalPendingBody(String(row.action), body)) return null;
  if (row.action === "dates_external_event_publish") {
    if (row.baseline !== null) return null;
  } else if (row.action === "dates_activity_command") {
    if (!datesExternalBaseline(row.baseline) || body.activity_id !== row.baseline.activity_id || body.expected_revision !== row.baseline.activity_revision) return null;
  } else if (!datesExternalBaseline(row.baseline) || body.external_event_id !== row.baseline.external_event_id
    || body.expected_revision !== row.baseline.revision || row.baseline.soft_deleted || row.baseline.lifecycle !== "active"
    || !["published", "rechecking", "in_review"].includes(row.baseline.status)
    || (row.baseline.status === "in_review" && row.action === "dates_external_event_command" && body.action === "official_update")) return null;
  return row as DatesExternalPending;
}

export function readDatesExternalPending(storage: DatesExternalStorage | null, actor: string): DatesExternalPendingRead {
  if (!storage || !actorValid(actor)) return { kind: "blocked" };
  try {
    const raw = storage.getItem(storageKey(actor));
    if (raw === null) return { kind: "empty" };
    if (raw.length > 100000) return { kind: "blocked" };
    const pending = decodeDatesExternalPending(JSON.parse(raw), actor);
    return pending ? { kind: "pending", pending } : { kind: "blocked" };
  } catch { return { kind: "blocked" }; }
}

export function prepareDatesExternalPending(actor: string, action: DatesExternalMutationAction,
  body: Record<string, unknown>, baseline: DatesExternalMutationBaseline | null, serverNow: number): DatesExternalPending | null {
  // Caller-supplied identity is never adopted. The complete normalized command
  // is snapshotted before persistence so later form edits cannot change a retry.
  if (Object.hasOwn(body, "idempotency_key")) return null;
  const candidate = { version: 1, actor, issued_at: serverNow, action,
    body: { ...body, idempotency_key: createAdminIdempotencyKey("dates-external") }, baseline };
  try { return decodeDatesExternalPending(JSON.parse(JSON.stringify(candidate)), actor); } catch { return null; }
}

export type DatesExternalMutationOutcome =
  | { kind: "success"; receipt: DatesExternalReceipt; retained: boolean }
  | { kind: "refused"; error: string; retained: boolean }
  | { kind: "uncertain"; error: string }
  | { kind: "blocked" | "expired" };

function same(left: DatesExternalPending, right: DatesExternalPending): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Remove only this exact identity; never erase a replacement or unreadable evidence. */
function clear(storage: DatesExternalStorage, pending: DatesExternalPending): boolean {
  const current = readDatesExternalPending(storage, pending.actor);
  if (current.kind !== "pending" || !same(current.pending, pending)) return false;
  try {
    storage.removeItem(storageKey(pending.actor));
    return storage.getItem(storageKey(pending.actor)) === null;
  } catch { return false; }
}

export async function runDatesExternalMutation(pending: DatesExternalPending, storage: DatesExternalStorage | null,
  serverNow: number, send: (action: string, body: Record<string, unknown>) => Promise<unknown>): Promise<DatesExternalMutationOutcome> {
  if (!storage || !decodeDatesExternalPending(pending, pending.actor) || !Number.isSafeInteger(serverNow)
    || serverNow <= 0 || pending.issued_at > serverNow + 300) return { kind: "blocked" };
  if (serverNow - pending.issued_at >= DATES_EXTERNAL_RETRY_SECONDS) return { kind: "expired" };
  const previous = readDatesExternalPending(storage, pending.actor);
  if (previous.kind === "blocked" || (previous.kind === "pending" && !same(previous.pending, pending))) return { kind: "blocked" };
  try {
    if (previous.kind === "empty") storage.setItem(storageKey(pending.actor), JSON.stringify(pending));
    const saved = readDatesExternalPending(storage, pending.actor);
    if (saved.kind !== "pending" || !same(saved.pending, pending)) return { kind: "blocked" };
  } catch { return { kind: "blocked" }; }
  let response: unknown;
  try { response = await send(pending.action, pending.body); } catch { return { kind: "uncertain", error: "unconfirmed" }; }
  const receipt = decodeDatesExternalReceipt(response, pending.action, pending.body, pending.baseline);
  if (receipt) return { kind: "success", receipt, retained: !clear(storage, pending) };
  const refusal = datesExternalRefusal(response);
  if (refusal.kind === "refused") return { kind: "refused", error: refusal.error, retained: !clear(storage, pending) };
  return { kind: "uncertain", error: refusal.error };
}
