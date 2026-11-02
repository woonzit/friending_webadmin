"use client";

import Link from "next/link";
import React, { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import { adminCall } from "@/lib/adminClient";
import {
  DATES_EXTERNAL_CORRECTION_NOTE_MAX, DATES_EXTERNAL_CORRECTION_REJECT_REASONS, DATES_EXTERNAL_CORRECTION_FIELDS, type DatesCommandOutcome, type DatesExternalCorrection,
  type DatesExternalCorrectionFacts, type DatesExternalCorrectionField,
} from "@/lib/datesExternalAdmin";
import { datesExternalCorrectionRejectRequest, datesExternalReviewRefusalKey, runDatesExternalCorrectionReject } from "@/lib/datesExternalReview";
import { formatDate } from "@/lib/format";

/** The value of one fact of a correction, as the member wrote it or as the event had it. */
function FactValue({ facts, field }: { facts: DatesExternalCorrectionFacts | null; field: DatesExternalCorrectionField }) {
  const t = useTranslations("datesAdmin.corrections");
  // `current` is null when the event was purged: there is nothing to compare with.
  if (facts === null) return <span className="field-hint">{t("eventGone")}</span>;
  if (!Object.hasOwn(facts, field)) return <span className="field-hint">{t("unchanged")}</span>;
  const value = facts[field];
  if (value === null || value === undefined) return <span>{t(field === "ends_local" ? "noEnd" : "noValue")}</span>;
  if (field === "status") return <span>{value === "canceled" || value === "postponed" || value === "scheduled" ? t(`statusValues.${value}`) : value}</span>;
  if (field === "official_url") return <a href={value} target="_blank" rel="noopener noreferrer nofollow">{value}</a>;
  return <span className="preserve-whitespace">{value}</span>;
}

/**
 * D-149 W4: one member correction - the event, the current and the proposed values side by side, the note, the member
 * and the time. The facts a member did not touch are not listed. Member text is shown as text, never as markup.
 */
export function DatesExternalCorrectionView({ correction, showEvent = true }: { correction: DatesExternalCorrection; showEvent?: boolean }) {
  const t = useTranslations("datesAdmin.corrections"), external = useTranslations("datesAdmin.external"), locale = useLocale();
  const fields = DATES_EXTERNAL_CORRECTION_FIELDS.filter((field) => Object.hasOwn(correction.proposed, field));
  const eventStatus = correction.event_status ?? null;
  return <div className="dates-correction">
    {showEvent && <p>{correction.event_title === null ? <span>{t("eventGone")}</span>
      : <Link href={`/dates/external/${correction.external_event_id}`}>{correction.event_title}</Link>}
      {eventStatus !== null && eventStatus !== "published" && <> <span className="badge badge-warning">{external(`statusValues.${eventStatus}`)}</span></>}</p>}
    <p><small>{t("submitted", { at: formatDate(correction.created_at, locale, true) })} · <Link href={`/users/${correction.submitter.uid}`}>
      {correction.submitter.display_name || t("member", { uid: correction.submitter.uid })}</Link> · {t("revisionAtSubmit", { revision: correction.event_revision_at_submit })}</small></p>
    {fields.length > 0 && <div className="table-wrap"><table className="data-table dates-embedded-table">
      <thead><tr><th>{t("columns.field")}</th><th>{t("columns.current")}</th><th>{t("columns.proposed")}</th></tr></thead>
      <tbody>{fields.map((field) => <tr key={field}><td>{t(`fields.${field}`)}</td>
        <td><FactValue facts={correction.current} field={field} /></td><td><strong><FactValue facts={correction.proposed} field={field} /></strong></td></tr>)}</tbody>
    </table></div>}
    {correction.note !== null && <div><strong>{t("note")}</strong><p className="preserve-whitespace">{correction.note}</p></div>}
    {correction.status !== "pending" && <p><small>{t(`decided.${correction.status}`, { by: correction.decided_by ?? "—", at: correction.decided_at === null ? "—" : formatDate(correction.decided_at, locale, true) })}
      {correction.decision_reason !== null && <> · {(DATES_EXTERNAL_CORRECTION_REJECT_REASONS as readonly string[]).includes(correction.decision_reason)
        ? t(`rejectReasons.${correction.decision_reason}`) : <code>{correction.decision_reason}</code>}</>}</small></p>}
    {(correction.decision_note ?? null) !== null && <p className="preserve-whitespace"><small>{t("decisionNote", { note: correction.decision_note ?? "" })}</small></p>}
  </div>;
}

/**
 * "Reject" with a reason code and an optional note. The decision is fenced by the correction's state, so it is sent
 * under a new key each time; after any answer the caller reads the queue again (`onSettled`).
 */
export function DatesExternalCorrectionReject({ correction, onCancel, onSettled }: {
  correction: DatesExternalCorrection; onCancel: () => void; onSettled: (outcome: DatesCommandOutcome) => void | Promise<void>;
}) {
  const t = useTranslations("datesAdmin.corrections"), review = useTranslations("datesAdmin.external.review");
  const [reason, setReason] = useState(""), [note, setNote] = useState(""), [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  // Core requires a note with `other`, and counts at most 500 graphemes.
  const noteLength = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(note.trim())].length;
  const ready = reason !== "" && noteLength <= DATES_EXTERNAL_CORRECTION_NOTE_MAX && (reason !== "other" || noteLength > 0);
  async function confirm() {
    if (busyRef.current || !ready) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const outcome = await runDatesExternalCorrectionReject(adminCall, datesExternalCorrectionRejectRequest(correction.correction_id, reason, note));
      if (outcome.kind === "uncertain") setError(t("uncertain"));
      else if (outcome.kind === "refused") setError(review(`refusals.${datesExternalReviewRefusalKey(outcome.error)}`));
      await onSettled(outcome);
    } finally { busyRef.current = false; setBusy(false); }
  }
  return <ConfirmDialog title={t("rejectTitle")} copy={t("rejectCopy")} confirmLabel={t("reject")} tone="danger" busy={busy} confirmDisabled={!ready}
    error={error} onCancel={() => { if (!busyRef.current) onCancel(); }} onConfirm={() => void confirm()}>
    <label className="field"><span>{t("rejectReason")}</span><select required value={reason} onChange={(event) => setReason(event.target.value)}>
      <option value="">{t("chooseReason")}</option>
      {DATES_EXTERNAL_CORRECTION_REJECT_REASONS.map((code) => <option key={code} value={code}>{t(`rejectReasons.${code}`)}</option>)}</select></label>
    <label className="field"><span>{t(reason === "other" ? "rejectNoteRequired" : "rejectNote")}</span>
      <textarea rows={3} maxLength={DATES_EXTERNAL_CORRECTION_NOTE_MAX * 4} required={reason === "other"} value={note} onChange={(event) => setNote(event.target.value)} />
      <small className={noteLength > DATES_EXTERNAL_CORRECTION_NOTE_MAX ? "forced-copy-counter is-over" : "forced-copy-counter"}>{t("noteCounter", { count: noteLength, max: DATES_EXTERNAL_CORRECTION_NOTE_MAX })}</small>
      <small>{t("rejectNoteHint")}</small></label>
  </ConfirmDialog>;
}
