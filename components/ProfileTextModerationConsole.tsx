"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall, type AdminResponse } from "@/lib/adminClient";
import {
  PROFILE_TEXT_MODERATION_PENDING_STORAGE_KEY,
  profileTextModerationAdminMe,
  profileTextModerationConflict,
  profileTextModerationConflictMatchesPending,
  profileTextModerationError,
  profileTextModerationErrorKey,
  profileTextModerationListResponse,
  profileTextModerationMutationConverged,
  profileTextModerationMutationResponse,
  profileTextModerationPendingFrom,
  profileTextModerationPendingMutation,
  profileTextModerationPersistBeforeMutation,
  profileTextModerationReasonIsValid,
  profileTextModerationShouldRetainMutation,
  type ProfileTextModerationAction,
  type ProfileTextModerationConflict,
  type ProfileTextModerationDecision,
  type ProfileTextModerationErrorKey,
  type ProfileTextModerationFilterField,
  type ProfileTextModerationItem,
  type ProfileTextModerationPendingMutation,
} from "@/lib/profileTextModeration";

type Notice = { tone: "info" | "error" | "success"; text: string } | null;
type DecisionDraft = { item: ProfileTextModerationItem; decision: ProfileTextModerationDecision } | null;

function scalarLength(value: string): number {
  return [...value].length;
}

function itemKey(item: Pick<ProfileTextModerationItem, "uid" | "field">): string {
  return `${item.uid}:${item.field}`;
}

function compareItems(left: ProfileTextModerationItem, right: ProfileTextModerationItem): number {
  return left.status_updated_at - right.status_updated_at
    || left.uid - right.uid
    || (left.field === right.field ? 0 : left.field === "headline" ? -1 : 1);
}

function formatTimestamp(locale: string, seconds: number, fallback: string): string {
  const milliseconds = seconds * 1000;
  if (!Number.isFinite(milliseconds) || milliseconds > 8_640_000_000_000_000) return fallback;
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) return fallback;
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
  } catch {
    return fallback;
  }
}

export default function ProfileTextModerationConsole({
  initialField,
  initialUid,
}: {
  initialField: ProfileTextModerationFilterField;
  initialUid: number | null;
}) {
  const t = useTranslations("profileTextModeration");
  const common = useTranslations("common");
  const locale = useLocale();
  const [state, setState] = useState<"loading" | "ready" | "error" | "forbidden">("loading");
  const [loadFailure, setLoadFailure] = useState<ProfileTextModerationErrorKey | null>(null);
  const [field, setField] = useState<ProfileTextModerationFilterField>(initialField);
  const [appliedField, setAppliedField] = useState<ProfileTextModerationFilterField>(initialField);
  const [uidText, setUidText] = useState(initialUid === null ? "" : String(initialUid));
  const [appliedUid, setAppliedUid] = useState<number | null>(initialUid);
  const [items, setItems] = useState<ProfileTextModerationItem[]>([]);
  const itemsRef = useRef<ProfileTextModerationItem[]>([]);
  const [actions, setActions] = useState<ProfileTextModerationAction[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [decision, setDecision] = useState<DecisionDraft>(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<ProfileTextModerationPendingMutation | null>(null);
  const pendingRef = useRef<ProfileTextModerationPendingMutation | null>(null);
  const [conflict, setConflict] = useState<ProfileTextModerationConflict | null>(null);
  const [busy, setBusy] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const loadSequenceRef = useRef(0);

  const canDecide = actions.includes("moderation_profile_text_action");
  const validReason = useMemo(() => profileTextModerationReasonIsValid(reason), [reason]);
  const uidInputValid = uidText === "" || (/^[1-9][0-9]{0,9}$/u.test(uidText)
    && Number(uidText) <= 2_147_483_647);

  const load = useCallback(async (
    requestedField: ProfileTextModerationFilterField,
    requestedUid: number | null,
    cursor: string | null = null,
    append = false,
  ) => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    setQueueBusy(true);
    setLoadFailure(null);
    if (!append) setState((current) => current === "ready" ? current : "loading");
    const body: Record<string, unknown> = {
      contract_version: 1,
      field: requestedField,
      page_size: 50,
      ...(requestedUid === null ? {} : { uid: requestedUid }),
      ...(cursor ? { cursor } : {}),
    };
    const [meResponse, listResponse] = await Promise.all([
      adminCall("admin_me", {}),
      adminCall("moderation_profile_text_list", body),
    ]);
    if (sequence !== loadSequenceRef.current) return;
    const adminMe = profileTextModerationAdminMe(meResponse?.profile_text_moderation);
    if (!adminMe?.contract_ready || !adminMe.actions.includes("moderation_profile_text_list")) {
      setActions(adminMe?.actions ?? []);
      setState(adminMe ? "forbidden" : "error");
      setQueueBusy(false);
      return;
    }
    const parsed = await profileTextModerationListResponse(listResponse, {
      field: requestedField,
      uid: requestedUid,
      page_size: 50,
    });
    if (sequence !== loadSequenceRef.current) return;
    if (!parsed) {
      const error = profileTextModerationError(listResponse);
      setLoadFailure(error ? profileTextModerationErrorKey(error) : null);
      setState("error");
      setQueueBusy(false);
      return;
    }
    const combined = append ? [...itemsRef.current, ...parsed.items] : parsed.items;
    if (new Set(combined.map(itemKey)).size !== combined.length
      || combined.some((item, index) => index > 0 && compareItems(combined[index - 1], item) >= 0)
      || parsed.total < combined.length) {
      setLoadFailure(null);
      setState("error");
      setQueueBusy(false);
      return;
    }
    setActions(parsed.actions);
    itemsRef.current = combined;
    setItems(combined);
    setTotal(parsed.total);
    setNextCursor(parsed.next_cursor);
    setState("ready");
    setQueueBusy(false);
  }, []);

  useEffect(() => {
    try {
      const serialized = window.sessionStorage.getItem(PROFILE_TEXT_MODERATION_PENDING_STORAGE_KEY);
      if (serialized) {
        const restored = profileTextModerationPendingFrom(JSON.parse(serialized));
        if (restored) {
          pendingRef.current = restored;
          setPending(restored);
        } else {
          window.sessionStorage.removeItem(PROFILE_TEXT_MODERATION_PENDING_STORAGE_KEY);
        }
      }
    } catch {
      setNotice({ tone: "error", text: t("live.persistenceUnavailable") });
    }
    void load(initialField, initialUid);
  }, [initialField, initialUid, load, t]);

  function clearPending(): boolean {
    try {
      window.sessionStorage.removeItem(PROFILE_TEXT_MODERATION_PENDING_STORAGE_KEY);
    } catch {
      return false;
    }
    pendingRef.current = null;
    setPending(null);
    return true;
  }

  async function refreshCurrent() {
    await load(appliedField, appliedUid);
  }

  async function executeMutation(next: ProfileTextModerationPendingMutation) {
    if (busy || queueBusy) return;
    setBusy(true);
    setNotice(null);
    setConflict(null);
    const existing = pendingRef.current;
    let response: AdminResponse | null;
    if (existing) {
      response = await adminCall(existing.action, existing.payload);
    } else {
      const persisted = await profileTextModerationPersistBeforeMutation(
        window.sessionStorage,
        next,
        () => adminCall(next.action, next.payload),
      );
      if (!persisted.ok) {
        setBusy(false);
        setNotice({ tone: "error", text: t("live.persistenceUnavailable") });
        return;
      }
      pendingRef.current = next;
      setPending(next);
      response = persisted.response;
    }

    const command = existing ?? next;
    const result = await profileTextModerationMutationResponse(response);
    if (result && profileTextModerationMutationConverged(command, result)) {
      setDecision(null);
      setReason("");
      const cleared = clearPending();
      setNotice({
        tone: cleared ? "success" : "error",
        text: cleared ? t(result.replayed ? "live.replayed" : "live.saved") : t("live.persistenceCleanupFailed"),
      });
      if (cleared) await refreshCurrent();
      setBusy(false);
      return;
    }

    const currentConflict = await profileTextModerationConflict(response);
    if (currentConflict && profileTextModerationConflictMatchesPending(command, currentConflict)) {
      setConflict(currentConflict);
      setDecision(null);
      setReason("");
      const cleared = clearPending();
      setNotice({ tone: "error", text: cleared ? t("live.conflict") : t("live.persistenceCleanupFailed") });
      if (cleared) await refreshCurrent();
      setBusy(false);
      return;
    }

    const error = profileTextModerationError(response);
    if (!profileTextModerationShouldRetainMutation(error)) {
      setDecision(null);
      setReason("");
      if (!clearPending()) {
        setNotice({ tone: "error", text: t("live.persistenceCleanupFailed") });
        setBusy(false);
        return;
      }
    }
    setNotice({
      tone: "error",
      text: error
        ? t("live.errorCode", { message: t(`errors.${profileTextModerationErrorKey(error)}`) })
        : t("live.unknownError"),
    });
    if (error === "profile-text-moderation-member-not-found") await refreshCurrent();
    setBusy(false);
  }

  function submitDecision() {
    if (!decision || !canDecide || !validReason || busy || queueBusy || pendingRef.current) return;
    const target = itemKey(decision.item);
    const mutation = profileTextModerationPendingMutation(target, {
      contract_version: 1,
      uid: decision.item.uid,
      field: decision.item.field,
      decision: decision.decision,
      expected_revision: decision.item.revision,
      content_sha256: decision.item.content_sha256,
      reason,
      request_id: crypto.randomUUID(),
    });
    if (!mutation) {
      setNotice({ tone: "error", text: t("live.invalidDecision") });
      return;
    }
    void executeMutation(mutation);
  }

  function applyFilters() {
    if (!uidInputValid || busy || queueBusy || pendingRef.current) return;
    const nextUid = uidText === "" ? null : Number(uidText);
    setAppliedField(field);
    setAppliedUid(nextUid);
    setDecision(null);
    setConflict(null);
    setNotice(null);
    const url = new URL(window.location.href);
    if (field === "all") url.searchParams.delete("field");
    else url.searchParams.set("field", field);
    if (nextUid === null) url.searchParams.delete("uid");
    else url.searchParams.set("uid", String(nextUid));
    window.history.replaceState(window.history.state, "", url);
    void load(field, nextUid);
  }

  if (state === "loading") return <LoadingPanel />;
  if (state === "forbidden") return <ErrorPanel message={t("forbidden")} retry={() => load(appliedField, appliedUid)} />;
  if (state === "error") return <ErrorPanel message={loadFailure ? t(`errors.${loadFailure}`) : t("loadError")} retry={() => load(appliedField, appliedUid)} />;

  const locked = busy || queueBusy || pending !== null;
  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />

      {!canDecide ? <div className="alert alert-info">{t("readOnly")}</div> : null}

      {pending ? (
        <div className="alert alert-info profile-text-pending">
          <div><strong>{t("live.pendingMutation")}</strong><br /><code>{pending.target}</code></div>
          <button className="button button-secondary button-small" type="button" disabled={busy} onClick={() => void executeMutation(pending)}>{t("live.retryExact")}</button>
        </div>
      ) : null}
      {notice ? <div className={`alert alert-${notice.tone}`} role="status">{notice.text}</div> : null}
      {conflict ? (
        <div className="alert alert-info profile-text-conflict">
          {conflict.current
            ? t("live.conflictCurrent", {
              field: t(`fields.${conflict.current.field}`),
              status: t(`statuses.${conflict.current.status}`),
              revision: conflict.current.revision,
            })
            : t("live.conflictRemoved")}
        </div>
      ) : null}

      <section className="panel profile-text-filters">
        <div className="panel-header"><div><h2>{t("filters.title")}</h2><p>{t("filters.copy")}</p></div></div>
        <div className="panel-body form-grid">
          <label className="field"><span>{t("filters.field")}</span><select value={field} disabled={locked} onChange={(event) => setField(event.target.value as ProfileTextModerationFilterField)}><option value="all">{t("filters.all")}</option><option value="headline">{t("fields.headline")}</option><option value="about_me">{t("fields.about_me")}</option></select></label>
          <label className="field"><span>{t("filters.uid")}</span><input inputMode="numeric" value={uidText} disabled={locked} onChange={(event) => setUidText(event.target.value)} placeholder={t("filters.uidPlaceholder")} /><small className={uidText && !uidInputValid ? "field-error" : "field-hint"}>{t("filters.uidHint")}</small></label>
          <div className="row-actions field-full"><button className="button button-primary" type="button" disabled={locked || !uidInputValid} onClick={applyFilters}>{t("filters.apply")}</button><button className="button button-secondary" type="button" disabled={locked} onClick={() => { setDecision(null); setReason(""); setConflict(null); void refreshCurrent(); }}>{common("refresh")}</button></div>
        </div>
      </section>

      <section className="panel profile-text-queue">
        <div className="panel-header"><div><h2>{t("queue.title")}</h2><p>{t("queue.count", { loaded: items.length, total })}</p></div></div>
        <div className="panel-body profile-text-list">
          {items.length === 0 ? <div className="empty-state"><h3>{t("queue.emptyTitle")}</h3><p>{t("queue.emptyCopy")}</p></div> : items.map((item) => (
            <article className="profile-text-row" key={itemKey(item)}>
              <header>
                <div><strong>{item.member.display_name || t("queue.unnamed")}</strong><code>{item.member.username}</code></div>
                <div className="status-list"><span className="status-badge status-inactive">{t(`fields.${item.field}`)}</span><span>{t("queue.revision", { revision: item.revision })}</span></div>
              </header>
              <p className="profile-text-content">{item.text}</p>
              <footer>
                <div><span>{t("queue.length", { count: item.text_length })}</span><span>{formatTimestamp(locale, item.status_updated_at, common("notAvailable"))}</span><Link href={`/users/${item.uid}`}>{t("queue.openMember", { uid: item.uid })}</Link></div>
                {canDecide ? <div className="row-actions"><button className="button button-secondary button-small" type="button" disabled={locked} onClick={() => { setDecision({ item, decision: "accepted" }); setReason(""); setConflict(null); }}>{t("decisions.accept")}</button><button className="button button-danger button-small" type="button" disabled={locked} onClick={() => { setDecision({ item, decision: "denied" }); setReason(""); setConflict(null); }}>{t("decisions.deny")}</button></div> : null}
              </footer>
            </article>
          ))}
          {nextCursor ? <button className="button button-secondary profile-text-more" type="button" disabled={locked} onClick={() => void load(appliedField, appliedUid, nextCursor, true)}>{t("queue.loadMore")}</button> : null}
        </div>
      </section>

      {decision ? (
        <section className="panel profile-text-decision">
          <div className="panel-header"><div><h2>{t(`decisions.${decision.decision}Title`)}</h2><p>{t("decisions.copy", { field: t(`fields.${decision.item.field}`), uid: decision.item.uid })}</p></div><button className="button button-secondary button-small" type="button" disabled={busy} onClick={() => { setDecision(null); setReason(""); }}>{common("cancel")}</button></div>
          <div className="panel-body form-grid">
            <div className="alert alert-info field-full">{t("decisions.unchangedText")}</div>
            <label className="field field-full"><span>{t("decisions.reason")}</span><textarea rows={3} maxLength={600} value={reason} disabled={locked} onChange={(event) => setReason(event.target.value)} /><small className={reason && !validReason ? "field-error" : "field-hint"}>{t("decisions.reasonHint", { count: scalarLength(reason) })}</small></label>
            <div className="row-actions field-full"><button className={decision.decision === "denied" ? "button button-danger" : "button button-primary"} type="button" disabled={locked || !validReason} onClick={submitDecision}>{busy ? common("saving") : t(`decisions.${decision.decision}Submit`)}</button></div>
          </div>
        </section>
      ) : null}

      <p className="page-subtitle profile-text-contract-note">{t("contractNote")}</p>
    </>
  );
}
