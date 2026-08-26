"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { formatDate } from "@/lib/format";
import {
  PROFILE_VERIFICATION_STATUSES,
  profileVerificationQueue,
  profileVerificationResponseData,
  type ProfileVerificationQueueItem,
} from "@/lib/profileVerification";

const PAGE_SIZE = 50;
const OPEN_STATUSES = ["pending", "pending_re_review", "awaiting_avatar"];

function statusesForFilter(filter: string): string[] {
  if (filter === "review_queue") return OPEN_STATUSES;
  if (filter === "all") return [...PROFILE_VERIFICATION_STATUSES];
  return PROFILE_VERIFICATION_STATUSES.includes(filter as never) ? [filter] : OPEN_STATUSES;
}

export default function ProfileVerificationQueuePage() {
  const t = useTranslations("profileVerification.queue");
  const common = useTranslations("common");
  const locale = useLocale();
  const [filter, setFilter] = useState("review_queue");
  const [rows, setRows] = useState<ProfileVerificationQueueItem[]>([]);
  const [cursor, setCursor] = useState<{ millis: number; uid: number } | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (append = false) => {
    if (append) setBusy(true); else setState("loading");
    const response = await adminCall("profile_verification_queue", {
      statuses: statusesForFilter(filter),
      limit: PAGE_SIZE,
      before_millis: append ? cursor?.millis ?? null : null,
      before_uid: append ? cursor?.uid ?? null : null,
    });
    const parsed = response?.success
      ? profileVerificationQueue(profileVerificationResponseData(response))
      : null;
    setBusy(false);
    if (!parsed) {
      setState("error");
      return;
    }
    setRows((current) => append ? [...current, ...parsed.items] : parsed.items);
    setCursor(parsed.next_before_millis !== null && parsed.next_before_uid !== null
      ? { millis: parsed.next_before_millis, uid: parsed.next_before_uid }
      : null);
    setHasMore(parsed.has_more);
    setState("ready");
  }, [cursor, filter]);

  useEffect(() => { void load(false); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === "loading") return <LoadingPanel />;
  if (state === "error") return <ErrorPanel message={t("loadError")} retry={() => void load(false)} />;

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={<div className="row-actions"><Link className="button button-secondary" href="/configuration#profile-verification">{t("configuration")}</Link><button className="button button-secondary" onClick={() => void load(false)} disabled={busy}>{common("refresh")}</button></div>}
      />

      <section className="panel verification-queue-filter">
        <div className="panel-body">
          <label className="field">
            <span>{common("status")}</span>
            <select value={filter} disabled={busy} onChange={(event) => { setRows([]); setCursor(null); setFilter(event.target.value); }}>
              <option value="review_queue">{t("filters.reviewQueue")}</option>
              <option value="all">{common("all")}</option>
              {PROFILE_VERIFICATION_STATUSES.map((status) => <option key={status} value={status}>{t(`statuses.${status}`)}</option>)}
            </select>
          </label>
          <div className="verification-queue-summary"><strong>{rows.length}</strong><span>{t("loadedCases")}</span></div>
        </div>
      </section>

      <section className="panel verification-queue-panel">
        <div className="panel-header"><div><h2>{t("cases")}</h2><p>{t("casesCopy")}</p></div></div>
        {rows.length === 0 ? (
          <div className="empty-state"><h3>{t("emptyTitle")}</h3><p>{t("emptyCopy")}</p></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table verification-queue-table">
              <thead><tr><th>{t("member")}</th><th>{common("status")}</th><th>{t("trigger")}</th><th>{t("submitted")}</th><th>{t("avatar")}</th><th>{t("assignee")}</th><th>{common("actions")}</th></tr></thead>
              <tbody>{rows.map((row) => {
                const slug = row.case_id || `uid-${row.uid}`;
                return (
                  <tr key={`${row.uid}-${row.case_id || row.status}-${row.updated_at || 0}`}>
                    <td data-label={t("member")}><div className="cell-stack"><strong>{row.display_name || t("unnamed")}</strong><small>UID {row.uid} · {row.gender || "—"}{row.birthday ? ` · ${formatDate(row.birthday, locale)}` : ""}</small></div></td>
                    <td data-label={common("status")}><span className={`badge verification-status-badge status-${row.status}`}>{t(`statuses.${row.status}`)}</span></td>
                    <td data-label={t("trigger")}>{row.trigger ? t.has(`triggers.${row.trigger}`) ? t(`triggers.${row.trigger}`) : row.trigger : "—"}</td>
                    <td data-label={t("submitted")}>{row.submitted_at ? formatDate(row.submitted_at, locale, true) : "—"}</td>
                    <td data-label={t("avatar")}><span className={`badge ${row.avatar_available ? "badge-active" : "badge-warning"}`}>{row.avatar_available ? t("avatarReady") : t("avatarMissing")}</span></td>
                    <td data-label={t("assignee")}>{row.lease_owner ? <div className="cell-stack"><span>{row.lease_owner}</span><small>{row.lease_expires_at ? formatDate(row.lease_expires_at, locale, true) : "—"}</small></div> : t("unassigned")}</td>
                    <td data-label={common("actions")}><Link className="button button-secondary button-small" href={`/profile-verification/${encodeURIComponent(slug)}?uid=${row.uid}`}>{common("view")}</Link></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
        {hasMore && <div className="panel-footer verification-load-more"><button className="button button-secondary" disabled={busy || !cursor} onClick={() => void load(true)}>{busy ? common("loading") : t("loadMore")}</button></div>}
      </section>
    </>
  );
}
