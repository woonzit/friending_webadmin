"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminCall } from "@/lib/adminClient";
import { retainResearchCommandNavigation } from "@/lib/datesResearchNavigation";
import { friendingGoPreorders, type FriendingGoListFilters, type FriendingGoSendBody } from "@/lib/friendinggo";
import {
  FRIENDINGGO_STORAGE_KEYS,
  friendingGoPendingEmail,
  friendingGoStore,
  friendingGoStored,
  runFriendingGoEmailCommand,
  type FriendingGoPendingEmail,
  type FriendingGoRunOutcome,
  type FriendingGoRunProgress,
  type FriendingGoStorage,
} from "@/lib/friendinggoConsole";

export function friendingGoBrowserStorage(): FriendingGoStorage | null {
  try { return window.sessionStorage; } catch { return null; }
}

const sleep = (milliseconds: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, milliseconds); });

export type FriendingGoNavigationCopy = { confirm: string; history: string; title: string; leave: string };

/**
 * One email command (test, draft, send or resume) per browser tab, shared by the Email and Sent tabs:
 * stored before it leaves, carried on through Core's slices with the same request id, kept while its
 * outcome is unknown, and continued by whichever of the two tabs mounts next when the page went away
 * in the middle of a send (review P2-1). While a send or resume is being carried on, leaving the page asks
 * first (the console's shared navigation guard and the browser's unload prompt).
 */
export function useFriendingGoEmailCommand(
  onOutcome: (outcome: Exclude<FriendingGoRunOutcome, { kind: "left" }>, stored: FriendingGoPendingEmail) => void,
  navigation: FriendingGoNavigationCopy,
) {
  const [pending, setPending] = useState<FriendingGoPendingEmail | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<FriendingGoRunProgress | null>(null);
  /** The stored command found on mount: `undefined` until read, `null` when there was none. */
  const [restored, setRestored] = useState<FriendingGoPendingEmail | null | undefined>(undefined);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const outcomeRef = useRef(onOutcome);
  outcomeRef.current = onOutcome;

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const carried = busy && pending !== null && (pending.command.mode === "send" || pending.command.mode === "resume");
  const { confirm, history, title, leave } = navigation;
  useEffect(() => (carried ? retainResearchCommandNavigation(confirm, history, { title, leave }) : undefined), [carried, confirm, history, title, leave]);

  const execute = useCallback(async (stored: FriendingGoPendingEmail) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setPending(stored);
    setProgress(null);
    const outcome = await runFriendingGoEmailCommand(stored, {
      call: (command) => adminCall("go_email_send", { ...command }),
      sleep,
      alive: () => aliveRef.current,
      store: (value) => friendingGoStore(friendingGoBrowserStorage(), FRIENDINGGO_STORAGE_KEYS.pendingEmail, value),
      onProgress: setProgress,
    });
    // The page went away: the command stays stored as running, and the next Email or Sent tab continues it.
    if (outcome.kind === "left") return;
    busyRef.current = false;
    setBusy(false);
    setProgress(null);
    setPending(outcome.kind === "paused" || outcome.kind === "unknown" ? { ...stored, running: false } : null);
    outcomeRef.current(outcome, stored);
  }, []);

  useEffect(() => {
    const storage = friendingGoBrowserStorage();
    const stored = friendingGoStored(storage, FRIENDINGGO_STORAGE_KEYS.pendingEmail, friendingGoPendingEmail);
    setStorageAvailable(storage !== null && stored !== undefined);
    setRestored(stored ?? null);
    if (stored?.running) void execute(stored);
    else if (stored) setPending(stored);
  }, [execute]);

  /** Store the command before it leaves, then carry it to an outcome; `false` when the browser refused to store it. */
  const start = useCallback((command: FriendingGoSendBody): boolean => {
    if (busyRef.current) return false;
    const stored: FriendingGoPendingEmail = { version: 1, command, running: false };
    if (!friendingGoStore(friendingGoBrowserStorage(), FRIENDINGGO_STORAGE_KEYS.pendingEmail, stored)) {
      setStorageAvailable(false);
      return false;
    }
    void execute(stored);
    return true;
  }, [execute]);

  const retry = useCallback(() => { if (pending && !busyRef.current) void execute(pending); }, [execute, pending]);

  const discard = useCallback(() => {
    friendingGoStore(friendingGoBrowserStorage(), FRIENDINGGO_STORAGE_KEYS.pendingEmail, null);
    setPending(null);
  }, []);

  return { pending, busy, progress, restored, storageAvailable, start, retry, discard };
}

export type FriendingGoAccess = { load: "loading" | "ready" | "error"; canWrite: boolean; active: number | null };

/**
 * Whether this operator may write, from Core's own answer (`go_preorders.can_write`), never from the role
 * alone (Core treats an unrecognised stored role as read-only although `admin_me` shows `admin`). The
 * smallest page carries the same flags: `complained` rows only (the totals are the whole registry's).
 */
export const FRIENDINGGO_ACCESS_FILTERS: FriendingGoListFilters = { q: "", status: "complained", page: 1 };

export function useFriendingGoAccess(): FriendingGoAccess {
  const [access, setAccess] = useState<FriendingGoAccess>({ load: "loading", canWrite: false, active: null });
  useEffect(() => {
    const controller = new AbortController();
    void adminCall("go_preorders", { ...FRIENDINGGO_ACCESS_FILTERS }, controller.signal).then((response) => {
      if (controller.signal.aborted) return;
      const list = friendingGoPreorders(response, FRIENDINGGO_ACCESS_FILTERS);
      setAccess(list ? { load: "ready", canWrite: list.can_write, active: list.totals.active } : { load: "error", canWrite: false, active: null });
    });
    return () => controller.abort();
  }, []);
  return access;
}
