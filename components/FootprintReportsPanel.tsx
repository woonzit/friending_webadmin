"use client";

// The reported-footprints queue (P-066): one status tab at a time, cursor-paged,
// with Dismiss and Remove message behind a confirmation that takes an optional
// note. Both resolutions are Core editor actions, so the controls render only
// for a write role proven by admin_me; an unreadable admin_me fails closed.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import { adminCall, type AdminResponse } from "@/lib/adminClient";
import { adminMembershipFailureText } from "@/lib/adminMembershipFailureText";
import { isAdminWriteRole } from "@/lib/authPolicy";
import { formatDate } from "@/lib/format";
import {
  FOOTPRINT_REPORT_PAGE_SIZE,
  FOOTPRINT_RESOLUTION_NOTE_MAX,
  canRemoveFootprintMessage,
  codePointLength,
  footprintReportMemberUid,
  footprintReportPage,
  footprintReportResolveResult,
  footprintStateKeys,
  normalizedFootprintResolutionNote,
  type FootprintReport,
  type FootprintReportAction,
  type FootprintReportStatus,
  type FootprintReportUser,
} from "@/lib/footprints";

type PendingAction = { report: FootprintReport; action: FootprintReportAction };
type Notice = { tone: "success" | "error"; text: string };

function errorCode(response: AdminResponse | null): string {
  if (typeof response?.error === "string" && response.error.trim() !== "") return response.error;
  // A success the console cannot bind to its request (e.g. a row for another report).
  return response?.success === true ? "unexpected-response" : "request-failed";
}

export default function FootprintReportsPanel({
  openReports,
  onResolved,
}: {
  openReports: number;
  /** Re-reads the authoritative open count after any resolution attempt. */
  onResolved: () => void;
}) {
  const t = useTranslations("footprints");
  const membership = useTranslations("adminMembership");
  const common = useTranslations("common");
  const locale = useLocale();

  const [status, setStatus] = useState<FootprintReportStatus>("open");
  const [reports, setReports] = useState<FootprintReport[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const request = useRef(0);
  const moreInFlight = useRef(false);

  const [access, setAccess] = useState<"loading" | "write" | "read" | "error">("loading");
  const canWrite = access === "write";

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let active = true;
    void adminCall("admin_me").then((response) => {
      if (!active) return;
      if (response?.success !== true || typeof response.role !== "string") {
        setAccess("error");
        return;
      }
      setAccess(isAdminWriteRole(response.role) ? "write" : "read");
    });
    return () => { active = false; };
  }, []);

  const load = useCallback(async (nextStatus: FootprintReportStatus) => {
    const requestId = ++request.current;
    moreInFlight.current = false;
    setStatus(nextStatus);
    setLoading(true);
    setFailed(false);
    setMoreLoading(false);
    setMoreFailed(false);
    const response = await adminCall("footprint_reports", {
      status: nextStatus,
      limit: FOOTPRINT_REPORT_PAGE_SIZE,
    });
    if (requestId !== request.current) return;
    const page = response?.success ? footprintReportPage(response, nextStatus, FOOTPRINT_REPORT_PAGE_SIZE) : null;
    setLoading(false);
    setFailed(page === null);
    setReports(page?.reports ?? null);
    setNextCursor(page?.nextCursor ?? null);
  }, []);

  useEffect(() => { void load("open"); }, [load]);

  async function loadMore() {
    if (!nextCursor || !reports || moreInFlight.current) return;
    moreInFlight.current = true;
    const requestId = request.current;
    const cursor = nextCursor;
    setMoreLoading(true);
    setMoreFailed(false);
    const response = await adminCall("footprint_reports", {
      status,
      cursor,
      limit: FOOTPRINT_REPORT_PAGE_SIZE,
    });
    // A tab switch or reload started a new list; this page belongs to the old one.
    if (requestId !== request.current) return;
    moreInFlight.current = false;
    setMoreLoading(false);
    const page = response?.success ? footprintReportPage(response, status, FOOTPRINT_REPORT_PAGE_SIZE) : null;
    // Core's cursor never repeats a row; one that does means the pages disagree.
    const shown = new Set(reports.map((report) => report.id));
    if (!page || page.reports.some((report) => shown.has(report.id))) {
      setMoreFailed(true);
      return;
    }
    setReports([...reports, ...page.reports]);
    setNextCursor(page.nextCursor);
  }

  function openAction(report: FootprintReport, action: FootprintReportAction) {
    if (!canWrite) return;
    setNotice(null);
    setNote("");
    setPending({ report, action });
  }

  const cancelAction = useCallback(() => {
    if (!busy) setPending(null);
  }, [busy]);

  async function confirmAction() {
    if (!pending || !canWrite || busy) return;
    const normalizedNote = normalizedFootprintResolutionNote(note);
    if (normalizedNote === null) return;
    const { report, action } = pending;
    setBusy(true);
    const response = await adminCall("resolve_footprint_report", {
      id: report.id,
      action,
      note: normalizedNote,
    });
    setBusy(false);
    setPending(null);
    setNote("");
    onResolved();
    const result = footprintReportResolveResult(response, report.id);
    if (!result) {
      // Refused, lost, timed out or answered for another report: the write may or
      // may not have landed, so the console re-reads the queue instead of
      // offering a blind retry.
      setNotice({ tone: "error", text: adminMembershipFailureText(errorCode(response), t("reportActionError", { code: errorCode(response) }), membership("requestUnconfirmed")) });
      void load(status);
      return;
    }
    if (result.report === null) {
      // Core confirmed the resolution without a readable row: re-read it.
      void load(status);
    } else if (status === "open") {
      setReports((current) => current?.filter((row) => row.id !== report.id) ?? current);
    }
    if (action === "remove_message" && result.report?.resolution !== "message_removed") {
      setNotice({ tone: "error", text: t("reportRemoveNotConfirmed") });
      return;
    }
    setNotice({
      tone: "success",
      text: action === "remove_message" ? t("reportMessageRemovedNotice") : t("reportDismissedNotice"),
    });
  }

  function memberCell(report: FootprintReport, side: "reporter" | "sender") {
    const uid = footprintReportMemberUid(report, side);
    const card: FootprintReportUser | null = side === "reporter" ? report.reporter : report.sender;
    if (uid === null) return <span>—</span>;
    return (
      <span className="footprints-report-member">
        <Link href={`/users/${uid}`}>{card?.name ?? t("reportMemberUnavailable")}</Link>
        <small>#{uid}</small>
      </span>
    );
  }

  const noteLength = codePointLength(note.replace(/\s+/gu, " ").trim());
  const noteTooLong = normalizedFootprintResolutionNote(note) === null;

  return (
    <section className="panel">
      <div className="panel-head-row">
        <h2>{t("reportsTitle", { count: openReports })}</h2>
        <div className="footprints-report-tabs" role="tablist">
          {(["open", "resolved"] as const).map((tab) => (
            <button
              type="button"
              role="tab"
              aria-selected={status === tab}
              className={status === tab ? "is-active" : ""}
              key={tab}
              onClick={() => { setNotice(null); void load(tab); }}
            >
              {t(`reportStatus.${tab}`)}
            </button>
          ))}
        </div>
      </div>
      {access === "read" || access === "error" ? (
        <p className="panel-lead footprints-report-readonly">{t("reportReadOnly")}</p>
      ) : null}
      {notice ? (
        <p className={`alert alert-${notice.tone} footprints-report-notice`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      ) : null}
      {loading ? (
        <p className="panel-lead">{common("loading")}</p>
      ) : failed || reports === null ? (
        <div className="footprints-report-error" role="alert">
          <p>{t("reportLoadError")}</p>
          <button type="button" className="button button-secondary button-small" onClick={() => void load(status)}>
            {common("retry")}
          </button>
        </div>
      ) : reports.length === 0 ? (
        <p className="panel-lead">{t("noReports")}</p>
      ) : (
        <>
          <table className="data-table footprints-report-table">
            <thead>
              <tr>
                <th>{t("reportWhen")}</th>
                <th>{t("reportReporter")}</th>
                <th>{t("reportSender")}</th>
                <th>{t("reportBadge")}</th>
                <th>{t("reportMessage")}</th>
                <th>{status === "open" ? common("actions") : t("reportOutcome")}</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id}>
                  <td>
                    {formatDate(report.createdAt, locale, true)}
                    {report.footprintCreatedAt ? (
                      <small className="footprints-report-sub">
                        {t("reportFootprintSent", { when: formatDate(report.footprintCreatedAt, locale, true) })}
                      </small>
                    ) : null}
                  </td>
                  <td>{memberCell(report, "reporter")}</td>
                  <td>
                    {memberCell(report, "sender")}
                    {report.senderReportCount !== null ? (
                      <small className="footprints-report-sub">
                        {t("reportSenderCount", { count: report.senderReportCount })}
                      </small>
                    ) : null}
                  </td>
                  <td>
                    <span className="footprints-report-badge">
                      {report.badgeImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={report.badgeImage} alt="" />
                      ) : (
                        <span className="footprints-report-badge-blank" aria-hidden="true" />
                      )}
                      {report.badgeLabel || "—"}
                    </span>
                  </td>
                  <td className="footprints-report-detail">
                    <p className="footprints-report-message">{report.message || t("reportNoMessage")}</p>
                    {report.reason ? (
                      <small className="footprints-report-sub">
                        {t("reportReason")}: {t(`reportReasons.${report.reason}`)}
                      </small>
                    ) : null}
                    {report.note ? (
                      <small className="footprints-report-sub">{t("reportNote")}: {report.note}</small>
                    ) : null}
                    {footprintStateKeys(report).length > 0 ? (
                      <span className="footprints-report-state">
                        {footprintStateKeys(report).map((key) => (
                          <span className="status-badge" key={key}>{t(`reportState.${key}`)}</span>
                        ))}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {report.status === "open" ? (
                      canWrite ? (
                        <span className="footprints-report-actions">
                          <button
                            type="button"
                            className="button button-secondary button-small"
                            disabled={busy}
                            onClick={() => openAction(report, "dismiss")}
                          >
                            {t("reportDismiss")}
                          </button>
                          {canRemoveFootprintMessage(report) ? (
                            <button
                              type="button"
                              className="button button-danger button-small"
                              disabled={busy}
                              onClick={() => openAction(report, "remove_message")}
                            >
                              {t("reportRemoveMessage")}
                            </button>
                          ) : null}
                        </span>
                      ) : (
                        <span>—</span>
                      )
                    ) : (
                      <span className="footprints-report-outcome">
                        <span className={`status-badge${report.resolution === "message_removed" ? " status-denied" : ""}`}>
                          {report.resolution ? t(`reportResolution.${report.resolution}`) : t("reportStatus.resolved")}
                        </span>
                        {report.resolvedBy ? <small className="footprints-report-sub">{report.resolvedBy}</small> : null}
                        {report.resolvedAt ? (
                          <small className="footprints-report-sub">{formatDate(report.resolvedAt, locale, true)}</small>
                        ) : null}
                        {report.resolutionNote ? (
                          <small className="footprints-report-sub">
                            {t("reportModeratorNote")}: {report.resolutionNote}
                          </small>
                        ) : null}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor ? (
            <div className="footprints-report-more">
              <button
                type="button"
                className="button button-secondary"
                disabled={moreLoading}
                onClick={() => void loadMore()}
              >
                {moreLoading ? common("loading") : t("reportLoadMore")}
              </button>
              {moreFailed ? <p className="alert alert-error" role="alert">{t("reportLoadMoreError")}</p> : null}
            </div>
          ) : null}
        </>
      )}

      {pending ? (
        <ConfirmDialog
          title={t(pending.action === "remove_message" ? "reportRemoveTitle" : "reportDismissTitle")}
          copy={t(pending.action === "remove_message" ? "reportRemoveBody" : "reportDismissBody")}
          confirmLabel={t(pending.action === "remove_message" ? "reportRemoveMessage" : "reportDismiss")}
          tone={pending.action === "remove_message" ? "danger" : "primary"}
          busy={busy}
          confirmDisabled={noteTooLong}
          error={noteTooLong ? t("reportNoteTooLong", { max: FOOTPRINT_RESOLUTION_NOTE_MAX }) : ""}
          onCancel={cancelAction}
          onConfirm={() => void confirmAction()}
        >
          {pending.action === "remove_message" ? (
            <blockquote className="footprints-report-quote">{pending.report.message}</blockquote>
          ) : null}
          <label className="field footprints-report-note">
            <span>{t("reportNoteLabel")}</span>
            <textarea
              rows={3}
              value={note}
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
            />
            <small>{t("reportNoteHint", { count: noteLength, max: FOOTPRINT_RESOLUTION_NOTE_MAX })}</small>
          </label>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
