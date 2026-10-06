"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { formatDate, formatNumber } from "@/lib/format";
import {
  INTO_TAG_MODERATION_PAGE_SIZE,
  INTO_TAG_MODERATION_REASON_MAX_LENGTH,
  INTO_TAG_MODERATION_TABS,
  intoTagModerationAuditId,
  intoTagModerationCanDecide,
  intoTagModerationConflictResponse,
  intoTagModerationDecidePayload,
  intoTagModerationDecisionResponse,
  intoTagModerationErrorKey,
  intoTagModerationErrorResponse,
  intoTagModerationListResponse,
  intoTagModerationMergeTargets,
  intoTagModerationSettingsPayload,
  intoTagModerationSettingsResponse,
  intoTagModerationShouldRetainRequest,
  normalizeIntoTagModerationReason,
  type IntoTagModerationCounts,
  type IntoTagModerationDecidePayload,
  type IntoTagModerationItem,
  type IntoTagModerationListData,
  type IntoTagModerationPrincipal,
  type IntoTagModerationSettingsPayload,
  type IntoTagModerationTab,
  type IntoTagVerdict,
} from "@/lib/intoTagModeration";

type Notice = { tone: "success" | "error" | "info"; text: string };

type Receipt = {
  auditId: string;
  requestId: string;
  replayed: boolean;
  verified: boolean | null;
  summary: string;
};

/** The exact material of one uncertain write, kept so a retry replays it. */
type Retained =
  | { kind: "decide"; payload: IntoTagModerationDecidePayload }
  | { kind: "settings"; payload: IntoTagModerationSettingsPayload };

type DecisionDraft = {
  verdict: IntoTagVerdict;
  keys: string[];
  reason: string;
  mergeInto: string;
};

const EMPTY_COUNTS: IntoTagModerationCounts = { approved: 0, pending: 0, rejected: 0, merged: 0 };

function labelFor(item: IntoTagModerationItem, locale: string): string {
  return (locale === "hu" ? item.label_hu : item.label) || item.label || item.key;
}

function stateBadgeClass(state: IntoTagModerationItem["moderation_state"]): string {
  switch (state) {
    case "pending": return "status-badge status-pending";
    case "rejected": return "status-badge status-denied";
    case "merged": return "status-badge status-merged";
    default: return "status-badge status-accepted";
  }
}

export default function IntoTagModerationQueue() {
  const t = useTranslations("intoTagModeration");
  const common = useTranslations("common");
  const locale = useLocale();

  const [tab, setTab] = useState<IntoTagModerationTab>("pending");
  const [rows, setRows] = useState<IntoTagModerationItem[]>([]);
  const [principal, setPrincipal] = useState<IntoTagModerationPrincipal | null>(null);
  const [counts, setCounts] = useState<IntoTagModerationCounts>(EMPTY_COUNTS);
  const [revision, setRevision] = useState(0);
  const [memberCreation, setMemberCreation] = useState(false);
  const [nextCursor, setNextCursor] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error" | "forbidden">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [retained, setRetained] = useState<Retained | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState<DecisionDraft | null>(null);
  const [approveConfirm, setApproveConfirm] = useState<string[] | null>(null);
  const [mergeQuery, setMergeQuery] = useState("");
  const [mergeTargets, setMergeTargets] = useState<IntoTagModerationItem[]>([]);
  const [mergeTargetsState, setMergeTargetsState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  const rowsRef = useRef<IntoTagModerationItem[]>([]);
  const revisionRef = useRef(0);
  const retainedRef = useRef<Retained | null>(null);
  const requestGeneration = useRef(0);

  const adopt = useCallback((data: IntoTagModerationListData, append: boolean): boolean => {
    if (data.state !== tab) return false;
    const next = append ? [...rowsRef.current, ...data.items] : data.items;
    // The queue pages by key ascending, so an appended page must continue the
    // one before it. Anything else means two pages of different reads were
    // stitched together, and a moderator would decide against a row they were
    // never shown.
    if (
      new Set(next.map((row) => row.key)).size !== next.length
      || next.some((row, index) => index > 0 && next[index - 1].key >= row.key)
    ) return false;
    rowsRef.current = next;
    revisionRef.current = data.revision;
    setRows(next);
    setPrincipal(data.principal);
    setCounts(data.counts);
    setRevision(data.revision);
    setMemberCreation(data.member_creation_enabled);
    setNextCursor(data.next_cursor);
    setState("ready");
    return true;
  }, [tab]);

  const load = useCallback(async (cursor: string, append: boolean) => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    if (append) setLoadingMore(true);
    else setState("loading");
    const response = await adminCall("into_tag_moderation_list", {
      state: tab,
      limit: INTO_TAG_MODERATION_PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    });
    if (requestGeneration.current !== generation) return;
    setLoadingMore(false);
    const parsed = intoTagModerationListResponse(response);
    if (parsed && adopt(parsed, append)) return;
    // A capability refusal is a permanent answer about this operator, not a
    // transient read failure, so it gets its own state rather than a retry.
    setState(intoTagModerationErrorResponse(response) === "catalog-admin-capability-required"
      ? "forbidden"
      : "error");
  }, [adopt, tab]);

  useEffect(() => {
    rowsRef.current = [];
    setRows([]);
    setSelected([]);
    setNextCursor("");
    void load("", false);
  }, [load]);

  const remember = useCallback((value: Retained | null) => {
    retainedRef.current = value;
    setRetained(value);
  }, []);

  async function publishReceipt(
    requestId: string,
    auditIdValue: string,
    replayed: boolean,
    summary: string,
  ) {
    // `wai:sha256(family \0 request_id)` is derivable, so the receipt is
    // checked against the request this browser actually sent rather than
    // merely printed. `null` means WebCrypto was unavailable, never "wrong".
    const expected = await intoTagModerationAuditId(requestId);
    setReceipt({
      auditId: auditIdValue,
      requestId,
      replayed,
      verified: expected === null ? null : expected === auditIdValue,
      summary,
    });
  }

  /** Adopt the authoritative plane state a 409 handed back. */
  function adoptConflict(current: { revision: number; member_creation_enabled: boolean; counts: IntoTagModerationCounts }) {
    revisionRef.current = current.revision;
    setRevision(current.revision);
    setMemberCreation(current.member_creation_enabled);
    setCounts(current.counts);
    remember(null);
  }

  /**
   * One decide. Returns the plane revision to continue a batch with, or the
   * localized reason the batch must stop. The request id is minted once by the
   * caller and reused by the retry control for as long as the outcome is
   * unknown, so a retry is a replay rather than a second decision.
   */
  async function decideOne(
    payload: IntoTagModerationDecidePayload,
    summary: string,
  ): Promise<{ ok: true; revision: number } | { ok: false; message: string }> {
    remember({ kind: "decide", payload });
    const response = await adminCall("into_tag_moderation_decide", payload);
    const result = intoTagModerationDecisionResponse(response);
    if (result && result.item.key === payload.key) {
      revisionRef.current = result.revision;
      setRevision(result.revision);
      setCounts(result.counts);
      remember(null);
      await publishReceipt(payload.request_id, result.audit_id, result.replayed, summary);
      return { ok: true, revision: result.revision };
    }
    const conflict = intoTagModerationConflictResponse(response);
    if (conflict) {
      adoptConflict(conflict.current);
      return { ok: false, message: t("errors.conflict") };
    }
    const error = intoTagModerationErrorResponse(response);
    if (!intoTagModerationShouldRetainRequest(error)) remember(null);
    return { ok: false, message: t(`errors.${intoTagModerationErrorKey(error)}`) };
  }

  async function runDecision(input: DecisionDraft) {
    if (busy || input.keys.length === 0) return;
    const reason = normalizeIntoTagModerationReason(input.reason);
    if (reason === null) {
      setNotice({ tone: "error", text: t("errors.reasonInvalid") });
      return;
    }
    setBusy(true);
    setNotice(null);
    let expected = revisionRef.current;
    let done = 0;
    let failure: string | null = null;
    for (const key of input.keys) {
      const payload = intoTagModerationDecidePayload(
        key,
        input.verdict,
        input.verdict === "merge" ? input.mergeInto : undefined,
        reason,
        expected,
        crypto.randomUUID(),
      );
      if (!payload) {
        failure = t("errors.requestInvalid");
        break;
      }
      const outcome = await decideOne(payload, `${t(`verdicts.${input.verdict}`)} · ${key}`);
      if (!outcome.ok) {
        failure = outcome.message;
        break;
      }
      expected = outcome.revision;
      done += 1;
    }
    setBusy(false);
    setDraft(null);
    setApproveConfirm(null);
    setSelected([]);
    // The reason a batch stopped is the useful half of the message, so it is
    // never replaced by the count — the count is prepended to it.
    setNotice(failure === null
      ? { tone: "success", text: t("decisionSaved", { count: done }) }
      : {
          tone: "error",
          text: done === 0
            ? failure
            : `${t("decisionPartial", { done, total: input.keys.length })} ${failure}`,
        });
    // The plane revision moved and decided rows left this tab, so the visible
    // page is stale by construction; re-read rather than patching rows locally.
    await load("", false);
  }

  async function retainedRetry() {
    const pending = retainedRef.current;
    if (!pending || busy) return;
    setBusy(true);
    setNotice(null);
    if (pending.kind === "decide") {
      const outcome = await decideOne(pending.payload, t("retrySummary"));
      setNotice(outcome.ok
        ? { tone: "success", text: t("decisionSaved", { count: 1 }) }
        : { tone: "error", text: outcome.message });
    } else {
      await saveSettings(pending.payload);
    }
    setBusy(false);
    await load("", false);
  }

  async function saveSettings(payload: IntoTagModerationSettingsPayload) {
    remember({ kind: "settings", payload });
    const response = await adminCall("into_tag_moderation_settings", payload);
    const result = intoTagModerationSettingsResponse(response);
    if (result) {
      revisionRef.current = result.revision;
      setRevision(result.revision);
      setCounts(result.counts);
      setMemberCreation(result.member_creation_enabled);
      remember(null);
      await publishReceipt(
        payload.request_id,
        result.audit_id,
        result.replayed,
        t(result.member_creation_enabled ? "memberCreationOn" : "memberCreationOff"),
      );
      setNotice({ tone: "success", text: t("settingsSaved") });
      return;
    }
    const conflict = intoTagModerationConflictResponse(response);
    if (conflict) {
      adoptConflict(conflict.current);
      setNotice({ tone: "error", text: t("errors.conflict") });
      return;
    }
    const error = intoTagModerationErrorResponse(response);
    if (!intoTagModerationShouldRetainRequest(error)) remember(null);
    setNotice({ tone: "error", text: t(`errors.${intoTagModerationErrorKey(error)}`) });
  }

  async function toggleMemberCreation(enabled: boolean) {
    if (busy) return;
    const payload = intoTagModerationSettingsPayload(enabled, revisionRef.current, crypto.randomUUID());
    if (!payload) {
      setNotice({ tone: "error", text: t("errors.requestInvalid") });
      return;
    }
    setBusy(true);
    setNotice(null);
    await saveSettings(payload);
    setBusy(false);
    // The switch shares the plane revision with every decision, so a write
    // here invalidates the revision the visible rows were loaded against.
    await load("", false);
  }

  /** Load approved, active rows for the merge picker; Core refuses any other target. */
  const loadMergeTargets = useCallback(async () => {
    setMergeTargetsState("loading");
    const collected: IntoTagModerationItem[] = [];
    let cursor = "";
    // The catalogue cap is 5000 rows (D-107 R8) and a page is 200, so 25 pages
    // reach the whole approved vocabulary. The bound exists so a Core that
    // never stops handing back a cursor cannot spin the browser forever.
    for (let page = 0; page < 25; page += 1) {
      const response = await adminCall("into_tag_moderation_list", {
        state: "approved",
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      const parsed = intoTagModerationListResponse(response);
      if (!parsed || parsed.state !== "approved") {
        setMergeTargetsState("error");
        return;
      }
      collected.push(...parsed.items);
      if (!parsed.next_cursor) break;
      cursor = parsed.next_cursor;
    }
    setMergeTargets(collected);
    setMergeTargetsState("ready");
  }, []);

  function openDecision(verdict: IntoTagVerdict, keys: string[]) {
    if (keys.length === 0) return;
    setNotice(null);
    if (verdict === "approve") {
      setApproveConfirm(keys);
      return;
    }
    setDraft({ verdict, keys, reason: "", mergeInto: "" });
    if (verdict === "merge") {
      setMergeQuery("");
      if (mergeTargetsState !== "ready") void loadMergeTargets();
    }
  }

  if (state === "loading") return <LoadingPanel />;
  if (state === "forbidden") {
    return (
      <>
        <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />
        <div className="panel empty-state">
          <div className="empty-state-inner"><h3>{t("forbiddenTitle")}</h3><p>{t("forbiddenCopy")}</p></div>
        </div>
      </>
    );
  }
  if (state === "error" || !principal) {
    return <ErrorPanel message={t("loadError")} retry={() => void load("", false)} />;
  }

  const canDecide = intoTagModerationCanDecide(principal);
  const selectable = rows.map((row) => row.key);
  const allSelected = selectable.length > 0 && selected.length === selectable.length;
  const pickerRows = draft?.verdict === "merge"
    ? intoTagModerationMergeTargets(mergeTargets, draft.keys[0] ?? "", mergeQuery).slice(0, 50)
    : [];
  const draftReasonLength = draft ? Array.from(draft.reason).length : 0;

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <button className="button button-secondary" type="button" disabled={busy} onClick={() => void load("", false)}>
            {common("refresh")}
          </button>
        }
      />

      {notice ? <div className={`alert alert-${notice.tone} page-alert`} role="status">{notice.text}</div> : null}
      {retained ? (
        <div className="alert alert-info page-alert into-tag-pending" role="status">
          <div><strong>{t("pendingTitle")}</strong> {t("pendingCopy")}</div>
          {canDecide ? <button className="button button-secondary button-small" type="button" disabled={busy} onClick={() => void retainedRetry()}>{t("retryPending")}</button> : null}
        </div>
      ) : null}
      {!canDecide ? <div className="alert alert-info page-alert">{t("viewerNotice")}</div> : null}

      <section className="panel into-tag-settings-panel">
        <div className="panel-header">
          <div><h2>{t("settingsTitle")}</h2><p>{t("settingsCopy")}</p></div>
          <span className="badge">{t("revision", { revision })}</span>
        </div>
        <div className="panel-body into-tag-settings-body">
          <label className="into-tag-settings-switch">
            <span>
              <strong>{t("memberCreation")}</strong>
              <small>{memberCreation ? t("memberCreationOn") : t("memberCreationOff")}</small>
            </span>
            <span className={`switch${busy || !canDecide ? " is-disabled" : ""}`}>
              <input
                type="checkbox"
                checked={memberCreation}
                disabled={busy || !canDecide}
                onChange={(event) => void toggleMemberCreation(event.target.checked)}
              />
              <span className="switch-track" />
            </span>
          </label>
          {receipt ? (
            <dl className="detail-list into-tag-receipt">
              <div className="detail-row"><dt>{t("receiptAction")}</dt><dd>{receipt.summary}</dd></div>
              <div className="detail-row"><dt>{t("receiptRequestId")}</dt><dd><code>{receipt.requestId}</code></dd></div>
              <div className="detail-row"><dt>{t("receiptAuditId")}</dt><dd><code>{receipt.auditId}</code></dd></div>
              <div className="detail-row">
                <dt>{t("receiptOutcome")}</dt>
                <dd>
                  {receipt.replayed ? t("receiptReplayed") : t("receiptApplied")}
                  {receipt.verified === null ? null : <small className="into-tag-muted"> · {receipt.verified ? t("receiptVerified") : t("receiptUnverified")}</small>}
                </dd>
              </div>
            </dl>
          ) : null}
        </div>
      </section>

      <nav className="into-tag-tabs" role="tablist" aria-label={t("tabsLabel")}>
        {INTO_TAG_MODERATION_TABS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? "is-active" : ""}
            disabled={busy}
            onClick={() => { setTab(value); setSelected([]); }}
          >
            {t(`tabs.${value}`)} <span className="badge">{formatNumber(counts[value], locale)}</span>
          </button>
        ))}
      </nav>

      <section className="panel into-tag-queue-panel">
        <div className="panel-header">
          <div><h2>{t(`tabs.${tab}`)}</h2><p>{t("queueCopy")}</p></div>
          <span className="badge">{t("loaded", { count: rows.length })}</span>
        </div>

        {canDecide && rows.length > 0 ? (
          <div className="panel-body into-tag-bulk">
            <span>{t("selectedCount", { count: selected.length })}</span>
            <div className="row-actions">
              <button className="button button-primary button-small" type="button" disabled={busy || selected.length === 0} onClick={() => openDecision("approve", selected)}>{t("verdicts.approve")}</button>
              <button className="button button-danger button-small" type="button" disabled={busy || selected.length === 0} onClick={() => openDecision("reject", selected)}>{t("verdicts.reject")}</button>
            </div>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-inner"><h3>{t("emptyTitle")}</h3><p>{t("emptyCopy")}</p></div>
          </div>
        ) : (
          <div className="table-wrap into-tag-table-wrap">
            <table className="data-table into-tag-table">
              <thead>
                <tr>
                  {canDecide ? (
                    <th>
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          disabled={busy}
                          onChange={(event) => setSelected(event.target.checked ? selectable : [])}
                        />
                        <span className="sr-only">{t("selectAll")}</span>
                      </label>
                    </th>
                  ) : null}
                  <th>{t("columnTag")}</th>
                  <th>{t("columnProvenance")}</th>
                  <th>{t("columnCreator")}</th>
                  <th>{t("columnMembers")}</th>
                  <th>{common("createdAt")}</th>
                  <th>{common("status")}</th>
                  <th>{common("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    {canDecide ? (
                      <td data-label={t("selectAll")}>
                        <label className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={selected.includes(row.key)}
                            disabled={busy}
                            onChange={(event) => setSelected(event.target.checked
                              ? [...selected, row.key]
                              : selected.filter((key) => key !== row.key))}
                          />
                          <span className="sr-only">{labelFor(row, locale)}</span>
                        </label>
                      </td>
                    ) : null}
                    <td data-label={t("columnTag")}>
                      <div className="cell-stack">
                        <strong>{labelFor(row, locale)}</strong>
                        <small><code>{row.key}</code></small>
                        {row.merged_into ? <small>{t("mergedInto", { key: row.merged_into })}</small> : null}
                      </div>
                    </td>
                    <td data-label={t("columnProvenance")}>
                      <span className="badge">{t(`provenance.${row.provenance || "unknown"}`)}</span>
                    </td>
                    <td data-label={t("columnCreator")}>
                      {row.created_by_uid > 0
                        ? <Link href={`/users/${row.created_by_uid}`}>{t("uid", { uid: row.created_by_uid })}</Link>
                        : <span className="into-tag-muted">{t("noCreator")}</span>}
                    </td>
                    <td data-label={t("columnMembers")}>
                      <div className="cell-stack">
                        <span>{formatNumber(row.member_count, locale)}</span>
                        {row.source_member_count > 0 ? <small>{t("sourceMembers", { count: row.source_member_count })}</small> : null}
                      </div>
                    </td>
                    <td data-label={common("createdAt")}>{formatDate(row.created_at, locale)}</td>
                    <td data-label={common("status")}>
                      <div className="cell-stack">
                        <span className={stateBadgeClass(row.moderation_state)}>{t(`states.${row.moderation_state}`)}</span>
                        {row.moderated_by ? <small>{row.moderated_by}</small> : null}
                        {row.moderation_reason ? <small>{row.moderation_reason}</small> : null}
                      </div>
                    </td>
                    <td data-label={common("actions")}>
                      {canDecide ? (
                        <div className="row-actions">
                          <button className="button button-primary button-small" type="button" disabled={busy || row.moderation_state === "approved"} onClick={() => openDecision("approve", [row.key])}>{t("verdicts.approve")}</button>
                          <button className="button button-danger button-small" type="button" disabled={busy || row.moderation_state === "rejected"} onClick={() => openDecision("reject", [row.key])}>{t("verdicts.reject")}</button>
                          <button className="button button-secondary button-small" type="button" disabled={busy} onClick={() => openDecision("merge", [row.key])}>{t("verdicts.merge")}</button>
                        </div>
                      ) : <span className="into-tag-muted">{t("readOnlyRow")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {nextCursor ? (
          <div className="into-tag-load-more">
            <button className="button button-secondary" type="button" disabled={loadingMore || busy} onClick={() => void load(nextCursor, true)}>
              {loadingMore ? common("loading") : t("loadMore")}
            </button>
          </div>
        ) : null}
      </section>

      {approveConfirm ? (
        <ConfirmDialog
          title={t("confirm.approveTitle")}
          copy={t("confirm.approveCopy", { count: approveConfirm.length })}
          confirmLabel={t("verdicts.approve")}
          busy={busy}
          onCancel={() => setApproveConfirm(null)}
          onConfirm={() => void runDecision({ verdict: "approve", keys: approveConfirm, reason: "", mergeInto: "" })}
        />
      ) : null}

      {draft ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) setDraft(null); }}>
          <section className="dialog into-tag-dialog" role="dialog" aria-modal="true" aria-labelledby="into-tag-decision-title">
            <div className="dialog-header">
              <div>
                <h2 id="into-tag-decision-title">{t(`confirm.${draft.verdict}Title`)}</h2>
                <p>{t(`confirm.${draft.verdict}Copy`, { count: draft.keys.length })}</p>
              </div>
              <button className="dialog-close" type="button" disabled={busy} onClick={() => setDraft(null)} aria-label={common("close")}>×</button>
            </div>
            <div className="dialog-body form-stack">
              {draft.verdict === "merge" ? (
                <>
                  <label className="field">
                    <span>{t("mergeSearch")}</span>
                    <input value={mergeQuery} disabled={busy} onChange={(event) => setMergeQuery(event.target.value)} />
                    <small className="field-hint">{t("mergeHint")}</small>
                  </label>
                  {mergeTargetsState === "error" ? <div className="alert alert-error" role="alert">{t("errors.mergeTargets")}</div> : null}
                  <div className="into-tag-merge-picker" role="listbox" aria-label={t("mergeSearch")}>
                    {mergeTargetsState === "loading" ? <p className="page-subtitle">{common("loading")}</p> : null}
                    {mergeTargetsState === "ready" && pickerRows.length === 0 ? <p className="page-subtitle">{common("noResults")}</p> : null}
                    {pickerRows.map((target) => (
                      <button
                        key={target.key}
                        type="button"
                        role="option"
                        aria-selected={draft.mergeInto === target.key}
                        className={draft.mergeInto === target.key ? "is-active" : ""}
                        disabled={busy}
                        onClick={() => setDraft({ ...draft, mergeInto: target.key })}
                      >
                        <strong>{labelFor(target, locale)}</strong>
                        <code>{target.key}</code>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              <label className="field">
                <span>{t("reason")}</span>
                <textarea
                  rows={4}
                  maxLength={INTO_TAG_MODERATION_REASON_MAX_LENGTH}
                  value={draft.reason}
                  disabled={busy}
                  onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
                />
                <small className="field-hint">{t("reasonHint", { count: draftReasonLength })}</small>
              </label>
            </div>
            <div className="dialog-actions">
              <button className="button button-secondary" type="button" disabled={busy} onClick={() => setDraft(null)}>{common("cancel")}</button>
              <button
                className={`button ${draft.verdict === "reject" ? "button-danger" : "button-primary"}`}
                type="button"
                disabled={busy || (draft.verdict === "merge" && draft.mergeInto === "")}
                onClick={() => void runDecision(draft)}
              >
                {busy ? common("working") : t(`verdicts.${draft.verdict}`)}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
