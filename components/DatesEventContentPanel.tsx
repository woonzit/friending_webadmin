"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { adminCall } from "@/lib/adminClient";
import { createAdminIdempotencyKey, hasDatesCapability, type DatesAdminPrincipal } from "@/lib/datesAdmin";
import { datesCommandOutcome } from "@/lib/datesExternalAdmin";
import { EVENT_CONTENT_KINDS, eventContentPage, eventContentReviewReceipt, type EventContentKind,
  type EventContentPage, type EventReviewKind, type EventReviewRequest } from "@/lib/datesEventContent";
import { formatDate } from "@/lib/format";

/** Separate audited UGC authority; neither activity metadata nor a support role grants this read. */
export default function DatesEventContentPanel({ activityId, principal, deleted }: {
  activityId: string; principal: DatesAdminPrincipal; deleted: boolean;
}) {
  const t = useTranslations("datesAdmin.eventContent");
  const common = useTranslations("common");
  const outcomes = useTranslations("datesAdmin.commandOutcome");
  const locale = useLocale(); const router = useRouter();
  const [kind, setKind] = useState<EventContentKind>("wall_post");
  const [postId, setPostId] = useState("");
  const [page, setPage] = useState<EventContentPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [breakGlass, setBreakGlass] = useState(false);
  const [accessReason, setAccessReason] = useState("");
  const [access, setAccess] = useState({ break_glass: false, reason: "" });
  const [selected, setSelected] = useState<{ kind: EventReviewKind; id: string } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<EventReviewRequest | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const commandGeneration = useRef(0);
  const canRead = hasDatesCapability(principal, "dates_evidence_read");
  const canReview = canRead && hasDatesCapability(principal, "dates_case_claim");

  const load = useCallback(async (cursor?: string) => {
    if (!canRead) return;
    const ticket = ++generation.current;
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    setLoading(true); setError(null);
    if (!cursor) setPage(null);
    const response = await adminCall("dates_event_content", { activity_id: activityId, kind,
      ...(postId ? { post_id: postId } : {}), ...(cursor ? { cursor } : {}), break_glass: access.break_glass,
      ...(access.break_glass ? { reason: access.reason } : {}) }, controller.signal);
    if (ticket !== generation.current || controller.signal.aborted) return;
    const parsed = eventContentPage(response, activityId, kind, postId);
    setLoading(false);
    if (!parsed) { setPage(null); setError(t("loadError")); return; }
    setPage(previous => cursor && previous ? { ...parsed, items: [...previous.items, ...parsed.items.filter(row => !previous.items.some(old => old.id === row.id))] } : parsed);
  }, [activityId, kind, postId, access, canRead, t]);

  useEffect(() => { void load(); return () => { ++generation.current; abort.current?.abort(); }; }, [load]);
  useEffect(() => () => { ++commandGeneration.current; }, []);

  function choose(next: EventContentKind, post = "") {
    if (busy || pending) return;
    ++generation.current; abort.current?.abort(); setPage(null); setError(null); setPostId(post); setKind(next);
  }
  function select(reviewKind: EventReviewKind, id: string) {
    if (busy || pending) return;
    setSelected({ kind: reviewKind, id }); setReason(""); setCommandError(null);
  }
  async function openReview(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !canReview || busy || (!pending && reason.trim().length < 3)) return;
    const request = pending ?? { activity_id: activityId, kind: selected.kind, target_id: selected.id,
      reason: reason.trim(), break_glass: access.break_glass, idempotency_key: createAdminIdempotencyKey("content") };
    const ticket = ++commandGeneration.current;
    setPending(request); setBusy(true); setCommandError(null);
    const response = await adminCall("dates_event_content_review", request);
    if (ticket !== commandGeneration.current) return;
    setBusy(false);
    const receipt = eventContentReviewReceipt(response, request);
    const outcome = datesCommandOutcome(response, receipt !== null, pending ? "kept" : "fresh");
    if (receipt) { setPending(null); router.push(`/dates/moderation/${receipt.case_id}`); return; }
    if (outcome.kind === "refused") { setPending(null); setCommandError(t("refused", { error: outcome.error })); }
    else { setCommandError(outcomes("unknown")); }
    // A failed authority check must also clear previously displayed private text.
    setPage(null);
  }

  if (!canRead) return null;
  return <section className="panel dates-event-content">
    <div className="panel-header"><div><h2>{t("title")}</h2><p>{t("subtitle")}</p></div>
      <div className="row-actions">
        <Link className="button button-secondary" href="/dates/moderation">{t("queue")}</Link>
        {canReview && !deleted && <button className="button button-secondary" disabled={busy || !!pending} onClick={() => select("activity", activityId)}>{t("reviewEvent")}</button>}
      </div>
    </div>
    <div className="panel-body">
      <div className="row-actions dates-event-content-tabs" role="group" aria-label={t("kindsLabel")}>
        {EVENT_CONTENT_KINDS.map(value => <button key={value} className={`button ${value === kind ? "button-primary" : "button-secondary"}`}
          aria-pressed={value === kind} disabled={busy || !!pending} onClick={() => choose(value)}>{t(`kinds.${value}`)}</button>)}
      </div>
      {postId && <p className="muted">{t("postFilter", { id: postId })} <button className="button button-secondary" disabled={busy || !!pending} onClick={() => choose("wall_comment")}>{t("clearFilter")}</button></p>}
      {principal.break_glass && <details className="dates-event-content-access"><summary>{t("breakGlassTitle")}</summary>
        <label><input type="checkbox" checked={breakGlass} disabled={busy || !!pending} onChange={event => setBreakGlass(event.target.checked)} /> {t("breakGlass")}</label>
        <label className="field"><span>{t("reason")}</span><input value={accessReason} maxLength={1000} disabled={busy || !!pending} onChange={event => setAccessReason(event.target.value)} /></label>
        <button className="button button-secondary" disabled={busy || !!pending || (breakGlass && accessReason.trim().length < 3)} onClick={() => setAccess({ break_glass: breakGlass, reason: accessReason.trim() })}>{t("applyAccess")}</button>
      </details>}
      {selected && <form className="dates-event-review-form" onSubmit={event => void openReview(event)}>
        <h3>{t("openReview")}</h3><p className="muted">{t("reviewCopy")}</p><code>{selected.id}</code>
        <label className="field"><span>{t("reason")}</span><textarea value={reason} minLength={3} maxLength={1000} required disabled={busy || !!pending} onChange={event => setReason(event.target.value)} /></label>
        {commandError && <p className="alert alert-error" role="alert">{commandError}</p>}
        <div className="row-actions"><button className="button button-primary" disabled={busy || (!pending && reason.trim().length < 3)}>{pending ? t("retrySame") : t("openReview")}</button>
          <button type="button" className="button button-secondary" disabled={busy || !!pending} onClick={() => setSelected(null)}>{common("cancel")}</button></div>
      </form>}
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <div className="row-actions"><button className="button button-secondary" disabled={loading || busy || !!pending} onClick={() => void load()}>{common("refresh")}</button>
        {loading && <span role="status">{t("loading")}</span>}</div>
      {page?.items.length === 0 && <p className="muted">{t("empty")}</p>}
      <div className="dates-event-content-list">{page?.items.map(row => <article key={row.id} className="dates-event-content-card">
        <div className="row-actions"><span className={`badge ${row.state === "active" ? "badge-active" : "badge-warning"}`}>{t(`states.${row.state}`)}</span>
          <span>{t(`kinds.${row.kind}`)}{row.root_id ? ` · ${t("reply")}` : ""}</span>
          <span className="muted">{row.author_uid ? `UID ${row.author_uid}` : "—"} · {formatDate(row.created_at, locale, true)}</span></div>
        <p className="dates-event-content-text">{row.state === "deleted" ? t("deletedCopy") : row.text || t("attachmentOnly")}</p>
        {row.content_kind !== "text" && <p className="muted">{t("attachment", { kind: row.content_kind })}</p>}
        <p className="muted">{t("signals", { hides: row.hide_count, reports: row.report_count })}{row.signal_at ? ` · ${formatDate(row.signal_at, locale, true)}` : ""}</p>
        <code>{row.id}</code><div className="row-actions">
          {row.kind === "wall_post" && <button className="button button-secondary" disabled={busy || !!pending} onClick={() => choose("wall_comment", row.id)}>{t("comments")}</button>}
          {row.case_id && <Link className="button button-secondary" href={`/dates/moderation/${row.case_id}`}>{t("existingCase")}</Link>}
          {canReview && row.can_review && <button className="button button-primary" disabled={busy || !!pending} onClick={() => select(row.kind, row.id)}>{row.has_media ? t("reviewMedia") : t("openReview")}</button>}
        </div>
      </article>)}</div>
      {page?.has_more && <button className="button button-secondary" disabled={loading || busy || !!pending} onClick={() => void load(page.next_cursor ?? undefined)}>{t("more")}</button>}
    </div>
  </section>;
}
