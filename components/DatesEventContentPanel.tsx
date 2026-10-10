"use client";

// The default import keeps the component renderable where JSX compiles to React.createElement (the test runner).
import React, { useEffect, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { adminCall } from "@/lib/adminClient";
import { adminMembershipFailureText } from "@/lib/adminMembershipFailureText";
import { createAdminIdempotencyKey, hasDatesCapability, type DatesAdminPrincipal } from "@/lib/datesAdmin";
import { EVENT_CONTENT_KINDS, eventContentReviewOutcome, type EventContentHostRemoved, type EventContentProblem, type EventContentRow } from "@/lib/datesEventContent";
import {
  EVENT_REVIEW_REASON_MAX, EVENT_REVIEW_REASON_MIN, eventContentAccessValid, eventContentHeld, eventContentPanelInitial, eventContentPanelReducer,
  eventContentReadBody, eventReviewReasonValid, eventReviewRequest, eventReviewTargetOf,
  type EventContentAccess, type EventContentPanelState, type EventReviewNotice as EventReviewNoticeState, type EventReviewTarget,
} from "@/lib/datesEventContentPanel";
import { formatDate } from "@/lib/format";

type Translate = ReturnType<typeof useTranslations>;
const caseHref = (caseId: string) => `/dates/moderation/${caseId}`;

/**
 * "Content & signals" of an event page: what members wrote at the event - wall
 * posts, comments, event chat, reviews - and what they hid for themselves,
 * reported or not, with the way into a moderation case for any of it.
 *
 * It is its own audited authority (the evidence capability; neither the
 * activity's metadata nor a support role grants the read), and it starts
 * closed: a read shows members' content and Core records it, so nothing is
 * read because a page was opened - only "Show content and signals" asks for
 * the list. What it does from there - reads, pages, the selection, a request
 * in doubt - is lib/datesEventContentPanel.ts; this file renders that state
 * and sends what it asks for.
 */
export default function DatesEventContentPanel({ activityId, principal, deleted, onOpenCase, initialState }: {
  activityId: string; principal: DatesAdminPrincipal;
  /** A deleted event is not moderated as a whole. */
  deleted: boolean;
  /** A request opened, or found, this case: the page goes to it. */
  onOpenCase: (caseId: string) => void;
  /** Only a server render (a test, a preview) gives this; the page starts closed and reads when it is asked to. */
  initialState?: EventContentPanelState;
}) {
  const t = useTranslations("datesAdmin.eventContent"), common = useTranslations("common");
  const [state, dispatch] = useReducer(eventContentPanelReducer, initialState ?? eventContentPanelInitial(activityId));
  const canRead = hasDatesCapability(principal, "dates_evidence_read");
  const canReview = canRead && hasDatesCapability(principal, "dates_case_claim");
  const held = eventContentHeld(state), sending = state.command.status === "sending";
  const mounted = useRef(false);
  // One request at a time, also between two submits the same render answered.
  const inFlight = useRef(false);
  const reasonField = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // One read per ticket: the reducer raises the ticket with every read it asks for and drops the answer to an older one,
  // so the read that is abandoned here needs no state of its own to be put back.
  const { ticket } = state;
  useEffect(() => {
    if (state.read.status !== "loading") return;
    const controller = new AbortController();
    void adminCall("dates_event_content", eventContentReadBody(state), controller.signal).then((response) => {
      if (!controller.signal.aborted) dispatch({ type: "readAnswered", ticket, response });
    });
    return () => controller.abort();
  }, [ticket]); // eslint-disable-line react-hooks/exhaustive-deps

  // The form opens where the operator is looking, and the reason is the next thing to type: focus brings it into view.
  const targetId = state.target?.id ?? null;
  useEffect(() => { if (targetId !== null) reasonField.current?.focus(); }, [targetId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    // A request in doubt is the very object that was sent; only a new one takes the new key.
    const request = eventReviewRequest(state, createAdminIdempotencyKey("content"));
    if (!request || !canReview || inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: "reviewStarted", request });
    const response = await adminCall("dates_event_content_review", request);
    inFlight.current = false;
    if (!mounted.current) return;
    dispatch({ type: "reviewAnswered", request, response });
    const outcome = eventContentReviewOutcome(response, request);
    if (outcome.kind === "opened") onOpenCase(outcome.case_id);
  }

  if (!canRead) return null;
  const { page, read, shown, target } = state;
  const loading = read.status === "loading";
  const anchored = target !== null && target.kind !== "activity" && (page?.items.some((row) => row.id === target.id) ?? false);
  const form = target === null ? null : <EventReviewForm state={state} reasonField={reasonField} onSubmit={(event) => void submit(event)}
    onReason={(value) => dispatch({ type: "reasonTyped", value })} onDrop={() => dispatch({ type: "targetDropped" })} />;
  const choose = (row: EventContentRow) => dispatch({ type: "targetChosen", target: eventReviewTargetOf(row) });

  return <section className="panel dates-event-content">
    <div className="panel-header"><div><h2>{t("title")}</h2><p>{t("subtitle")}</p></div>
      <div className="row-actions">
        <Link className="button button-secondary" href="/dates/moderation">{t("queue")}</Link>
        {canReview && !deleted && <button type="button" className="button button-secondary" disabled={held}
          onClick={() => dispatch({ type: "targetChosen", target: { kind: "activity", id: activityId } })}>{t("reviewEvent")}</button>}
      </div>
    </div>
    <div className="panel-body">
      {/* The event as a whole has no row, and a row that is not listed (its list is being read again) has no card: the form is here. */}
      {!anchored && form}
      {target === null && state.notice !== null && <EventReviewNotice notice={state.notice} />}
      {shown && <div className="row-actions dates-event-content-tabs" role="group" aria-label={t("kindsLabel")}>
        {EVENT_CONTENT_KINDS.map((kind) => <button key={kind} type="button" className={`button ${kind === state.kind ? "button-primary" : "button-secondary"}`}
          aria-pressed={kind === state.kind} disabled={held} onClick={() => dispatch({ type: "listChosen", kind, postId: "" })}>{t(`kinds.${kind}`)}</button>)}
      </div>}
      {shown && state.postId !== "" && <div className="row-actions"><span className="field-hint">{t("postFilter", { id: state.postId })}</span>
        <button type="button" className="button button-secondary" disabled={held} onClick={() => dispatch({ type: "listChosen", kind: "wall_comment", postId: "" })}>{t("clearFilter")}</button></div>}
      {/* Why there is no list, and - for an operator who holds it - the way through a conflict of interest. Both also before the list was asked for. */}
      {read.status === "failed" && !read.more && <EventContentProblemNotice problem={read.problem} breakGlass={principal.break_glass} />}
      {principal.break_glass && <EventContentAccessControl state={state} onApply={(access) => dispatch({ type: "accessApplied", access })} />}
      {!shown && <>
        <p className="field-hint">{t("closedCopy")}</p>
        <div className="row-actions"><button type="button" className="button button-primary" onClick={() => dispatch({ type: "shown" })}>{t("show")}</button></div>
      </>}
      {shown && <>
        <div className="row-actions">
          <button type="button" className="button button-secondary" disabled={sending} onClick={() => dispatch({ type: "refreshed" })}>{common("refresh")}</button>
          <span className="field-hint" role="status">{loading ? t("loading") : ""}</span>
        </div>
        {read.status === "ready" && page?.items.length === 0 && <p className="field-hint">{t("empty")}</p>}
        <div className="dates-event-content-list">{page?.items.map((row) => <EventContentCard key={row.id} row={row} selected={target?.id === row.id}
          canReview={canReview} locked={held} onComments={() => dispatch({ type: "listChosen", kind: "wall_comment", postId: row.id })} onReview={() => choose(row)}>
          {target?.id === row.id && form}
        </EventContentCard>)}</div>
        {read.status === "failed" && read.more && <>
          <p className="alert alert-error" role="alert">{t("problems.moreFailed")}</p>
          <EventContentProblemNotice problem={read.problem} breakGlass={principal.break_glass} />
        </>}
        {page?.has_more && <div className="row-actions"><button type="button" className="button button-secondary" disabled={loading || held}
          onClick={() => dispatch({ type: "moreAsked" })}>{t("more")}</button></div>}
      </>}
    </div>
  </section>;
}

/** One row: what it is, who wrote it and when, its text unless it was deleted, and what members signalled about it. */
function EventContentCard({ row, selected, canReview, locked, onComments, onReview, children }: {
  row: EventContentRow; selected: boolean; canReview: boolean; locked: boolean; onComments: () => void; onReview: () => void; children?: React.ReactNode;
}) {
  const t = useTranslations("datesAdmin.eventContent"), locale = useLocale();
  const author = row.author_uid === null ? t("noAuthor") : t("author", { uid: row.author_uid });
  const signals = { hides: row.hide_count, reports: row.report_count };
  return <article className={`dates-event-content-card${selected ? " dates-event-content-card-selected" : ""}`} aria-current={selected ? "true" : undefined}>
    <div className="row-actions">
      <span className={`badge ${row.state === "active" ? "badge-active" : "badge-warning"}`}>{t(`states.${row.state}`)}</span>
      <span>{t(`rowKinds.${row.root_id === null ? row.kind : "reply"}`)}</span>
      <span className="field-hint">{t("byline", { author, date: formatDate(row.created_at, locale, true) })}</span>
      {selected && <span className="badge badge-info">{t("selected")}</span>}
    </div>
    {/* A tombstone says that something was deleted, and nothing of what it was. */}
    <p className="dates-event-content-text">{row.state === "deleted" ? t("deletedCopy") : row.text || t("attachmentOnly")}</p>
    {/* Who took the row down, where Core says so; and what Core kept of it when that was the event's host. */}
    {row.removed_by != null && <p className="field-hint">{t(`removedBy.${row.removed_by}`)}</p>}
    {row.host_removed != null && <EventContentKept kept={row.host_removed} />}
    {row.content_kind !== "text" && <p className="field-hint">{t("attachment", { kind: t(`contentKinds.${row.content_kind}`) })}</p>}
    <p className="field-hint">{row.signal_at === null ? t("signals", signals) : t("signalsAt", { ...signals, date: formatDate(row.signal_at, locale, true) })}</p>
    <code>{row.id}</code>
    <div className="row-actions">
      {row.kind === "wall_post" && <button type="button" className="button button-secondary" disabled={locked} onClick={onComments}>{t("comments")}</button>}
      {row.case_id !== null && <Link className="button button-secondary" href={caseHref(row.case_id)}>{t("existingCase")}</Link>}
      {canReview && row.can_review && <button type="button" className="button button-primary" disabled={locked} onClick={onReview}>{t(row.has_media ? "reviewMedia" : "openReview")}</button>}
    </div>
    {children}
  </article>;
}

/**
 * What Core kept of another member's content when the event's host removed
 * it. It is member content like a live row's text and is printed the same
 * way: as text. A shared link is printed as its address and is not a link -
 * nothing a member wrote is followed from here. The photo or video itself is
 * gone; only that there was one is kept.
 */
function EventContentKept({ kept }: { kept: EventContentHostRemoved }) {
  const t = useTranslations("datesAdmin.eventContent"), locale = useLocale();
  const author = kept.author_uid === null ? t("noAuthor") : t("author", { uid: kept.author_uid });
  return <div className="dates-event-content-kept">
    <h4>{t("kept.title")}</h4>
    <p className="field-hint">{t("kept.byline", { author })}</p>
    <p className="dates-event-content-text">{kept.text || t("kept.noText")}</p>
    {kept.kind !== "text" && <p className="field-hint">{t("kept.kind", { kind: t(`contentKinds.${kept.kind}`) })}</p>}
    {kept.link !== null && <p className="field-hint">{t("kept.link")} <code>{kept.link.url}</code></p>}
    {kept.had_media && <p className="field-hint">{t("kept.hadMedia")}</p>}
    <p className="field-hint">{t("kept.removedAt", { date: formatDate(kept.at, locale, true) })}{" · "}
      {kept.by_uid === null ? t("kept.hostErased") : <>{t("kept.byHost")} (<Link href={`/users/${kept.by_uid}`}>{t("author", { uid: kept.by_uid })}</Link>)</>}</p>
  </div>;
}

/** What the request is for, in words: the kind of content, its author and the start of its text - or the event itself. */
function targetText(target: EventReviewTarget, t: Translate): string {
  if (target.kind === "activity") return t("reviewTargetEvent");
  const named = { kind: t(`rowKinds.${target.reply ? "reply" : target.kind}`), author: target.author_uid === null ? t("noAuthor") : t("author", { uid: target.author_uid }) };
  return target.excerpt === "" ? t("reviewTargetNoText", named) : t(target.cut ? "reviewTargetCut" : "reviewTarget", { ...named, excerpt: target.excerpt });
}

/** The request for a case: its target, the reason, and - once it was sent - what became of it. */
function EventReviewForm({ state, reasonField, onSubmit, onReason, onDrop }: {
  state: EventContentPanelState; reasonField: React.RefObject<HTMLTextAreaElement>;
  onSubmit: (event: React.FormEvent) => void; onReason: (value: string) => void; onDrop: () => void;
}) {
  const t = useTranslations("datesAdmin.eventContent"), common = useTranslations("common");
  const outcomes = useTranslations("datesAdmin.commandOutcome"), membership = useTranslations("adminMembership");
  const { command, target, notice } = state;
  if (target === null) return null;
  const held = eventContentHeld(state), sending = command.status === "sending";
  const doubt = command.status === "doubt" ? command : null;
  return <form className="dates-event-review-form" onSubmit={onSubmit}>
    <h3>{t("openReview")}</h3>
    <p className="dates-event-review-target">{targetText(target, t)}</p>
    <code>{target.id}</code>
    <p className="field-hint">{t("reviewCopy")}</p>
    <label className="field"><span>{t("reviewReason")}</span>
      <textarea ref={reasonField} value={state.reason} minLength={EVENT_REVIEW_REASON_MIN} maxLength={EVENT_REVIEW_REASON_MAX} required disabled={held}
        onChange={(event) => onReason(event.target.value)} /></label>
    {notice?.kind === "refused" && <p className="alert alert-error" role="alert">{t("refused", { error: notice.error })}</p>}
    {/* Said as it happened: an answer that settles nothing is named; no answer is "no answer"; an unconfirmed membership is that. */}
    {doubt && <>
      <p className="alert alert-warning" role="alert">{adminMembershipFailureText(doubt.error,
        doubt.error === null ? outcomes("unknown") : outcomes("unknownAnswered", { error: doubt.error }), membership("requestUnconfirmed"))}</p>
      <p className="field-hint">{t("doubtHint")}</p>
    </>}
    <div className="row-actions">
      <button className="button button-primary" disabled={sending || (!doubt && !eventReviewReasonValid(state.reason))}>{t(doubt ? "retrySame" : "openReview")}</button>
      <button type="button" className="button button-secondary" disabled={sending} onClick={onDrop}>{doubt ? t("setAside") : common("cancel")}</button>
    </div>
  </form>;
}

/** What became of a request whose form is closed: the case it opened, the case a re-read found, or its refusal. */
function EventReviewNotice({ notice }: { notice: EventReviewNoticeState }) {
  const t = useTranslations("datesAdmin.eventContent");
  if (notice.kind === "refused") return <p className="alert alert-error" role="alert">{t("refused", { error: notice.error })}</p>;
  return <div className={`alert ${notice.kind === "opened" ? "alert-success" : "alert-info"} dates-event-content-notice`} role="status">
    <span>{t(notice.kind === "opened" ? "caseOpened" : "caseExists")}</span>
    <Link className="button button-secondary" href={caseHref(notice.case_id)}>{t("openCase")}</Link>
  </div>;
}

/** Why there is no list - or no next page. Each kind in its own words; never "nothing here". */
function EventContentProblemNotice({ problem, breakGlass }: { problem: EventContentProblem; breakGlass: boolean }) {
  const t = useTranslations("datesAdmin.eventContent"), membership = useTranslations("adminMembership");
  const text = problem.kind === "conflict" ? t(breakGlass ? "problems.conflictBreakGlass" : "problems.conflict")
    : problem.kind === "forbidden" ? t("problems.forbidden", { error: problem.error })
      : problem.kind === "not-found" ? t("problems.notFound")
        : problem.kind === "unconfirmed" ? membership("requestUnconfirmed")
          : problem.kind === "refused" ? t("problems.refused", { error: problem.error })
            : problem.kind === "malformed" ? t("problems.malformed")
              : problem.error === null ? t("problems.noAnswer") : t("problems.unavailable", { error: problem.error });
  return <p className="alert alert-error" role="alert">{text}</p>;
}

/**
 * Break-glass for an operator who is party to the event: asked for with a
 * reason, applied on purpose, and from then on sent with every read of this
 * panel and every request made from it - which is said above the control for
 * as long as it is so. The control is open while a conflict is the problem.
 */
function EventContentAccessControl({ state, onApply }: { state: EventContentPanelState; onApply: (access: EventContentAccess) => void }) {
  const t = useTranslations("datesAdmin.eventContent");
  const [draft, setDraft] = useState(state.access);
  const held = eventContentHeld(state);
  const conflict = state.read.status === "failed" && state.read.problem.kind === "conflict";
  return <>
    {state.access.break_glass && <p className="alert alert-warning" role="status">{t("breakGlassOn")}</p>}
    <details className="dates-event-content-access" open={conflict || undefined}>
      <summary>{t("breakGlassTitle")}</summary>
      <label className="checkbox-field"><input type="checkbox" checked={draft.break_glass} disabled={held}
        onChange={(event) => setDraft({ ...draft, break_glass: event.target.checked })} /><span>{t("breakGlass")}</span></label>
      <label className="field"><span>{t("accessReason")}</span>
        <input value={draft.reason} maxLength={EVENT_REVIEW_REASON_MAX} disabled={held} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} /></label>
      <div className="row-actions"><button type="button" className="button button-secondary" disabled={held || !eventContentAccessValid(draft)}
        onClick={() => onApply(draft)}>{t("applyAccess")}</button></div>
    </details>
  </>;
}
