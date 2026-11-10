"use client";

import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import FriendingGoTabs from "@/components/FriendingGoTabs";
import PageHeader from "@/components/PageHeader";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall, adminMembershipRecovery } from "@/lib/adminClient";
import { formatDate, formatNumber } from "@/lib/format";
import {
  DEFAULT_FRIENDINGGO_LIST_FILTERS,
  FRIENDINGGO_CAPS,
  FRIENDINGGO_EXPORT_LIMIT,
  FRIENDINGGO_STATUSES,
  friendingGoError,
  friendingGoErrorKey,
  friendingGoLock,
  friendingGoLockReason,
  friendingGoNextStatus,
  friendingGoOutcomeUnknown,
  friendingGoPreorders,
  friendingGoQuery,
  friendingGoStatusConverged,
  friendingGoStatusResult,
  type FriendingGoListFilters,
  type FriendingGoPreorder,
  type FriendingGoPreorderList,
  type FriendingGoSettableStatus,
  type FriendingGoStatus,
} from "@/lib/friendinggo";
import {
  EMPTY_FRIENDINGGO_COMPOSER,
  FRIENDINGGO_STORAGE_KEYS,
  friendingGoComposer,
  friendingGoPendingStatus,
  friendingGoStore,
  friendingGoStored,
  type FriendingGoPendingStatus,
  type FriendingGoSelected,
  type FriendingGoStorage,
} from "@/lib/friendinggoConsole";
import { ADMIN_REQUEST_HEADER, ADMIN_REQUEST_HEADER_VALUE } from "@/lib/requestGuard";

export type FriendingGoListLoad = "loading" | "ready" | "invalid" | "unavailable" | "error";
export type FriendingGoNotice = { tone: "success" | "error" | "info" | "warning"; text: string };

export const FRIENDINGGO_STATUS_BADGE: Record<FriendingGoStatus, string> = {
  active: "badge-active",
  unsubscribed: "badge-inactive",
  bounced: "badge-warning",
  complained: "friendinggo-badge-danger",
};

function browserStorage(): FriendingGoStorage | null {
  try { return window.sessionStorage; } catch { return null; }
}

/** Why a read failed: a filter Core refuses, its registry unavailable, or anything else. */
export function friendingGoReadFailure(response: unknown): Exclude<FriendingGoListLoad, "loading" | "ready"> {
  const error = friendingGoError(response);
  return error === "go-filter-invalid" ? "invalid" : error === "go-preorders-unavailable" ? "unavailable" : "error";
}

type StatusConfirm = { row: FriendingGoPreorder; next: FriendingGoSettableStatus };

/** The page body for one read; pure, so every state renders in both locales in tests. */
export function FriendingGoPreordersView({
  data,
  load,
  filters,
  selection,
  notice,
  pending,
  busy,
  exporting,
  confirm,
  exportConfirm,
  onFilters,
  onReload,
  onSelect,
  onClearSelection,
  onEmailSelected,
  onAskStatus,
  onCancelStatus,
  onConfirmStatus,
  onRetryStatus,
  onDiscardStatus,
  onAskExport,
  onCancelExport,
  onConfirmExport,
}: {
  data: FriendingGoPreorderList | null;
  load: FriendingGoListLoad;
  filters: FriendingGoListFilters;
  selection: FriendingGoSelected[];
  notice: FriendingGoNotice | null;
  pending: FriendingGoPendingStatus | null;
  busy: boolean;
  exporting: boolean;
  confirm: StatusConfirm | null;
  exportConfirm: boolean;
  onFilters: (next: FriendingGoListFilters) => void;
  onReload: () => void;
  onSelect: (rows: FriendingGoPreorder[], selected: boolean) => void;
  onClearSelection: () => void;
  onEmailSelected: () => void;
  onAskStatus: (row: FriendingGoPreorder, next: FriendingGoSettableStatus) => void;
  onCancelStatus: () => void;
  onConfirmStatus: () => void;
  onRetryStatus: () => void;
  onDiscardStatus: () => void;
  onAskExport: () => void;
  onCancelExport: () => void;
  onConfirmExport: () => void;
}) {
  const t = useTranslations("friendinggo");
  const common = useTranslations("common");
  const locale = useLocale();
  const num = (value: number) => formatNumber(value, locale);
  const [query, setQuery] = useState(filters.q);
  const [queryInvalid, setQueryInvalid] = useState(false);
  const change = (next: Partial<FriendingGoListFilters>) => onFilters({ ...filters, ...next, page: next.page ?? 1 });
  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const canonical = friendingGoQuery(query);
    setQueryInvalid(canonical === null);
    if (canonical !== null) change({ q: canonical });
  };
  const failure = load === "invalid" || load === "unavailable" || load === "error" ? load : null;
  const canWrite = data?.can_write === true;
  const locked = busy || pending !== null;
  const selectedIds = new Set(selection.map((person) => person.id));
  const pageRows = data?.rows ?? [];
  const allOnPage = pageRows.length > 0 && pageRows.every((row) => selectedIds.has(row.id));
  const notActive = selection.filter((person) => person.status !== null && person.status !== "active").length;

  return (
    <>
      <FriendingGoTabs />
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("preorders.title")}
        subtitle={t("preorders.subtitle")}
        actions={(
          <>
            {canWrite ? (
              <button className="button button-secondary" type="button" disabled={exporting || load === "loading"} onClick={onAskExport}>
                {exporting ? t("preorders.export.working") : t("preorders.export.button")}
              </button>
            ) : null}
            <button className="button button-secondary" type="button" disabled={load === "loading"} onClick={onReload}>{common("refresh")}</button>
          </>
        )}
      />

      {notice ? <div className={`alert alert-${notice.tone} page-alert`} role="status">{notice.text}</div> : null}
      {pending ? (
        <div className="alert alert-warning page-alert friendinggo-pending" role="status">
          <div>
            <strong>{t("pending.title")}</strong>{" "}
            {t(`preorders.pending.${pending.command.status}`, { name: pending.name })}
          </div>
          <div className="row-actions">
            <button className="button button-secondary button-small" type="button" disabled={busy} onClick={onRetryStatus}>{t("pending.retry")}</button>
            <button className="button button-secondary button-small" type="button" disabled={busy} onClick={onDiscardStatus}>{t("pending.discard")}</button>
          </div>
        </div>
      ) : null}

      <form className="filter-bar friendinggo-filter-bar" onSubmit={search} noValidate>
        <label className="field">
          <span>{t("preorders.filters.search")}</span>
          <input
            type="search"
            value={query}
            maxLength={120}
            placeholder={t("preorders.filters.searchPlaceholder")}
            aria-invalid={queryInvalid || undefined}
            onChange={(event) => { setQuery(event.target.value); setQueryInvalid(false); }}
          />
          {queryInvalid ? <small className="field-error" role="alert">{t("preorders.filters.searchInvalid")}</small> : null}
          {data && !data.can_see_addresses ? <small className="field-hint">{t("preorders.filters.viewerSearch")}</small> : null}
        </label>
        <label className="field">
          <span>{t("preorders.filters.status")}</span>
          <select value={filters.status} onChange={(event) => change({ status: event.target.value as FriendingGoListFilters["status"] })}>
            <option value="">{t("preorders.filters.allStatuses")}</option>
            {FRIENDINGGO_STATUSES.map((status) => <option key={status} value={status}>{t(`status.${status}`)}</option>)}
          </select>
        </label>
        <div className="row-actions">
          <button className="button button-secondary" type="submit">{common("search")}</button>
          {filters.q ? (
            <button className="button button-secondary" type="button" onClick={() => { setQuery(""); setQueryInvalid(false); change({ q: "" }); }}>
              {t("preorders.filters.clear")}
            </button>
          ) : null}
        </div>
      </form>

      {failure ? <ErrorPanel message={t(`preorders.failures.${failure}`)} retry={onReload} /> : !data ? <LoadingPanel /> : (
        <div className={load === "loading" ? "friendinggo-body is-refreshing" : "friendinggo-body"}>
          {!data.can_write ? <p className="list-note friendinggo-read-only">{t("readOnly")}</p> : null}
          <section className="stat-grid friendinggo-stats" aria-label={t("preorders.cards.label")}>
            {(["all", ...FRIENDINGGO_STATUSES] as const).map((key) => (
              <article className="stat-card" key={key}>
                <span className="stat-label">{key === "all" ? t("preorders.cards.all") : t(`status.${key}`)}</span>
                <strong className="stat-value">{num(data.totals[key])}</strong>
              </article>
            ))}
          </section>

          <section className="panel friendinggo-panel">
            <div className="panel-header">
              <div>
                <h2>{t("preorders.list.title")}</h2>
                <p>{t("preorders.list.matching", { count: data.matching })}</p>
              </div>
            </div>
            {canWrite ? (
              <div className="panel-body friendinggo-bulk">
                <span>
                  {t("preorders.selection.count", { count: selection.length })}
                  {notActive > 0 ? ` ${t("preorders.selection.notActive", { count: notActive })}` : ""}
                </span>
                <div className="row-actions">
                  <button className="button button-primary button-small" type="button" disabled={selection.length === 0 || locked} onClick={onEmailSelected}>
                    {t("preorders.selection.emailSelected", { count: selection.length })}
                  </button>
                  <button className="button button-secondary button-small" type="button" disabled={selection.length === 0} onClick={onClearSelection}>
                    {t("preorders.selection.clear")}
                  </button>
                </div>
              </div>
            ) : null}
            {data.rows.length === 0 ? (
              <EmptyPanel title={filters.q || filters.status ? t("preorders.list.emptyFiltered") : t("preorders.list.empty")} />
            ) : (
              <div className="table-wrap friendinggo-table">
                <table className="data-table">
                  <thead>
                    <tr>
                      {canWrite ? (
                        <th>
                          <label className="checkbox-row">
                            <input type="checkbox" checked={allOnPage} disabled={locked} onChange={(event) => onSelect(pageRows, event.target.checked)} />
                            <span className="sr-only">{t("preorders.list.selectPage")}</span>
                          </label>
                        </th>
                      ) : null}
                      <th>{t("preorders.list.name")}</th>
                      <th>{t("preorders.list.email")}</th>
                      <th>{t("preorders.list.phone")}</th>
                      <th>{t("preorders.list.city")}</th>
                      <th>{t("preorders.list.signedUp")}</th>
                      <th>{t("preorders.list.status")}</th>
                      {canWrite ? <th>{common("actions")}</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => {
                      const next = friendingGoNextStatus(row);
                      return (
                        <tr key={row.id}>
                          {canWrite ? (
                            <td>
                              <label className="checkbox-row">
                                <input type="checkbox" checked={selectedIds.has(row.id)} disabled={locked}
                                  onChange={(event) => onSelect([row], event.target.checked)} />
                                <span className="sr-only">{t("preorders.list.selectRow", { name: row.name })}</span>
                              </label>
                            </td>
                          ) : null}
                          <td>{row.name}</td>
                          <td>{row.email}</td>
                          <td>{row.phone ?? "—"}</td>
                          <td>
                            <span className="cell-stack">
                              <span>{row.city_label || "—"}</span>
                              {row.city_label && !row.city_from_list ? <small>{t("preorders.list.cityTyped")}</small> : null}
                            </span>
                          </td>
                          <td>{formatDate(row.created_at, locale, true)}</td>
                          <td>
                            <span className="cell-stack">
                              <span className={`badge ${FRIENDINGGO_STATUS_BADGE[row.status]}`}>{t(`status.${row.status}`)}</span>
                              {row.status_source ? <small>{t(`statusSource.${row.status_source}`)} · {formatDate(row.status_changed_at, locale, true)}</small> : null}
                            </span>
                          </td>
                          {canWrite ? (
                            <td>
                              {next ? (
                                <button className="button button-secondary button-small" type="button"
                                  disabled={locked} onClick={() => onAskStatus(row, next)}>
                                  {next === "unsubscribed" ? t("preorders.status.unsubscribe") : t("preorders.status.resubscribe")}
                                </button>
                              ) : (
                                <small className="friendinggo-locked">{t(`preorders.status.locked.${friendingGoLockReason(row.status, row.status_source)}`)}</small>
                              )}
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="pagination friendinggo-pagination">
              <span>{t("page", { page: num(data.page) })}</span>
              <div className="pagination-buttons">
                <button className="button button-secondary button-small" type="button" disabled={filters.page <= 1 || load === "loading"}
                  onClick={() => change({ page: filters.page - 1 })}>{common("previous")}</button>
                <button className="button button-secondary button-small" type="button" disabled={!data.has_more || load === "loading"}
                  onClick={() => change({ page: filters.page + 1 })}>{common("next")}</button>
              </div>
            </div>
          </section>
        </div>
      )}

      {confirm ? (
        <ConfirmDialog
          title={t(`preorders.status.${confirm.next === "unsubscribed" ? "unsubscribeTitle" : "resubscribeTitle"}`, { name: confirm.row.name })}
          copy={t(`preorders.status.${confirm.next === "unsubscribed" ? "unsubscribeCopy" : "resubscribeCopy"}`, { email: confirm.row.email })}
          confirmLabel={confirm.next === "unsubscribed" ? t("preorders.status.unsubscribe") : t("preorders.status.resubscribe")}
          tone={confirm.next === "unsubscribed" ? "danger" : "primary"}
          busy={busy}
          onCancel={onCancelStatus}
          onConfirm={onConfirmStatus}
        />
      ) : null}
      {exportConfirm ? (
        <ConfirmDialog
          title={t("preorders.export.title")}
          copy={t("preorders.export.copy", {
            count: data ? Math.min(data.matching, FRIENDINGGO_EXPORT_LIMIT) : 0,
            limit: num(FRIENDINGGO_EXPORT_LIMIT),
          })}
          confirmLabel={t("preorders.export.confirm")}
          tone="primary"
          busy={exporting}
          onCancel={onCancelExport}
          onConfirm={onConfirmExport}
        />
      ) : null}
    </>
  );
}

/** A status change, settled; the pending command is kept only while its outcome is unknown. */
async function sendStatus(command: FriendingGoPendingStatus["command"]): Promise<{ response: unknown; settled: ReturnType<typeof friendingGoStatusResult> }> {
  const response = await adminCall("go_preorder_set_status", { ...command });
  const result = friendingGoStatusResult(response);
  return { response, settled: result && friendingGoStatusConverged(result, command) ? result : null };
}

/** Preorders: one read per filter change or refresh, never a recovery-loader registration. */
export default function FriendingGoPreordersConsole() {
  const t = useTranslations("friendinggo");
  const locale = useLocale();
  const router = useRouter();
  const [filters, setFilters] = useState<FriendingGoListFilters>(DEFAULT_FRIENDINGGO_LIST_FILTERS);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<FriendingGoPreorderList | null>(null);
  const [load, setLoad] = useState<FriendingGoListLoad>("loading");
  const [selection, setSelection] = useState<FriendingGoSelected[]>([]);
  const [notice, setNotice] = useState<FriendingGoNotice | null>(null);
  const [pending, setPending] = useState<FriendingGoPendingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirm, setConfirm] = useState<StatusConfirm | null>(null);
  const [exportConfirm, setExportConfirm] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    const restored = friendingGoStored(browserStorage(), FRIENDINGGO_STORAGE_KEYS.pendingStatus, friendingGoPendingStatus);
    if (restored) {
      setPending(restored);
      setNotice({ tone: "info", text: t("pending.restored") });
    }
  }, [t]);

  useEffect(() => {
    const controller = new AbortController();
    setLoad("loading");
    void adminCall("go_preorders", { ...filters }, controller.signal).then((response) => {
      if (controller.signal.aborted) return;
      const parsed = friendingGoPreorders(response, filters);
      setData(parsed);
      setLoad(parsed ? "ready" : friendingGoReadFailure(response));
    });
    return () => controller.abort();
  }, [filters, revision]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);

  const settleStatus = useCallback(async (command: FriendingGoPendingStatus) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    const { response, settled } = await sendStatus(command.command);
    const storage = browserStorage();
    if (settled) {
      friendingGoStore(storage, FRIENDINGGO_STORAGE_KEYS.pendingStatus, null);
      setPending(null);
      setNotice({
        tone: "success",
        text: !settled.changed ? t("preorders.status.unchanged", { name: command.name })
          : t(settled.preorder.status === "active" ? "preorders.status.resubscribed" : "preorders.status.unsubscribed", { name: command.name }),
      });
      reload();
    } else if (friendingGoOutcomeUnknown(response)) {
      setPending(command);
      setNotice({ tone: "error", text: t(`errors.${friendingGoErrorKey(friendingGoError(response))}`) });
    } else {
      // A named refusal is final for its request id: the next attempt is a new change.
      friendingGoStore(storage, FRIENDINGGO_STORAGE_KEYS.pendingStatus, null);
      setPending(null);
      const error = friendingGoError(response);
      const lock = friendingGoLock(response);
      setNotice({
        tone: "error",
        text: lock ? t(`preorders.status.locked.${lock}`) : t(`errors.${friendingGoErrorKey(error)}`),
      });
      if (error === "go-preorder-status-locked" || error === "go-preorder-not-found") reload();
    }
    busyRef.current = false;
    setBusy(false);
  }, [reload, t]);

  function confirmStatus() {
    if (!confirm || pending) return;
    const command: FriendingGoPendingStatus = {
      version: 1,
      command: { preorder_id: confirm.row.id, status: confirm.next, request_id: crypto.randomUUID() },
      name: confirm.row.name,
    };
    setConfirm(null);
    // The request id is stored before the request leaves, so a lost answer is retried, never re-minted.
    if (!friendingGoStore(browserStorage(), FRIENDINGGO_STORAGE_KEYS.pendingStatus, command)) {
      setNotice({ tone: "error", text: t("errors.storageUnavailable") });
      return;
    }
    setPending(command);
    void settleStatus(command);
  }

  function select(rows: FriendingGoPreorder[], selected: boolean) {
    const others = selection.filter((person) => !rows.some((row) => row.id === person.id));
    if (!selected) {
      setSelection(others);
      return;
    }
    const added = [...others, ...rows.map((row) => ({ id: row.id, name: row.name, status: row.status }))];
    if (added.length > FRIENDINGGO_CAPS.newsletter) {
      setNotice({ tone: "error", text: t("preorders.selection.limit", { limit: formatNumber(FRIENDINGGO_CAPS.newsletter, locale) }) });
      return;
    }
    setSelection(added);
  }

  function emailSelected() {
    const storage = browserStorage();
    // The Email tab keeps what was being written; only the audience changes to these people.
    const composer = friendingGoStored(storage, FRIENDINGGO_STORAGE_KEYS.composer, friendingGoComposer) ?? EMPTY_FRIENDINGGO_COMPOSER;
    const stored = friendingGoStore(storage, FRIENDINGGO_STORAGE_KEYS.audience, selection)
      && friendingGoStore(storage, FRIENDINGGO_STORAGE_KEYS.composer, { ...composer, audience: "selected" });
    if (!stored) {
      setNotice({ tone: "error", text: t("errors.storageUnavailable") });
      return;
    }
    router.push("/friendinggo/email");
  }

  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    setNotice(null);
    let response: Response | null = null;
    try {
      response = await fetch("/api/admin/go-preorders-export", {
        method: "POST",
        headers: { "Content-Type": "application/json", [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE },
        body: JSON.stringify({ q: filters.q, status: filters.status }),
        cache: "no-store",
      });
    } catch {
      response = null;
    }
    if (response?.ok && (response.headers.get("content-type") ?? "").startsWith("text/csv")) {
      const blob = await response.blob();
      const name = /filename="([^"]+)"/u.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "friendinggo-preorders.csv";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      const rows = Number(response.headers.get("x-friendinggo-row-count") ?? "0");
      setNotice({
        tone: response.headers.get("x-friendinggo-truncated") === "1" ? "warning" : "success",
        text: response.headers.get("x-friendinggo-truncated") === "1"
          ? t("preorders.export.truncated", { limit: formatNumber(FRIENDINGGO_EXPORT_LIMIT, locale) })
          : t("preorders.export.done", { count: Number.isSafeInteger(rows) ? rows : 0 }),
      });
    } else {
      let body: unknown = null;
      try { body = response ? await response.json() : null; } catch { body = null; }
      if (response?.status === 401 && (body as { error?: unknown } | null)?.error === "auth-required") {
        window.location.assign("/login");
        return;
      }
      if (response?.status === 503 && (body as { error?: unknown } | null)?.error === "admin-membership-unconfirmed") {
        adminMembershipRecovery.markUnconfirmed();
      }
      setNotice({ tone: "error", text: t(`errors.${friendingGoErrorKey(friendingGoError(body))}`) });
    }
    setExporting(false);
    setExportConfirm(false);
  }

  return (
    <FriendingGoPreordersView
      data={data}
      load={load}
      filters={filters}
      selection={selection}
      notice={notice}
      pending={pending}
      busy={busy}
      exporting={exporting}
      confirm={confirm}
      exportConfirm={exportConfirm}
      // An answer belongs to its filters: the previous view is cleared, never shown under new ones.
      onFilters={(next) => { setData(null); setFilters(next); }}
      onReload={reload}
      onSelect={select}
      onClearSelection={() => setSelection([])}
      onEmailSelected={emailSelected}
      onAskStatus={(row, next) => { if (!pending && !busy) setConfirm({ row, next }); }}
      onCancelStatus={() => setConfirm(null)}
      onConfirmStatus={confirmStatus}
      onRetryStatus={() => { if (pending) void settleStatus(pending); }}
      onDiscardStatus={() => {
        friendingGoStore(browserStorage(), FRIENDINGGO_STORAGE_KEYS.pendingStatus, null);
        setPending(null);
        setNotice({ tone: "info", text: t("pending.discarded") });
        reload();
      }}
      onAskExport={() => setExportConfirm(true)}
      onCancelExport={() => setExportConfirm(false)}
      onConfirmExport={() => void exportCsv()}
    />
  );
}
