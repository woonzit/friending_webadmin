"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import FriendingGoTabs from "@/components/FriendingGoTabs";
import PageHeader from "@/components/PageHeader";
import { LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { formatDate, formatNumber } from "@/lib/format";
import {
  DEFAULT_FRIENDINGGO_LIST_FILTERS,
  FRIENDINGGO_BODY_MAX,
  FRIENDINGGO_CAPS,
  FRIENDINGGO_KINDS,
  FRIENDINGGO_MERGE_TAGS,
  FRIENDINGGO_PREHEADER_MAX,
  FRIENDINGGO_SAMPLE,
  FRIENDINGGO_SUBJECT_MAX,
  FRIENDINGGO_SUPPRESSION_REASONS,
  friendingGoCampaignDetail,
  friendingGoCampaigns,
  friendingGoError,
  friendingGoErrorKey,
  friendingGoPreorders,
  friendingGoPreview,
  friendingGoPreviewDocument,
  friendingGoRateLimit,
  friendingGoRefusalCounts,
  type FriendingGoCampaign,
  type FriendingGoEmailContent,
  type FriendingGoKind,
  type FriendingGoPreview,
  type FriendingGoProgress,
  type FriendingGoReasons,
  type FriendingGoSendBody,
  type FriendingGoSendMode,
} from "@/lib/friendinggo";
import {
  EMPTY_FRIENDINGGO_COMPOSER,
  FRIENDINGGO_SEND_LOOP_START,
  FRIENDINGGO_STORAGE_KEYS,
  friendingGoComposer,
  friendingGoComposerContent,
  friendingGoComposerWording,
  friendingGoContentKey,
  friendingGoInsert,
  friendingGoPendingEmail,
  friendingGoSelection,
  friendingGoSendStep,
  friendingGoStore,
  friendingGoStored,
  type FriendingGoComposer,
  type FriendingGoComposerProblem,
  type FriendingGoPendingEmail,
  type FriendingGoSelected,
  type FriendingGoStorage,
} from "@/lib/friendinggoConsole";
import type { FriendingGoNotice } from "@/components/FriendingGoPreordersConsole";

export type FriendingGoPreviewState =
  | { kind: "idle" }
  | { kind: "loading"; key: string }
  | { kind: "ready"; key: string; data: FriendingGoPreview }
  | { kind: "error"; key: string; message: string };

export type FriendingGoEmailConfirm =
  | { kind: "send" }
  | { kind: "discard" }
  /** Replace what is being written: with a draft, or (null) with a new, empty email. */
  | { kind: "replace"; draft: { id: string; subject: string | null } | null };

export type FriendingGoDraftsState = { load: "loading" | "ready" | "error"; drafts: FriendingGoCampaign[]; more: boolean };

/**
 * Whether this operator may test, save and send, from Core's own answer (`go_preorders.can_write`), never
 * from the role alone: Core treats an unrecognised stored role as read-only although `admin_me` shows it as
 * `admin` (Core round 2). The same answer gives the number of active sign-ups for "Everyone active".
 */
export type FriendingGoAccess = { load: "loading" | "ready" | "error"; canWrite: boolean; active: number | null };

/** A send in flight: how far it is, and whether the console is waiting on an earlier attempt. */
export type FriendingGoSending = { progress: FriendingGoProgress | null; waitSeconds: number | null };

const NAMES_SHOWN = 8;

function browserStorage(): FriendingGoStorage | null {
  try { return window.sessionStorage; } catch { return null; }
}

const length = (value: string) => [...value].length;

/** Whether the composer holds anything an operator would lose. */
export function friendingGoComposerHasContent(composer: FriendingGoComposer): boolean {
  return composer.subject.trim() !== "" || composer.preheader.trim() !== "" || composer.body.trim() !== "";
}

/** "Unsubscribed (1), Bounced (2)": the left-out reasons that are not zero, or "" when nobody is left out. */
function useReasonList() {
  const t = useTranslations("friendinggo");
  return (reasons: FriendingGoReasons) => FRIENDINGGO_SUPPRESSION_REASONS
    .filter((reason) => reasons[reason] > 0)
    .map((reason) => t("email.preview.leftOutReason", { count: reasons[reason], status: t(`status.${reason}`) }))
    .join(", ");
}

/** The page body; pure, so every state renders in both locales in tests. */
export function FriendingGoEmailView({
  access,
  hydrated,
  composer,
  selection,
  preview,
  currentKey,
  problems,
  drafts,
  pending,
  busy,
  sending,
  notice,
  confirm,
  onChange,
  onClearAudience,
  onPreview,
  onStart,
  onAskSend,
  onCancelConfirm,
  onConfirm,
  onRetryPending,
  onAskDiscard,
  onOpenDraft,
  onAskNew,
  onReloadDrafts,
}: {
  access: FriendingGoAccess;
  hydrated: boolean;
  composer: FriendingGoComposer;
  selection: FriendingGoSelected[];
  preview: FriendingGoPreviewState;
  /** The content key of what the composer would send now; null when it cannot be sent yet. */
  currentKey: string | null;
  /** Problems to show (after the operator tried an action). */
  problems: FriendingGoComposerProblem[];
  drafts: FriendingGoDraftsState;
  pending: FriendingGoPendingEmail | null;
  busy: boolean;
  sending: FriendingGoSending | null;
  notice: FriendingGoNotice | null;
  confirm: FriendingGoEmailConfirm | null;
  onChange: (next: Partial<FriendingGoComposer>) => void;
  onClearAudience: () => void;
  onPreview: () => void;
  onStart: (mode: Exclude<FriendingGoSendMode, "send">) => void;
  onAskSend: () => void;
  onCancelConfirm: () => void;
  onConfirm: () => void;
  onRetryPending: () => void;
  onAskDiscard: () => void;
  onOpenDraft: (draft: FriendingGoCampaign) => void;
  onAskNew: () => void;
  onReloadDrafts: () => void;
}) {
  const t = useTranslations("friendinggo");
  const locale = useLocale();
  const reasonList = useReasonList();
  const num = (value: number) => formatNumber(value, locale);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const canWrite = access.load === "ready" && access.canWrite;
  const showWrites = access.load === "loading" || canWrite;
  const locked = busy || pending !== null || !hydrated;
  const ready = preview.kind === "ready" ? preview : null;
  const fresh = ready !== null && currentKey !== null && ready.key === currentKey;
  const canSend = canWrite && fresh && ready.data.counts.sendable > 0 && !locked;
  const named = selection.filter((person) => person.name !== "");
  const previewDocument = ready ? friendingGoPreviewDocument(ready.data.html) : null;

  function insertTag(tag: string) {
    const element = bodyRef.current;
    const start = element?.selectionStart ?? composer.body.length;
    const end = element?.selectionEnd ?? composer.body.length;
    const next = friendingGoInsert(composer.body, start, end, tag);
    onChange({ body: next.text });
    if (element) {
      window.requestAnimationFrame(() => { element.focus(); element.setSelectionRange(next.caret, next.caret); });
    }
  }

  const pendingCommand = pending?.command ?? null;

  return (
    <>
      <FriendingGoTabs />
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("email.title")}
        subtitle={t("email.subtitle")}
        actions={<button className="button button-secondary" type="button" disabled={locked} onClick={onAskNew}>{t("email.new")}</button>}
      />

      {notice ? <div className={`alert alert-${notice.tone} page-alert`} role="status">{notice.text}</div> : null}
      {busy && sending ? (
        <div className="alert alert-info page-alert friendinggo-progress" role="status" aria-live="polite">
          {sending.waitSeconds !== null
            ? t("email.progress.waiting", { seconds: num(sending.waitSeconds) })
            : sending.progress
              ? t("email.progress.sending", { processed: num(sending.progress.processed), total: num(sending.progress.total) })
              : t("email.actions.sending")}
          {sending.progress ? (
            <progress max={sending.progress.total} value={sending.progress.processed}>
              {num(sending.progress.processed)} / {num(sending.progress.total)}
            </progress>
          ) : null}
        </div>
      ) : null}
      {pendingCommand && !busy ? (
        <div className="alert alert-warning page-alert friendinggo-pending" role="status">
          <div>
            <strong>{t("pending.title")}</strong>{" "}
            {t(`email.pending.${pendingCommand.mode}`, { subject: pendingCommand.subject })} {t("email.pending.copy")}
          </div>
          <div className="row-actions">
            <button className="button button-primary button-small" type="button" disabled={busy || !canWrite} onClick={onRetryPending}>{t("pending.retry")}</button>
            <button className="button button-secondary button-small" type="button" disabled={busy} onClick={onAskDiscard}>{t("pending.discard")}</button>
          </div>
        </div>
      ) : null}
      {access.load === "ready" && !access.canWrite ? <p className="list-note friendinggo-read-only">{t("email.readOnly")}</p> : null}
      {access.load === "error" ? <p className="alert alert-error page-alert" role="alert">{t("email.accessError")}</p> : null}

      {!hydrated ? <LoadingPanel /> : (
        <div className="friendinggo-email-layout">
          <section className="panel friendinggo-composer" aria-label={t("email.composer.title")}>
            <div className="panel-header">
              <div><h2>{t("email.composer.title")}</h2><p>{composer.campaignId ? t("email.composer.editingDraft") : t("email.composer.copy")}</p></div>
              {composer.campaignId ? <span className="badge badge-info">{t("campaignState.draft")}</span> : null}
            </div>
            <div className="panel-body friendinggo-form">
              <fieldset className="friendinggo-fieldset" disabled={locked}>
                <legend>{t("email.composer.kind")}</legend>
                <div className="friendinggo-choices">
                  {FRIENDINGGO_KINDS.map((kind: FriendingGoKind) => (
                    <label key={kind} className={`friendinggo-choice${composer.kind === kind ? " is-selected" : ""}`}>
                      <input type="radio" name="friendinggo-kind" value={kind} checked={composer.kind === kind}
                        onChange={() => onChange(kind === "direct" ? { kind, audience: "selected" } : { kind })} />
                      <span><strong>{t(`kind.${kind}`)}</strong><small>{t(`email.composer.kindHint.${kind}`, { cap: num(FRIENDINGGO_CAPS[kind]) })}</small></span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="friendinggo-fieldset" disabled={locked}>
                <legend>{t("email.audience.title")}</legend>
                <div className="friendinggo-choices">
                  <label className={`friendinggo-choice${composer.audience === "selected" ? " is-selected" : ""}`}>
                    <input type="radio" name="friendinggo-audience" value="selected" checked={composer.audience === "selected"}
                      onChange={() => onChange({ audience: "selected" })} />
                    <span><strong>{t("email.audience.selected", { count: selection.length })}</strong><small>{t("email.audience.selectedHint")}</small></span>
                  </label>
                  <label className={`friendinggo-choice${composer.audience === "all_active" ? " is-selected" : ""}`}>
                    <input type="radio" name="friendinggo-audience" value="all_active" checked={composer.audience === "all_active"}
                      disabled={composer.kind === "direct"} onChange={() => onChange({ audience: "all_active" })} />
                    <span>
                      <strong>{access.active === null ? t("email.audience.allActive") : t("email.audience.allActiveCount", { count: access.active })}</strong>
                      <small>{composer.kind === "direct" ? t("email.audience.allActiveDirect") : t("email.audience.allActiveHint")}</small>
                    </span>
                  </label>
                </div>
                {composer.audience === "selected" ? (
                  selection.length === 0 ? (
                    <p className="field-hint">{t("email.audience.none")} <Link href="/friendinggo">{t("email.audience.choose")}</Link></p>
                  ) : (
                    <div className="friendinggo-audience-list">
                      <span>
                        {named.slice(0, NAMES_SHOWN).map((person) => person.name).join(", ")}
                        {named.length > NAMES_SHOWN || named.length < selection.length
                          ? `${named.length > 0 ? " " : ""}${t("email.audience.more", { count: selection.length - Math.min(named.length, NAMES_SHOWN) })}` : ""}
                      </span>
                      <button className="text-button" type="button" onClick={onClearAudience}>{t("email.audience.clear")}</button>
                    </div>
                  )
                ) : null}
              </fieldset>

              <label className="field">
                <span className="friendinggo-label-row">{t("email.composer.subject")}<small>{t("counter", { count: num(length(composer.subject)), max: num(FRIENDINGGO_SUBJECT_MAX) })}</small></span>
                <input value={composer.subject} disabled={locked} maxLength={FRIENDINGGO_SUBJECT_MAX * 2}
                  aria-invalid={problems.includes("subject") || undefined} onChange={(event) => onChange({ subject: event.target.value })} />
              </label>
              <label className="field">
                <span className="friendinggo-label-row">{t("email.composer.preheader")}<small>{t("counter", { count: num(length(composer.preheader)), max: num(FRIENDINGGO_PREHEADER_MAX) })}</small></span>
                <input value={composer.preheader} disabled={locked} maxLength={FRIENDINGGO_PREHEADER_MAX * 2}
                  aria-invalid={problems.includes("preheader") || undefined} onChange={(event) => onChange({ preheader: event.target.value })} />
                <small className="field-hint">{t("email.composer.preheaderHint")}</small>
              </label>
              <label className="field">
                <span className="friendinggo-label-row">{t("email.composer.body")}<small>{t("counter", { count: num(length(composer.body)), max: num(FRIENDINGGO_BODY_MAX) })}</small></span>
                <textarea ref={bodyRef} className="friendinggo-body-input" rows={14} value={composer.body} disabled={locked} spellCheck
                  aria-invalid={problems.includes("body") || undefined} onChange={(event) => onChange({ body: event.target.value })} />
              </label>
              <div className="friendinggo-merge-tags">
                <span>{t("email.composer.mergeTags")}</span>
                {FRIENDINGGO_MERGE_TAGS.map((tag) => (
                  <button key={tag} className="button button-secondary button-small" type="button" disabled={locked} onClick={() => insertTag(tag)}>
                    <code>{tag}</code>
                  </button>
                ))}
              </div>
              <p className="field-hint">{t("email.composer.mergeHint", { firstName: FRIENDINGGO_SAMPLE.first_name, city: FRIENDINGGO_SAMPLE.city })}</p>
              <p className="field-hint">{t("email.composer.tagsHint")}</p>

              {problems.length > 0 ? (
                <ul className="alert alert-error friendinggo-problems" role="alert">
                  {problems.map((problem) => (
                    <li key={problem}>{t(`email.problems.${problem}`, {
                      subjectMax: num(FRIENDINGGO_SUBJECT_MAX), preheaderMax: num(FRIENDINGGO_PREHEADER_MAX), bodyMax: num(FRIENDINGGO_BODY_MAX),
                      directCap: num(FRIENDINGGO_CAPS.direct), cap: num(FRIENDINGGO_CAPS.newsletter),
                    })}</li>
                  ))}
                </ul>
              ) : null}

              <div className="friendinggo-actions">
                <button className="button button-secondary" type="button" disabled={locked} onClick={onPreview}>
                  {preview.kind === "loading" ? t("email.actions.previewing") : t("email.actions.preview")}
                </button>
                {showWrites ? (
                  <>
                    <button className="button button-secondary" type="button" disabled={locked || !canWrite} onClick={() => onStart("test")}>
                      {busy && pendingCommand?.mode === "test" ? t("email.actions.testing") : t("email.actions.test")}
                    </button>
                    <button className="button button-secondary" type="button" disabled={locked || !canWrite} onClick={() => onStart("save_draft")}>
                      {busy && pendingCommand?.mode === "save_draft" ? t("email.actions.saving") : t("email.actions.saveDraft")}
                    </button>
                    <button className="button button-primary" type="button" disabled={!canSend} onClick={onAskSend}>
                      {busy && pendingCommand?.mode === "send" ? t("email.actions.sending") : t("email.actions.send")}
                    </button>
                  </>
                ) : null}
              </div>
              {showWrites ? <p className="field-hint">{t("email.actions.sendHint")}</p> : null}
            </div>
          </section>

          <div className="friendinggo-side">
            <section className="panel friendinggo-preview" aria-label={t("email.preview.title")}>
              <div className="panel-header">
                <div><h2>{t("email.preview.title")}</h2><p>{t("email.preview.copy", { firstName: FRIENDINGGO_SAMPLE.first_name, city: FRIENDINGGO_SAMPLE.city })}</p></div>
              </div>
              <div className="panel-body">
                {preview.kind === "idle" ? <p className="field-hint">{t("email.preview.idle")}</p> : null}
                {preview.kind === "loading" ? <LoadingPanel /> : null}
                {preview.kind === "error" ? <p className="alert alert-error" role="alert">{preview.message}</p> : null}
                {ready ? (
                  <div className={fresh ? "friendinggo-preview-body" : "friendinggo-preview-body is-stale"}>
                    {!fresh ? <p className="alert alert-warning" role="status">{t("email.preview.stale")}</p> : null}
                    <section className="stat-grid friendinggo-counts" aria-label={t("email.preview.countsLabel")}>
                      {([
                        ["selected", ready.data.counts.selected],
                        ["sendable", ready.data.counts.sendable],
                        ["suppressed", ready.data.counts.suppressed],
                      ] as const).map(([key, value]) => (
                        <article className="stat-card" key={key}>
                          <span className="stat-label">{t(`email.preview.counts.${key}`)}</span>
                          <strong className="stat-value">{num(value)}</strong>
                        </article>
                      ))}
                    </section>
                    {ready.data.counts.suppressed > 0 ? (
                      <p className="field-hint friendinggo-left-out">
                        {t("email.preview.leftOutBy", { reasons: reasonList(ready.data.counts.suppressed_by_reason) })} {t("email.preview.leftOutWhy")}
                      </p>
                    ) : null}
                    {ready.data.counts.sendable === 0 ? <p className="alert alert-warning">{t("errors.audienceEmpty")}</p> : null}
                    {ready.data.counts.selected > ready.data.cap
                      ? <p className="alert alert-warning">{t("email.preview.overCap", { cap: num(ready.data.cap) })}</p> : null}
                    <dl className="detail-list compact friendinggo-envelope">
                      <div className="detail-row"><dt>{t("email.composer.subject")}</dt><dd>{ready.data.subject}</dd></div>
                      <div className="detail-row"><dt>{t("email.composer.preheader")}</dt><dd>{ready.data.preheader || "—"}</dd></div>
                    </dl>
                    {previewDocument ? (
                      <iframe className="friendinggo-email-frame" sandbox="" srcDoc={previewDocument} title={t("email.preview.frameTitle", { subject: ready.data.subject })} />
                    ) : <p className="alert alert-error">{t("errors.outcomeUnknown")}</p>}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="panel friendinggo-drafts" aria-label={t("email.drafts.title")}>
              <div className="panel-header">
                <div><h2>{t("email.drafts.title")}</h2><p>{t("email.drafts.copy")}</p></div>
                <button className="button button-secondary button-small" type="button" disabled={drafts.load === "loading"} onClick={onReloadDrafts}>{t("email.drafts.reload")}</button>
              </div>
              <div className="panel-body">
                {drafts.load === "loading" ? <p className="field-hint">{t("email.drafts.loading")}</p>
                  : drafts.load === "error" ? <p className="alert alert-error" role="alert">{t("email.drafts.error")}</p>
                    : drafts.drafts.length === 0 ? <p className="field-hint">{t("email.drafts.empty")}</p> : (
                      <ul className="friendinggo-draft-list">
                        {drafts.drafts.map((draft) => (
                          <li key={draft.id} className={draft.id === composer.campaignId ? "is-open" : undefined}>
                            <span className="cell-stack">
                              <strong>{draft.subject}</strong>
                              <small>{t(`kind.${draft.kind}`)} · {formatDate(draft.updated_at, locale, true)}</small>
                            </span>
                            <button className="button button-secondary button-small" type="button" disabled={locked || draft.id === composer.campaignId}
                              onClick={() => onOpenDraft(draft)}>{t("email.drafts.open")}</button>
                          </li>
                        ))}
                      </ul>
                    )}
                {drafts.more ? <p className="field-hint">{t("email.drafts.more")}</p> : null}
              </div>
            </section>
          </div>
        </div>
      )}

      {confirm?.kind === "send" && ready ? (
        <ConfirmDialog
          title={t("email.confirm.title", { count: ready.data.counts.sendable })}
          copy={t(composer.audience === "all_active" ? "email.confirm.copyAll" : "email.confirm.copy", {
            kind: t(`kind.${ready.data.kind}`),
            subject: ready.data.subject,
            count: ready.data.counts.sendable,
            suppressed: ready.data.counts.suppressed,
          })}
          confirmLabel={t("email.confirm.button", { count: ready.data.counts.sendable })}
          busyLabel={t("email.actions.sending")}
          tone="primary"
          busy={busy}
          onCancel={onCancelConfirm}
          onConfirm={onConfirm}
        >
          {ready.data.counts.suppressed > 0
            ? <p className="field-hint">{t("email.preview.leftOutBy", { reasons: reasonList(ready.data.counts.suppressed_by_reason) })}</p> : null}
          <p className="field-hint">{t("email.confirm.final")}</p>
        </ConfirmDialog>
      ) : null}
      {confirm?.kind === "discard" ? (
        <ConfirmDialog
          title={t("email.discard.title")}
          copy={t(pendingCommand?.mode === "send" ? "email.discard.copySend" : "email.discard.copy")}
          confirmLabel={t("email.discard.confirm")}
          onCancel={onCancelConfirm}
          onConfirm={onConfirm}
        />
      ) : null}
      {confirm?.kind === "replace" ? (
        <ConfirmDialog
          title={confirm.draft ? t("email.replace.titleDraft", { subject: confirm.draft.subject ?? "" }) : t("email.replace.titleNew")}
          copy={t("email.replace.copy")}
          confirmLabel={confirm.draft ? t("email.replace.open") : t("email.replace.clear")}
          onCancel={onCancelConfirm}
          onConfirm={onConfirm}
        />
      ) : null}
    </>
  );
}

const sleep = (milliseconds: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, milliseconds); });

/**
 * Email: a composer whose content and audience survive tab switches, a preview of the real layout, and
 * three receipted writes (test, draft, send). Every write's request id is stored before it leaves and
 * kept until its outcome is known: an unknown outcome is retried with the same id, and a send Core
 * answers in slices (`sending`) is carried on with the same id until it is `sent`, so nobody is mailed
 * twice. Never a recovery-loader registration.
 */
export default function FriendingGoEmailConsole({ initialDraftId }: { initialDraftId: string | null }) {
  const t = useTranslations("friendinggo");
  const locale = useLocale();
  const reasonList = useReasonList();
  const [hydrated, setHydrated] = useState(false);
  const [access, setAccess] = useState<FriendingGoAccess>({ load: "loading", canWrite: false, active: null });
  const [composer, setComposer] = useState<FriendingGoComposer>(EMPTY_FRIENDINGGO_COMPOSER);
  const [selection, setSelection] = useState<FriendingGoSelected[]>([]);
  const [preview, setPreview] = useState<FriendingGoPreviewState>({ kind: "idle" });
  const [showProblems, setShowProblems] = useState(false);
  const [drafts, setDrafts] = useState<FriendingGoDraftsState>({ load: "loading", drafts: [], more: false });
  const [draftsRevision, setDraftsRevision] = useState(0);
  const [pending, setPending] = useState<FriendingGoPendingEmail | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState<FriendingGoSending | null>(null);
  const [notice, setNotice] = useState<FriendingGoNotice | null>(null);
  const [confirm, setConfirm] = useState<FriendingGoEmailConfirm | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const previewSequence = useRef(0);

  const content = friendingGoComposerContent(composer, selection);
  const currentKey = content.ok ? friendingGoContentKey(content.value) : null;
  const problems = showProblems && !content.ok ? content.problems : [];
  const canWrite = access.load === "ready" && access.canWrite;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Write access and the active count come from Core's answer, not from the role.
  useEffect(() => {
    const controller = new AbortController();
    void adminCall("go_preorders", { ...DEFAULT_FRIENDINGGO_LIST_FILTERS }, controller.signal).then((response) => {
      if (controller.signal.aborted) return;
      const list = friendingGoPreorders(response, DEFAULT_FRIENDINGGO_LIST_FILTERS);
      setAccess(list ? { load: "ready", canWrite: list.can_write, active: list.totals.active } : { load: "error", canWrite: false, active: null });
    });
    return () => controller.abort();
  }, []);

  const openDraft = useCallback(async (id: string) => {
    const response = await adminCall("go_email_campaigns", { campaign_id: id, page: 1 });
    const detail = friendingGoCampaignDetail(response, id, 1);
    if (!detail || detail.campaign.state !== "draft") {
      const error = friendingGoError(response);
      setNotice({ tone: "error", text: detail ? t("email.drafts.notDraft") : t(`errors.${friendingGoErrorKey(error)}`) });
      return;
    }
    const draft = detail.campaign;
    setComposer({
      kind: draft.kind,
      audience: draft.audience.mode,
      subject: draft.subject,
      preheader: draft.preheader,
      body: draft.body_html,
      campaignId: draft.id,
    });
    // A draft names its people by id only; Core's preview counts them and says who is left out and why.
    setSelection(draft.audience.mode === "selected" ? draft.audience.preorder_ids.map((person) => ({ id: person, name: "", status: null })) : []);
    setPreview({ kind: "idle" });
    setShowProblems(false);
    setNotice({ tone: "info", text: t("email.drafts.opened", { subject: draft.subject }) });
  }, [t]);

  useEffect(() => {
    const storage = browserStorage();
    const storedComposer = friendingGoStored(storage, FRIENDINGGO_STORAGE_KEYS.composer, friendingGoComposer) ?? EMPTY_FRIENDINGGO_COMPOSER;
    const storedSelection = friendingGoStored(storage, FRIENDINGGO_STORAGE_KEYS.audience, friendingGoSelection) ?? [];
    const storedPending = friendingGoStored(storage, FRIENDINGGO_STORAGE_KEYS.pendingEmail, friendingGoPendingEmail);
    if (storage === null || storedPending === undefined) setNotice({ tone: "error", text: t("errors.storageUnavailable") });
    setComposer(storedComposer);
    setSelection(storedSelection);
    if (storedPending) {
      setPending(storedPending);
      setNotice({ tone: "info", text: t("pending.restored") });
    } else if (initialDraftId && storedComposer.campaignId !== initialDraftId) {
      // Opening a draft replaces what is being written: ask first when there is something to lose.
      if (friendingGoComposerHasContent(storedComposer)) setConfirm({ kind: "replace", draft: { id: initialDraftId, subject: null } });
      else void openDraft(initialDraftId);
    }
    setHydrated(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (hydrated) friendingGoStore(browserStorage(), FRIENDINGGO_STORAGE_KEYS.composer, composer);
  }, [composer, hydrated]);
  useEffect(() => {
    if (hydrated) friendingGoStore(browserStorage(), FRIENDINGGO_STORAGE_KEYS.audience, selection.length > 0 ? selection : null);
  }, [selection, hydrated]);

  // Every draft, newest first, through Core's state filter (round 2).
  useEffect(() => {
    const controller = new AbortController();
    setDrafts((current) => ({ ...current, load: "loading" }));
    void adminCall("go_email_campaigns", { state: "draft", page: 1 }, controller.signal).then((response) => {
      if (controller.signal.aborted) return;
      const list = friendingGoCampaigns(response, 1, "draft");
      setDrafts(list ? { load: "ready", drafts: list.campaigns, more: list.has_more } : { load: "error", drafts: [], more: false });
    });
    return () => controller.abort();
  }, [draftsRevision]);

  const runPreview = useCallback(async (value: FriendingGoEmailContent) => {
    const key = friendingGoContentKey(value);
    const sequence = previewSequence.current + 1;
    previewSequence.current = sequence;
    setPreview({ kind: "loading", key });
    const response = await adminCall("go_email_preview", { ...value });
    if (sequence !== previewSequence.current) return;
    const parsed = friendingGoPreview(response, value);
    setPreview(parsed
      ? { kind: "ready", key, data: parsed }
      : { kind: "error", key, message: t(`errors.${friendingGoErrorKey(friendingGoError(response))}`) });
  }, [t]);

  function previewNow() {
    setShowProblems(true);
    setNotice(null);
    if (content.ok) void runPreview(content.value);
  }

  const execute = useCallback(async (stored: FriendingGoPendingEmail) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    setSending(stored.command.mode === "send" ? { progress: null, waitSeconds: null } : null);
    const command = stored.command;
    const storage = browserStorage();
    let loop = FRIENDINGGO_SEND_LOOP_START;
    let response: unknown = null;
    for (;;) {
      response = await adminCall("go_email_send", { ...command });
      const next = friendingGoSendStep(response, command, loop);
      loop = next.loop;
      const step = next.step;
      // Leaving the page stops the loop; the command stays stored and is offered for a retry on return.
      if (!mountedRef.current) return;
      if (step.kind === "continue") {
        setSending({ progress: step.progress, waitSeconds: null });
        await sleep(step.delayMs);
        continue;
      }
      if (step.kind === "wait") {
        setSending((current) => ({ progress: current?.progress ?? null, waitSeconds: step.seconds }));
        await sleep(step.seconds * 1000);
        if (!mountedRef.current) return;
        setSending((current) => ({ progress: current?.progress ?? null, waitSeconds: null }));
        continue;
      }
      if (step.kind === "done") {
        friendingGoStore(storage, FRIENDINGGO_STORAGE_KEYS.pendingEmail, null);
        setPending(null);
        const result = step.result;
        if (result.mode === "test") {
          setNotice({ tone: "success", text: t(result.receipt.replayed ? "email.notices.testReplayed" : "email.notices.test", { to: result.to }) });
        } else if (result.mode === "save_draft") {
          setComposer((current) => ({ ...current, campaignId: result.campaign.id }));
          setNotice({ tone: "success", text: t("email.notices.draftSaved", { subject: result.campaign.subject }) });
          setDraftsRevision((value) => value + 1);
        } else {
          const counts = result.campaign.counts;
          setComposer(EMPTY_FRIENDINGGO_COMPOSER);
          setSelection([]);
          setPreview({ kind: "idle" });
          setShowProblems(false);
          setNotice({
            tone: "success",
            text: [
              t("email.notices.sent", { count: counts?.queued ?? 0, suppressed: counts?.suppressed ?? 0 }),
              counts && counts.suppressed > 0 ? t("email.preview.leftOutBy", { reasons: reasonList(counts.suppressed_by_reason) }) : "",
            ].filter(Boolean).join(" "),
          });
          setDraftsRevision((value) => value + 1);
        }
      } else if (step.kind === "paused") {
        // Core is still sending: keep the command; Retry carries the same send on.
        setPending(stored);
        setNotice({ tone: "warning", text: t("email.pending.paused", { processed: formatNumber(step.progress.processed, locale), total: formatNumber(step.progress.total, locale) }) });
      } else if (step.kind === "unknown") {
        // The request may have run: keep it, and retry exactly it. A long send is "still sending", not an error.
        setPending(stored);
        setNotice({
          tone: "warning",
          text: command.mode === "send" || step.error === "go-request-in-progress" ? t("email.pending.stillSending") : t(`errors.${friendingGoErrorKey(step.error)}`),
        });
      } else {
        // A named refusal is final for its request id: the next attempt draws a new one.
        friendingGoStore(storage, FRIENDINGGO_STORAGE_KEYS.pendingEmail, null);
        setPending(null);
        const error = step.error;
        const refusal = friendingGoRefusalCounts(response);
        if (error === "go-email-audience-changed" && command.mode === "send") {
          setNotice({ tone: "warning", text: t("email.refusals.audienceChanged", { count: refusal?.counts.sendable ?? 0 }) });
          const { mode: _mode, campaign_id: _campaign, request_id: _request, expected_sendable: _expected, ...again } = command;
          void runPreview(again);
        } else if (error === "go-email-audience-too-large") {
          setNotice({ tone: "error", text: t("email.refusals.tooLarge", { cap: formatNumber(refusal?.cap ?? FRIENDINGGO_CAPS[command.kind], locale) }) });
        } else if (error === "go-email-rate-limited") {
          const limit = friendingGoRateLimit(response);
          setNotice({ tone: "error", text: t("email.refusals.rateLimited", { limit: limit?.limit ?? 3, minutes: Math.round((limit?.window_seconds ?? 3600) / 60) }) });
        } else if (error === "go-campaign-not-found" || error === "go-campaign-not-draft") {
          // The draft is gone or was sent meanwhile: what is written stays, and saving it makes a new draft.
          setComposer((current) => ({ ...current, campaignId: "" }));
          setNotice({ tone: "error", text: t(`errors.${friendingGoErrorKey(error)}`) });
          setDraftsRevision((value) => value + 1);
        } else {
          setNotice({ tone: "error", text: t(`errors.${friendingGoErrorKey(error)}`) });
        }
      }
      break;
    }
    busyRef.current = false;
    setBusy(false);
    setSending(null);
  }, [locale, reasonList, runPreview, t]);

  function start(mode: FriendingGoSendMode) {
    if (pending || busyRef.current || !canWrite) return;
    setShowProblems(true);
    const requestId = crypto.randomUUID();
    let command: FriendingGoSendBody;
    if (mode === "test") {
      const words = friendingGoComposerWording(composer);
      if (!words.ok) return;
      command = { mode, ...words.value, request_id: requestId };
    } else {
      if (!content.ok) return;
      if (mode === "save_draft") {
        command = { mode, ...content.value, campaign_id: composer.campaignId, request_id: requestId };
      } else {
        if (preview.kind !== "ready" || preview.key !== currentKey || preview.data.counts.sendable < 1) return;
        command = { mode, ...content.value, campaign_id: composer.campaignId, request_id: requestId, expected_sendable: preview.data.counts.sendable };
      }
    }
    const stored: FriendingGoPendingEmail = { version: 1, command };
    // The request id is stored before the request leaves: a lost answer is retried, never re-minted.
    if (!friendingGoStore(browserStorage(), FRIENDINGGO_STORAGE_KEYS.pendingEmail, stored)) {
      setNotice({ tone: "error", text: t("errors.storageUnavailable") });
      return;
    }
    setPending(stored);
    void execute(stored);
  }

  function change(next: Partial<FriendingGoComposer>) {
    if (pending || busy) return;
    setComposer((current) => ({ ...current, ...next }));
  }

  function confirmAction() {
    const current = confirm;
    setConfirm(null);
    if (!current) return;
    if (current.kind === "send") start("send");
    else if (current.kind === "discard") {
      friendingGoStore(browserStorage(), FRIENDINGGO_STORAGE_KEYS.pendingEmail, null);
      setPending(null);
      setNotice({ tone: "info", text: t("pending.discarded") });
      setDraftsRevision((value) => value + 1);
    } else if (current.draft) {
      void openDraft(current.draft.id);
    } else {
      setComposer(EMPTY_FRIENDINGGO_COMPOSER);
      setPreview({ kind: "idle" });
      setShowProblems(false);
      setNotice(null);
    }
  }

  return (
    <FriendingGoEmailView
      access={access}
      hydrated={hydrated}
      composer={composer}
      selection={selection}
      preview={preview}
      currentKey={currentKey}
      problems={problems}
      drafts={drafts}
      pending={pending}
      busy={busy}
      sending={sending}
      notice={notice}
      confirm={confirm}
      onChange={change}
      onClearAudience={() => { if (!pending && !busy) setSelection([]); }}
      onPreview={previewNow}
      onStart={(mode) => start(mode)}
      onAskSend={() => {
        if (preview.kind === "ready" && preview.key === currentKey && !pending && !busy) setConfirm({ kind: "send" });
      }}
      onCancelConfirm={() => setConfirm(null)}
      onConfirm={confirmAction}
      onRetryPending={() => { if (pending) void execute(pending); }}
      onAskDiscard={() => setConfirm({ kind: "discard" })}
      onOpenDraft={(draft) => {
        if (friendingGoComposerHasContent(composer) && composer.campaignId !== draft.id) setConfirm({ kind: "replace", draft: { id: draft.id, subject: draft.subject } });
        else void openDraft(draft.id);
      }}
      onAskNew={() => {
        if (friendingGoComposerHasContent(composer) || composer.campaignId) setConfirm({ kind: "replace", draft: null });
      }}
      onReloadDrafts={() => setDraftsRevision((value) => value + 1)}
    />
  );
}
