"use client";

import React, { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import { adminCall } from "@/lib/adminClient";
import type { DatesCommandOutcome, DatesExternalAdminReview } from "@/lib/datesExternalAdmin";
import { datesExternalReviewRefusalKey, datesExternalReviewRequest, runDatesExternalReview, type DatesExternalReviewTarget } from "@/lib/datesExternalReview";
import { formatDate } from "@/lib/format";

/**
 * D-149 W1: the "reviewed, OK" mark of a published external event, on a list row and on the detail. Marking is one
 * click (its reason is optional); clearing asks for a reason. Both are revision-fenced commands sent outside the
 * durable journal; after any answer the caller reads the event again (`onSettled`).
 */
export default function DatesExternalReviewMark({ target, review, canManage, compact = false, onSettled }: {
  target: DatesExternalReviewTarget; review: DatesExternalAdminReview; canManage: boolean; compact?: boolean;
  onSettled: (outcome: DatesCommandOutcome) => void | Promise<void>;
}) {
  const t = useTranslations("datesAdmin.external.review"), common = useTranslations("common"), locale = useLocale();
  const [busy, setBusy] = useState(false), [clearing, setClearing] = useState(false), [reason, setReason] = useState("");
  const [problem, setProblem] = useState<DatesCommandOutcome | null>(null);
  const busyRef = useRef(false);

  async function send(action: "mark_reviewed" | "clear_reviewed", text = "") {
    if (busyRef.current || !canManage) return;
    busyRef.current = true; setBusy(true); setProblem(null);
    try {
      const outcome = await runDatesExternalReview(adminCall, target, datesExternalReviewRequest(target, action, text));
      if (outcome.kind !== "success") setProblem(outcome);
      if (outcome.kind !== "refused" || action !== "clear_reviewed") setClearing(false);
      if (outcome.kind === "success") setReason("");
      await onSettled(outcome);
    } finally { busyRef.current = false; setBusy(false); }
  }

  // Core-B 4b58099c: published, rechecking or in_review, active and not soft-deleted (Core checks the rest).
  const markable = target.status === "published" || target.status === "rechecking" || target.status === "in_review";
  return <div className="dates-review-mark">
    {review.reviewed
      ? <span className="badge badge-active">{t("reviewed")}</span>
      : <span className="badge badge-warning">{t("notReviewed")}</span>}
    {!compact && review.by !== null && review.at !== null && <div><small>{t(review.reviewed ? "markedBy" : "clearedBy", { by: review.by, at: formatDate(review.at, locale, true) })}</small></div>}
    {compact && review.reviewed && review.by !== null && <div><small>{review.by}</small></div>}
    {canManage && <div className="row-actions">
      {!review.reviewed && markable && <button type="button" className="button button-primary button-small" disabled={busy} onClick={() => void send("mark_reviewed")}>
        {busy ? common("working") : t("mark")}</button>}
      {review.reviewed && <button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => { setProblem(null); setClearing(true); }}>{t("clear")}</button>}
    </div>}
    {problem && !clearing && <p className="alert alert-error" role="status">{problem.kind === "uncertain" ? t("uncertain") : t(`refusals.${datesExternalReviewRefusalKey(problem.kind === "refused" ? problem.error : null)}`)}</p>}
    {clearing && <ConfirmDialog title={t("clearTitle")} copy={t("clearCopy")} confirmLabel={t("clear")} tone="primary" busy={busy}
      confirmDisabled={reason.trim().length < 3}
      error={problem ? problem.kind === "uncertain" ? t("uncertain") : t(`refusals.${datesExternalReviewRefusalKey(problem.kind === "refused" ? problem.error : null)}`) : ""}
      onCancel={() => { if (!busyRef.current) { setClearing(false); setProblem(null); } }} onConfirm={() => void send("clear_reviewed", reason)}>
      <label className="field"><span>{t("clearReason")}</span><textarea required minLength={3} maxLength={1000} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
    </ConfirmDialog>}
  </div>;
}
