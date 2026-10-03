"use client";

import React, { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  DATES_INTAKE_MAX_MEMBER_NOTE_GRAPHEMES, DATES_INTAKE_MEMBER_EDITABLE_FIELDS, DATES_INTAKE_STRIKE_REASONS,
  type DatesIntakeAskState, type DatesIntakeDetail, type DatesIntakeMember, type DatesIntakeMemberField,
} from "@/lib/datesIntakeAdmin";
import { formatDate } from "@/lib/format";

/** A corrected value as text. It is the member's own input: shown as plain text, never as markup or a link. */
function CorrectedValue({ value }: { value: string | number | boolean | null }) {
  const t = useTranslations("datesAdmin.intake.member");
  if (value === null || value === "") return <em>{t("empty")}</em>;
  if (typeof value === "boolean") return <>{t(value ? "yes" : "no")}</>;
  return <span className="preserve-whitespace">{String(value)}</span>;
}

/**
 * A second look is open when Core marks the intake so (`second_look`, the mark
 * the queue shows), or - from a Core that does not serve the mark - while the
 * member has asked for it and no second decision is on record. Either says it:
 * the warning before a rejection must not depend on which one was readable.
 */
export function datesIntakeSecondLookOpen(intake: Pick<DatesIntakeDetail, "status" | "member" | "second_look">): boolean {
  const look = intake.member?.re_review ?? null;
  return intake.second_look || (intake.status === "in_review" && look !== null && look.decided_at === null);
}

/**
 * The member's side of a suggestion, exactly as Core serves it to a reviewer:
 * who suggested it (a member number, nothing more), what they chose, where
 * their look at the draft stands, what they changed, a second look and their
 * standing. No other member data is read or linked. A part this console could
 * not read is said to be unreadable - never shown as "none".
 */
export default function DatesIntakeMemberPanel({ intake }: { intake: DatesIntakeDetail }) {
  const t = useTranslations("datesAdmin.intake.member");
  const fields = useTranslations("datesAdmin.intake.memberFieldValues");
  const states = useTranslations("datesAdmin.intake.memberConfirmationValues");
  const decisions = useTranslations("datesAdmin.intake");
  const locale = useLocale();
  // Nothing of a member: an operator's draft. A block that was served but could not be trusted is said to be unreadable.
  if (intake.member === null && intake.channel !== "member_suggestion" && !intake.unreadable_sections.includes("member")) return null;
  const member = intake.member;
  if (member === null) return <section className="panel dates-external-fields" aria-label={t("title")}>
    <h2>{t("title")}</h2><p className="alert alert-error" role="status">{t("unreadable")}</p>
  </section>;
  const unreadable = (part: string) => member.unreadable.includes(part);
  const fieldName = (field: string) => fields.has(field) ? fields(field) : field;
  const confirmation = member.confirmation, look = member.re_review, standing = member.standing;
  return <section className="panel dates-external-fields" aria-label={t("title")}>
    <h2>{t("title")}</h2>
    <p className="field-hint">{t("copy")}</p>
    <dl className="dates-external-facts">
      <dt>{t("submitter")}</dt><dd>{member.submitter_uid === null ? t("erased") : t("submitterValue", { uid: member.submitter_uid })}</dd>
      <dt>{t("credit")}</dt><dd>{member.submitter_uid === null ? t("creditErased") : t(member.anonymous ? "anonymous" : "named")}</dd>
      <dt>{t("going")}</dt><dd>{t(member.auto_going ? "goingYes" : "goingNo")}</dd>
      <dt>{t("consent")}</dt><dd>{member.consent_version === null ? t("consentNone") : t("consentVersion", { version: member.consent_version })}</dd>
      <dt>{t("confirmation")}</dt><dd>{unreadable("confirmation") ? <span className="alert alert-error" role="status">{t("partUnreadable")}</span>
        : confirmation === null ? t("confirmationNone") : <>
          <span className="badge">{states.has(confirmation.state) ? states(confirmation.state) : confirmation.state}</span>
          {confirmation.at !== null && <> · {formatDate(confirmation.at, locale, true)}</>}
          {confirmation.due_at !== null && <> · {t("due", { time: formatDate(confirmation.due_at, locale, true) })}</>}
          {confirmation.asked_by_reviewer && <div>{t("askedByReviewer")}{confirmation.fields.length > 0 ? `: ${confirmation.fields.map(fieldName).join(", ")}` : ""}</div>}
          {confirmation.note !== null && <blockquote className="preserve-whitespace">{confirmation.note}</blockquote>}
        </>}</dd>
      <dt>{t("standing")}</dt><dd>{unreadable("standing") ? <span className="alert alert-error" role="status">{t("partUnreadable")}</span>
        : standing === null ? t("standingNone") : <>
          {t("strikes", { strikes: standing.strikes, limit: standing.strike_limit })}
          {" · "}{standing.banned_until === null ? t("notBanned") : <strong>{t("banned", { time: formatDate(standing.banned_until, locale, true) })}</strong>}
          <div><small>{t("strikesHint")}</small></div>
        </>}</dd>
    </dl>

    <h3>{t("corrections")}</h3>
    {unreadable("corrections") ? <p className="alert alert-error" role="status">{t("partUnreadable")}</p>
      : member.corrections.items.length === 0 && member.corrections.unreadable.length === 0 ? <p>{t("correctionsNone")}</p> : <>
        {member.corrections.unreadable.length > 0 && <p className="alert alert-error" role="status">{t("correctionsUnreadable", { count: member.corrections.unreadable.length })}</p>}
        {member.corrections.items.length > 0 && <div className="table-scroll"><table className="data-table">
          <thead><tr><th>{t("columns.event")}</th><th>{t("columns.field")}</th><th>{t("columns.from")}</th><th>{t("columns.to")}</th></tr></thead>
          <tbody>{member.corrections.items.map((row, index) => <tr key={index}>
            <td>{row.index + 1}</td><td>{fieldName(row.field)}</td><td><CorrectedValue value={row.from} /></td><td><CorrectedValue value={row.to} /></td>
          </tr>)}</tbody>
        </table></div>}
        <p className="field-hint">{t("correctionsHint")}</p>
      </>}

    <h3>{t("secondLook")}</h3>
    {unreadable("re_review") ? <p className="alert alert-error" role="status">{t("partUnreadable")}</p>
      : look === null ? <p>{t("secondLookNone")}</p> : <dl className="dates-external-facts">
        <dt>{t("secondLookAsked")}</dt><dd>{look.requested_at === null ? "—" : formatDate(look.requested_at, locale, true)}</dd>
        <dt>{t("secondLookNote")}</dt><dd>{look.note === null ? t("secondLookNoNote") : <blockquote className="preserve-whitespace">{look.note}</blockquote>}</dd>
        <dt>{t("firstDecision")}</dt><dd>{look.first_decision === null ? "—" : <>
          {decisions(`decisionValues.${look.first_decision.action}`)}
          {look.first_decision.reason_code && <> · {decisions(`rejectReasons.${look.first_decision.reason_code}`)}</>}
          {" · "}{look.first_decision.by === "system" ? decisions("detail.bySystem") : look.first_decision.by === "member" ? decisions("detail.byMember") : look.first_decision.by}
          {look.first_decision.at !== null && <> · {formatDate(look.first_decision.at, locale, true)}</>}</>}</dd>
        <dt>{t("secondDecision")}</dt><dd>{look.decided_at === null ? t("secondLookWaiting") : formatDate(look.decided_at, locale, true)}</dd>
      </dl>}
  </section>;
}

/**
 * A second look whose first decision was a rejection for a strike reason. Core counts a strike per suggestion from
 * its current decision: the second decision keeps that one strike when it rejects for a strike reason again (and adds
 * none), and takes it back - which can end a ban it caused - when it rejects for another reason or publishes.
 */
export function datesIntakeSecondLookStrike(intake: Pick<DatesIntakeDetail, "status" | "member" | "second_look">): boolean {
  const first = intake.member?.re_review?.first_decision ?? null;
  return datesIntakeSecondLookOpen(intake) && first !== null && first.action === "rejected" && first.reason_code !== null
    && DATES_INTAKE_STRIKE_REASONS.includes(first.reason_code);
}

/** What a rejection means for the member who suggested the event - said before the reviewer confirms it. */
export function DatesIntakeMemberRejectNotes({ intake, reasonCode, namesEvent }: { intake: DatesIntakeDetail; reasonCode: string; namesEvent: boolean }) {
  const t = useTranslations("datesAdmin.intake.reject");
  if (intake.channel !== "member_suggestion") return null;
  const member = intake.member, standing = member?.standing ?? null;
  // Only the reason `duplicate` can name an event, and it is not a strike reason.
  const strike = DATES_INTAKE_STRIKE_REASONS.includes(reasonCode), counted = datesIntakeSecondLookStrike(intake);
  return <>
    <p className="field-hint">{t(namesEvent ? "memberDuplicate" : "memberStatement")}</p>
    {strike && !counted && <p className="alert alert-warning" role="status">{member === null || member.unreadable.includes("standing") ? t("strikeUnknown")
      : standing === null ? t("strikeNobody") : t("strike", { strikes: standing.strikes, limit: standing.strike_limit })}</p>}
    {/* A second look after a strike: the same reason adds no new strike; another reason takes the first one back. */}
    {strike && counted && <p className="alert alert-warning" role="status">{t("secondLookStrikeKept")}</p>}
    {!strike && counted && <p className="alert alert-info" role="status">{t("secondLookStrikeTakenBack")}</p>}
    {datesIntakeSecondLookOpen(intake) && <p className="alert alert-warning" role="status">{t("secondLook")}</p>}
  </>;
}

/**
 * What publishing does for the member who suggested the event - said before the reviewer confirms it.
 * `secondLookStrike`: a second look whose first decision counted a strike (`datesIntakeSecondLookStrike`).
 */
export function DatesIntakeMemberPublishNotes({ member, events, secondLookStrike = false }: { member: DatesIntakeMember | null; events: number; secondLookStrike?: boolean }) {
  const t = useTranslations("datesAdmin.intake.editor");
  if (member === null) return <p className="alert alert-warning" role="status">{t("memberUnreadable")}</p>;
  if (member.submitter_uid === null) return <p>{t("memberErased")}</p>;
  return <>
    <p>{member.anonymous ? t("memberAnonymous") : t("memberCredit", { uid: member.submitter_uid })}</p>
    {member.auto_going && <p>{t(events === 1 ? "memberGoing" : "memberGoingProgramme")}</p>}
    {secondLookStrike && <p className="alert alert-info" role="status">{t("memberSecondLookStrikeTakenBack")}</p>}
  </>;
}

export type DatesIntakeAskDraft = { fields: DatesIntakeMemberField[]; note: string; reason: string };

/**
 * "Ask the member": the reviewer sends the draft back once, naming the fields
 * to look at, with an optional note the member reads and a reason only the
 * audit log keeps. The form proposes; the page confirms and sends.
 */
export function DatesIntakeAskSection({ state, busy, retry, onChanged, onReview, onRetry }: {
  state: DatesIntakeAskState;
  busy: boolean;
  /** An earlier request has no known outcome: the same request can be sent again. */
  retry: boolean;
  onChanged: () => void;
  onReview: (draft: DatesIntakeAskDraft) => void;
  onRetry: () => void;
}) {
  const t = useTranslations("datesAdmin.intake.ask");
  const names = useTranslations("datesAdmin.intake.memberFieldValues");
  const [fields, setFields] = useState<DatesIntakeMemberField[]>([]);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  if (!state.offered) return null;
  const allowed = state.allowed;
  const toggle = (field: DatesIntakeMemberField, on: boolean) => {
    onChanged();
    // Kept in the order of the form, whatever the order of the clicks.
    setFields((current) => DATES_INTAKE_MEMBER_EDITABLE_FIELDS.filter((item) => item === field ? on : current.includes(item)));
  };
  return <section className="panel dates-external-fields" aria-label={t("title")}>
    <h2>{t("title")}</h2>
    <p>{t("copy")}</p>
    {!state.allowed && <p className={state.why === "unreadable" ? "alert alert-error" : "field-hint"} role="status">{t(`why.${state.why}`)}</p>}
    <form onSubmit={(submit) => { submit.preventDefault(); if (allowed && !busy && fields.length > 0 && reason.trim() !== "") onReview({ fields, note, reason }); }}>
      <fieldset className="dates-external-fields" disabled={!allowed || busy}>
        <div className="dates-checkbox-stack" role="group" aria-label={t("fields")}>
          <span>{t("fields")}</span>
          {DATES_INTAKE_MEMBER_EDITABLE_FIELDS.map((field) => <label className="checkbox-field" key={field}>
            <input type="checkbox" checked={fields.includes(field)} onChange={(change) => toggle(field, change.target.checked)} /><span>{names(field)}</span></label>)}
        </div>
        <label className="field"><span>{t("note")}</span><textarea rows={3} maxLength={DATES_INTAKE_MAX_MEMBER_NOTE_GRAPHEMES * 4} value={note}
          onChange={(change) => { onChanged(); setNote(change.target.value); }} /><small>{t("noteHint", { maximum: DATES_INTAKE_MAX_MEMBER_NOTE_GRAPHEMES })}</small></label>
        <label className="field"><span>{t("reason")}</span><textarea required rows={2} maxLength={1000} value={reason}
          onChange={(change) => { onChanged(); setReason(change.target.value); }} /><small>{t("reasonHint")}</small></label>
        <div className="row-actions"><button type="submit" className="button button-primary" disabled={fields.length === 0}>{t("review")}</button>
          {retry && <button type="button" className="button button-secondary" onClick={onRetry}>{t("retry")}</button>}</div>
      </fieldset>
    </form>
  </section>;
}
