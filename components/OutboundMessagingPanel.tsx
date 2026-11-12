"use client";

import React, { useCallback, useEffect, useReducer, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import { adminCall, type AdminResponse } from "@/lib/adminClient";
import { cannedTemplateEmailPreviewDocument } from "@/lib/cannedTemplates";
import {
  OUTBOUND_MESSAGING_AVAILABILITY,
  OUTBOUND_MESSAGING_CHANNELS,
  OUTBOUND_MESSAGING_OUTCOMES,
  OUTBOUND_PREVIEW_SAFETY_SECONDS,
  outboundHistoryDetailResponse,
  outboundHistoryEmailPreviewDocument,
  outboundPendingSendValue,
  outboundPendingStorageKey,
  outboundPreviewMsLeft,
  outboundSendOutcome,
  type OutboundPendingSend,
} from "@/lib/outboundMessaging";
import {
  outboundPanelDetailRequest,
  outboundPanelHistoryRequest,
  outboundPanelInitial,
  outboundPanelNewSend,
  outboundPanelPreviewRequest,
  outboundPanelReducer,
  outboundPanelTemplatesRequest,
  type OutboundPanelNotice,
  type OutboundPanelProblem,
  type OutboundPanelState,
} from "@/lib/outboundMessagingPanel";
import { sessionCommandStorage, storeSessionCommand, storedSessionCommand } from "@/lib/sessionCommandStorage";

function statusClass(value: string): string {
  if (value === "available" || value === "sent") return "status-active";
  if (value === "queued" || value === "sending" || value === "retrying") return "status-info";
  if (value === "partially_sent" || value === "channel_absent" || value === "opted_out") {
    return "status-warning";
  }
  return "status-inactive";
}

/**
 * The member page's outbound message panel (contract v1, api docs/OUTBOUND_MESSAGING_WEBADMIN_V1.md):
 * the member's channel availability and the operator's capacity from Core's preview, a composer for one
 * exact canned-template revision or custom content, a confirmation of exactly what goes where, the
 * receipt-backed send, and the member's delivery history. All decisions are in
 * lib/outboundMessagingPanel.ts; this component renders its state, sends the reads it asks for and keeps
 * the pending send in this tab's storage.
 */
export default function OutboundMessagingPanel({
  uid,
  displayName,
  codename,
  adminMe,
  initialState,
}: {
  uid: number;
  displayName: string;
  codename: string;
  /**
   * The page's one admin_me answer for the panels it mounts (lib/pageAdminMe.ts). The first load uses it;
   * a retry asks Core again.
   */
  adminMe: () => Promise<AdminResponse | null>;
  /** A state to start from (tests render the panel from states the reducer reaches). */
  initialState?: OutboundPanelState;
}) {
  const t = useTranslations("outboundMessaging");
  const locale = useLocale();
  const [state, dispatch] = useReducer(outboundPanelReducer, initialState ?? outboundPanelInitial(uid));
  const storageKey = outboundPendingStorageKey(uid);
  const firstAccess = useRef(true);
  const inFlight = useRef(false);

  // Core's capability block: the page's shared answer first, Core itself on a retry. The tab's stored
  // pending send is read with it, so the reducer decides whether this operator adopts it.
  useEffect(() => {
    if (state.access.status !== "loading") return;
    let active = true;
    const ask = firstAccess.current ? adminMe() : adminCall("admin_me", {});
    firstAccess.current = false;
    void ask.then((response) => {
      if (!active) return;
      const stored = storageKey ? storedSessionCommand(sessionCommandStorage(), storageKey, outboundPendingSendValue) : null;
      dispatch({ type: "accessAnswered", response, stored: stored ?? null });
    });
    return () => { active = false; };
  }, [state.access.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once reconciled, the tab's storage follows the command: the record while it is pending, nothing once settled.
  useEffect(() => {
    if (!state.hydrated || !storageKey) return;
    storeSessionCommand(sessionCommandStorage(), storageKey, state.command.status === "idle" ? null : state.command.pending);
  }, [state.hydrated, state.command, storageKey]);

  useEffect(() => {
    if (state.history.status !== "loading") return;
    const ticket = state.history.ticket;
    const request = outboundPanelHistoryRequest(state);
    const controller = new AbortController();
    void (request ? adminCall("user_history", { ...request }, controller.signal) : Promise.resolve(null)).then((response) => {
      if (!controller.signal.aborted) dispatch({ type: "historyAnswered", ticket, response });
    });
    return () => controller.abort();
  }, [state.history.ticket, state.history.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state.detail.status !== "loading") return;
    const ticket = state.detail.ticket;
    const request = outboundPanelDetailRequest(state);
    const controller = new AbortController();
    void (request ? adminCall("user_history_detail", { ...request }, controller.signal) : Promise.resolve(null)).then(async (response) => {
      // The exact body is hash-checked against its stored SHA-256 before it is shown.
      const parsed = request ? await outboundHistoryDetailResponse(response, request) : null;
      if (!controller.signal.aborted) dispatch({ type: "detailAnswered", ticket, parsed, response });
    });
    return () => controller.abort();
  }, [state.detail.ticket, state.detail.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state.preview.status !== "loading") return;
    const ticket = state.preview.ticket;
    const request = outboundPanelPreviewRequest(state);
    const controller = new AbortController();
    void (request ? adminCall("outbound_message_preview", { ...request }, controller.signal) : Promise.resolve(null)).then((response) => {
      if (!controller.signal.aborted) dispatch({ type: "previewAnswered", ticket, response, now: Date.now() });
    });
    return () => controller.abort();
  }, [state.preview.ticket, state.preview.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state.templates.status !== "loading") return;
    const ticket = state.templates.ticket;
    const request = outboundPanelTemplatesRequest(state);
    const controller = new AbortController();
    void (request ? adminCall("list_canned", { ...request }, controller.signal) : Promise.resolve(null)).then((response) => {
      if (!controller.signal.aborted) dispatch({ type: "templatesAnswered", ticket, response });
    });
    return () => controller.abort();
  }, [state.templates.ticket, state.templates.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // The preview's usable lifetime runs on this browser's clock from when it arrived.
  useEffect(() => {
    const preview = state.preview.value;
    if (state.preview.status !== "ready" || !preview) return;
    const left = outboundPreviewMsLeft(preview, state.preview.receivedAt, Date.now());
    const timer = window.setTimeout(() => dispatch({ type: "previewLapsed", now: Date.now() }), left + 50);
    return () => window.clearTimeout(timer);
  }, [state.preview.status, state.preview.value, state.preview.receivedAt]);

  const execute = useCallback(async (pending: OutboundPendingSend) => {
    try {
      const response = await adminCall("send_message", { ...pending.payload });
      const outcome = outboundSendOutcome(response, pending.payload);
      // Settled by an observed outcome: forget the identity even if this panel has gone meanwhile.
      if (outcome.kind !== "unknown" && storageKey) storeSessionCommand(sessionCommandStorage(), storageKey, null);
      dispatch({ type: "sendAnswered", pending, outcome });
    } finally {
      inFlight.current = false;
    }
  }, [storageKey]);

  function confirmSend() {
    if (inFlight.current) return;
    const built = outboundPanelNewSend(state, crypto.randomUUID(), Date.now());
    if (!built.ok) {
      dispatch({ type: "sendBlocked", notice: built.notice });
      return;
    }
    // Stored before it leaves: a timeout, a lost answer or a reload finds exactly this request again.
    if (!storageKey || !storeSessionCommand(sessionCommandStorage(), storageKey, built.pending)) {
      dispatch({ type: "storageRefused" });
      return;
    }
    inFlight.current = true;
    dispatch({ type: "sendStarted", pending: built.pending });
    void execute(built.pending);
  }

  function retrySend() {
    if (inFlight.current || state.command.status !== "doubt") return;
    const pending = state.command.pending;
    inFlight.current = true;
    dispatch({ type: "sendStarted", pending });
    void execute(pending);
  }

  if (state.access.status === "hidden") return null;

  const localeName = locale === "hu" ? "hu-HU" : "en-US";
  function instant(epochMs: number, withSeconds = false): string {
    return new Intl.DateTimeFormat(localeName, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      ...(withSeconds ? { second: "2-digit" } : {}),
    }).format(new Date(epochMs));
  }
  function problemText(problem: OutboundPanelProblem | null): string {
    return t(`errors.${problem?.key ?? "generic"}`);
  }
  function noticeText(notice: OutboundPanelNotice): string {
    const values: Record<string, string | number> = { ...notice.values };
    if (typeof values.channel === "string") values.channel = t(`channels.${values.channel}`);
    if (typeof values.state === "string") values.state = t(`availability.states.${values.state}.label`);
    if (typeof values.status === "string") values.status = t(`history.statuses.${values.status}`);
    return t(notice.key, values);
  }

  const access = state.access;
  const ready = access.status === "ready";
  const canSend = access.status === "ready" && access.canSend;
  const command = state.command;
  const locked = command.status !== "idle";
  const preview = state.preview.value;
  const recipient = preview?.recipients.find((row) => row.uid === uid) ?? null;
  const previewLive = state.preview.status === "ready" && recipient !== null;
  const draft = state.draft;
  const channel = draft.channel;
  const template = draft.source === "template" ? draft.template : null;
  const templateEmailDocument = template?.channel === "email" ? cannedTemplateEmailPreviewDocument(template.body) : null;
  const name = recipient?.display_name || displayName;
  const handle = recipient ? recipient.codename : codename;
  const identity = `${name || t("preview.unnamed")} · ${t("preview.uid", { uid })}${handle ? ` · @${handle}` : ""}`;
  const history = state.history.data;
  const selectedId = state.detail.messageId;
  const detail = state.detail.status === "ready" ? state.detail.value : null;
  const historyEmailDocument = detail ? outboundHistoryEmailPreviewDocument(detail) : null;
  const replayedRow = state.result?.replayed
    ? history?.messages.find((row) => row.request_id === state.result!.request_id && row.uid === uid) ?? null
    : null;
  // When this browser stops using the preview for a send (its lifetime less the safety margin).
  const previewUntil = preview
    ? state.preview.receivedAt + (preview.expires_at - preview.evaluated_at - OUTBOUND_PREVIEW_SAFETY_SECONDS) * 1000
    : 0;
  const availabilityOf = (value: (typeof OUTBOUND_MESSAGING_CHANNELS)[number]) => recipient?.channels[value] ?? null;

  const contentPreview = draft.source === "template" ? (
    !template ? <div className="empty-state compact"><p>{t("content.chooseTemplateFirst")}</p></div>
      : template.channel === "email" && templateEmailDocument ? (
        <iframe className="canned-email-frame" sandbox="" srcDoc={templateEmailDocument} title={t("content.emailFrameTitle")} />
      ) : template.channel === "sms" ? (
        <div className="canned-phone-preview"><div className="canned-sms-bubble">{template.body}</div></div>
      ) : (
        <div className="canned-push-preview"><span className="canned-push-app" aria-hidden="true">F</span><div><strong>{template.subject}</strong><p>{template.body}</p></div></div>
      )
  ) : channel === "email" ? (
    <div className="outbound-email-source"><p>{t("content.emailSourceOnly")}</p>{draft.subject ? <strong>{draft.subject}</strong> : null}<pre>{draft.body}</pre></div>
  ) : channel === "sms" ? (
    <div className="canned-phone-preview"><div className="canned-sms-bubble">{draft.body}</div></div>
  ) : (
    <div className="canned-push-preview"><span className="canned-push-app" aria-hidden="true">F</span><div><strong>{draft.subject}</strong><p>{draft.body}</p></div></div>
  );

  return (
    <section className="panel outbound-messaging-panel">
      <div className="panel-header outbound-messaging-header">
        <div>
          <h2>{t("title")}</h2>
          <p>{t("copy")}</p>
        </div>
        {ready && !canSend ? <span className="status-badge status-warning">{t("historyOnly")}</span> : null}
      </div>
      <div className="panel-body outbound-messaging-body">
        {access.status === "loading" ? <p className="page-subtitle">{t("loading")}</p> : null}
        {access.status === "failed" ? (
          <div className="outbound-section">
            <div className="alert alert-error" role="alert">{t("accessFailed")}</div>
            <div className="outbound-confirm-actions">
              <button className="button button-secondary" type="button" onClick={() => dispatch({ type: "accessAsked" })}>{t("retry")}</button>
            </div>
          </div>
        ) : null}

        {canSend ? (
          <>
            <section className="outbound-section" aria-labelledby="outbound-availability-title">
              <div className="outbound-section-heading">
                <div>
                  <span className="eyebrow">01</span>
                  <h3 id="outbound-availability-title">{t("availability.title")}</h3>
                  <p>{t("availability.copy")}</p>
                </div>
              </div>
              <div className="outbound-availability-guide">
                {OUTBOUND_MESSAGING_AVAILABILITY.map((value) => (
                  <article key={value}>
                    <span className={`status-badge ${statusClass(value)}`}>{t(`availability.states.${value}.label`)}</span>
                    <p>{t(`availability.states.${value}.copy`)}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="outbound-section" aria-labelledby="outbound-preview-title">
              <div className="outbound-section-heading">
                <div>
                  <span className="eyebrow">02</span>
                  <h3 id="outbound-preview-title">{t("preview.title")}</h3>
                  <p>{t("preview.copy")}</p>
                </div>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={state.preview.status === "loading" || locked}
                  onClick={() => dispatch({ type: "previewAsked" })}
                >{t("preview.refresh")}</button>
              </div>
              {state.preview.status === "loading" ? <p className="page-subtitle" role="status">{t("preview.loading")}</p> : null}
              {state.preview.status === "failed" ? <div className="alert alert-error" role="alert">{t("preview.failed")} {problemText(state.preview.problem)}</div> : null}
              {state.preview.status === "expired" ? <div className="alert alert-info" role="status">{t("preview.expiredCopy")}</div> : null}
              {preview && recipient && (state.preview.status === "ready" || state.preview.status === "expired") ? (
                <div className="outbound-preview-grid">
                  <article className="outbound-recipient-card">
                    <div className="outbound-recipient-identity">
                      <span aria-hidden="true">{(name || "?").slice(0, 1)}</span>
                      <div>
                        <strong>{name || t("preview.unnamed")}</strong>
                        <small>{t("preview.uid", { uid })}{handle ? ` · @${handle}` : ""}</small>
                      </div>
                    </div>
                    <div className="outbound-channel-statuses">
                      {OUTBOUND_MESSAGING_CHANNELS.map((value) => (
                        <div key={value}>
                          <span>{t(`channels.${value}`)}</span>
                          <span className={`status-badge ${statusClass(recipient.channels[value])}`}>
                            {t(`availability.states.${recipient.channels[value]}.label`)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </article>
                  <div className="outbound-capacity-grid">
                    <article>
                      <span>{t("preview.overall")}</span>
                      <strong>{preview.limits.overall.remaining}</strong>
                      <small>{t("preview.ofLimit", { limit: preview.limits.overall.limit })}</small>
                    </article>
                    <article>
                      <span>{t("preview.smsPush")}</span>
                      <strong>{preview.limits.sms_push.remaining}</strong>
                      <small>{t("preview.ofLimit", { limit: preview.limits.sms_push.limit })}</small>
                    </article>
                    <article>
                      <span>{t("preview.expires")}</span>
                      <strong>{state.preview.status === "expired" ? t("preview.expired") : t("preview.lifetime", { minutes: Math.round((preview.expires_at - preview.evaluated_at) / 60) })}</strong>
                      <small>{t("preview.validUntil", { time: instant(previewUntil, true) })}</small>
                    </article>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="outbound-section" aria-labelledby="outbound-content-title">
              <div className="outbound-section-heading">
                <div>
                  <span className="eyebrow">03</span>
                  <h3 id="outbound-content-title">{t("content.title")}</h3>
                  <p>{t("content.copy")}</p>
                </div>
              </div>
              <div className="segmented-control outbound-channel-tabs" role="group" aria-label={t("content.channelLabel")}>
                {OUTBOUND_MESSAGING_CHANNELS.map((value) => (
                  <button
                    className={channel === value ? "active" : ""}
                    type="button"
                    key={value}
                    aria-pressed={channel === value}
                    disabled={locked}
                    onClick={() => dispatch({ type: "channelChosen", channel: value })}
                  >{t(`channels.${value}`)}</button>
                ))}
              </div>
              <div className="outbound-content-grid">
                <div className="outbound-composer-column">
                  <div className="outbound-source-options">
                    {(["template", "custom"] as const).map((value) => (
                      <button
                        type="button"
                        className={draft.source === value ? "selected" : ""}
                        key={value}
                        aria-pressed={draft.source === value}
                        disabled={locked}
                        onClick={() => dispatch({ type: "sourceChosen", source: value })}
                      >
                        <strong>{t(`content.sources.${value}.title`)}</strong>
                        <small>{t(`content.sources.${value}.copy`)}</small>
                      </button>
                    ))}
                  </div>

                  {draft.source === "template" ? (
                    <>
                      <div className="outbound-custom-fields">
                        {state.templates.status === "loading" && !state.templates.more ? <p className="page-subtitle" role="status">{t("content.templatesLoading")}</p> : null}
                        {state.templates.status === "failed" ? <div className="alert alert-error" role="alert">{t("content.templatesFailed")} {problemText(state.templates.problem)}</div> : null}
                        {state.templates.list && state.templates.channel === channel && state.templates.list.templates.length === 0 ? (
                          <div className="empty-state compact"><p>{t("content.templatesEmpty", { channel: t(`channels.${channel}`) })}</p></div>
                        ) : null}
                        {state.templates.list && state.templates.channel === channel && state.templates.list.templates.length > 0 ? (
                          <label>
                            <span>{t("content.templateLabel")}</span>
                            <select
                              value={template?.template_id ?? ""}
                              disabled={locked}
                              onChange={(event) => dispatch({ type: "templateChosen", templateId: event.target.value })}
                            >
                              <option value="" disabled>{t("content.chooseTemplate")}</option>
                              {state.templates.list.templates.map((item) => (
                                <option key={item.template_id} value={item.template_id}>
                                  {t("content.templateOption", { name: item.name, revision: item.revision })}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                        {state.templates.list?.next_cursor && state.templates.channel === channel ? (
                          <button
                            className="button button-secondary"
                            type="button"
                            disabled={state.templates.status === "loading"}
                            onClick={() => dispatch({ type: "templatesAsked", more: true })}
                          >{t("content.templatesMore")}</button>
                        ) : null}
                        {state.templates.status === "failed" ? (
                          <button className="button button-secondary" type="button" onClick={() => dispatch({ type: "templatesAsked", more: false })}>{t("retry")}</button>
                        ) : null}
                      </div>
                      {template ? (
                        <div className="outbound-template-card">
                          <div>
                            <span>{t("content.templateName")}</span>
                            <strong>{template.name}</strong>
                          </div>
                          <span className="badge">{t("content.revision", { revision: template.revision })}</span>
                          <p>{t("content.templateLocked")}</p>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="outbound-custom-fields">
                      {channel !== "sms" ? (
                        <label>
                          <span>{channel === "push" ? t("content.pushTitle") : t("content.subject")}</span>
                          <input
                            value={draft.subject}
                            maxLength={channel === "push" ? 80 : 200}
                            disabled={locked}
                            onChange={(event) => dispatch({ type: "fieldTyped", field: "subject", value: event.target.value })}
                          />
                        </label>
                      ) : null}
                      <label>
                        <span>{t("content.body")}</span>
                        <textarea
                          value={draft.body}
                          maxLength={channel === "email" ? 50_000 : channel === "sms" ? 1_600 : 1_000}
                          disabled={locked}
                          onChange={(event) => dispatch({ type: "fieldTyped", field: "body", value: event.target.value })}
                        />
                      </label>
                      <p className="field-hint">{t(`content.guidance.${channel}`)}</p>
                    </div>
                  )}
                </div>

                <aside className="outbound-content-preview" aria-label={t("content.previewLabel")}>
                  <div className="outbound-preview-heading">
                    <strong>{draft.source === "template" ? t("content.canonicalPreview") : t("content.draftPreview")}</strong>
                    <span className="badge">{t(`channels.${channel}`)}</span>
                  </div>
                  {contentPreview}
                </aside>
              </div>
            </section>

            <section className="outbound-section" aria-labelledby="outbound-confirm-title">
              <div className="outbound-section-heading">
                <div>
                  <span className="eyebrow">04</span>
                  <h3 id="outbound-confirm-title">{t("confirmation.title")}</h3>
                  <p>{t("confirmation.copy")}</p>
                </div>
              </div>
              <div className="outbound-confirm-grid">
                <label className="outbound-audit-field">
                  <span>{t("confirmation.auditReason")}</span>
                  <textarea
                    value={draft.auditReason}
                    maxLength={500}
                    disabled={locked}
                    onChange={(event) => dispatch({ type: "fieldTyped", field: "auditReason", value: event.target.value })}
                  />
                  <small>{t("confirmation.auditHint")}</small>
                </label>
                <div className="outbound-confirm-card">
                  <dl className="detail-list">
                    <div className="detail-row"><dt>{t("confirmation.recipient")}</dt><dd>{identity}</dd></div>
                    <div className="detail-row"><dt>{t("confirmation.channel")}</dt><dd>{t(`channels.${channel}`)}</dd></div>
                    <div className="detail-row"><dt>{t("confirmation.source")}</dt><dd>{template ? t("content.templateOption", { name: template.name, revision: template.revision }) : t(`content.sources.${draft.source}.title`)}</dd></div>
                    <div className="detail-row"><dt>{t("confirmation.availability")}</dt><dd>{previewLive && availabilityOf(channel)
                      ? <span className={`status-badge ${statusClass(availabilityOf(channel)!)}`}>{t(`availability.states.${availabilityOf(channel)}.label`)}</span>
                      : t("confirmation.availabilityUnknown")}</dd></div>
                  </dl>
                  <label className="checkbox-row outbound-partial-choice">
                    <input type="checkbox" checked={false} disabled readOnly />
                    <span><strong>{t("confirmation.allowPartial")}</strong><small>{t("confirmation.allowPartialCopy")}</small></span>
                  </label>
                  {state.notice ? <div className={`alert alert-${state.notice.tone}`} role="status">{noticeText(state.notice)}</div> : null}
                  <div className="outbound-confirm-actions">
                    <button
                      className="button button-primary"
                      type="button"
                      disabled={locked || state.confirming}
                      onClick={() => dispatch({ type: "reviewAsked", now: Date.now() })}
                    >{t("confirmation.review")}</button>
                  </div>
                </div>
              </div>
            </section>

            <section className="outbound-section" aria-labelledby="outbound-results-title">
              <div className="outbound-section-heading">
                <div>
                  <span className="eyebrow">05</span>
                  <h3 id="outbound-results-title">{t("results.title")}</h3>
                  <p>{t("results.copy")}</p>
                </div>
              </div>
              {command.status !== "idle" ? (
                <div className="outbound-confirm-card outbound-pending-card" role="status">
                  <strong>{command.status === "sending" ? t("results.sending") : t("results.doubt.title")}</strong>
                  <dl className="detail-list">
                    <div className="detail-row"><dt>{t("results.request")}</dt><dd><code>{command.pending.payload.request_id}</code></dd></div>
                    <div className="detail-row"><dt>{t("confirmation.channel")}</dt><dd>{t(`channels.${command.pending.payload.type}`)}</dd></div>
                    <div className="detail-row"><dt>{t("results.storedAt")}</dt><dd>{instant(command.pending.stored_at * 1000, true)}</dd></div>
                  </dl>
                  {command.status === "doubt" ? (
                    <>
                      <div className="alert alert-error">{t("results.doubt.copy")}{command.restored ? ` ${t("results.doubt.restored")}` : ""}</div>
                      {command.problem ? <p className="field-hint">{problemText(command.problem)}</p> : null}
                      <div className="outbound-confirm-actions">
                        <button className="button button-secondary" type="button" disabled={state.history.status === "loading"} onClick={() => dispatch({ type: "historyAsked", more: false })}>{t("results.doubt.checkHistory")}</button>
                        <button className="button button-primary" type="button" onClick={retrySend}>{t("results.doubt.retry")}</button>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : state.result?.replayed ? (
                // A replay is Core's record of the FIRST admission (`queued` even after delivery failed), never
                // news: the message's current state is its history row, which is read again after every send.
                <div className="outbound-result-guide">
                  <article>
                    <strong>{t("results.replayedTitle")}</strong>
                    <p>{t("results.replayedCopy")}</p>
                    <p>{replayedRow
                      ? <span className={`status-badge ${statusClass(replayedRow.status)}`}>{t(`history.statuses.${replayedRow.status}`)}</span>
                      : t("results.replayedReading")}</p>
                    <p><code>{state.result.request_id}</code></p>
                  </article>
                </div>
              ) : state.result ? (
                <div className="outbound-result-guide">
                  {state.result.results.map((row) => (
                    <article key={row.uid}>
                      <span className={`status-badge ${statusClass(row.outcome === "skipped" ? "skipped" : row.outcome)}`}>{t(`results.outcomes.${row.outcome}.label`)}</span>
                      <p>{t(`results.outcomes.${row.outcome}.copy`)}</p>
                      {row.reason ? <p>{t(`reasons.${row.reason}`)}</p> : null}
                      <p><code>{state.result!.request_id}</code></p>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="outbound-result-guide">
                  {OUTBOUND_MESSAGING_OUTCOMES.map((outcome) => (
                    <article key={outcome}>
                      <span className={`status-badge ${statusClass(outcome)}`}>{t(`results.outcomes.${outcome}.label`)}</span>
                      <p>{t(`results.outcomes.${outcome}.copy`)}</p>
                    </article>
                  ))}
                </div>
              )}
              <div className="alert alert-info">{t("results.recovery")}</div>
            </section>
          </>
        ) : null}

        {ready ? (
          <section className="outbound-section" aria-labelledby="outbound-history-title">
            <div className="outbound-section-heading">
              <div>
                <span className="eyebrow">{canSend ? "06" : "01"}</span>
                <h3 id="outbound-history-title">{t("history.title")}</h3>
                <p>{t("history.copy")}</p>
              </div>
              {history ? <span className="badge">{t("history.total", { count: history.total })}</span> : null}
            </div>
            {state.history.status === "loading" && !history ? <p className="page-subtitle" role="status">{t("history.loading")}</p> : null}
            {state.history.status === "failed" && !history ? (
              <>
                <div className="alert alert-error" role="alert">{t("history.failed")} {problemText(state.history.problem)}</div>
                <div className="outbound-confirm-actions">
                  <button className="button button-secondary" type="button" onClick={() => dispatch({ type: "historyAsked", more: false })}>{t("retry")}</button>
                </div>
              </>
            ) : null}
            {history && history.messages.length === 0 ? <div className="empty-state compact"><p>{t("history.empty")}</p></div> : null}
            {history && history.messages.length > 0 ? (
              <div className="outbound-history-layout">
                <div className="outbound-history-list">
                  {history.messages.map((row) => (
                    <button
                      type="button"
                      className={selectedId === row.message_id ? "active" : ""}
                      key={row.message_id}
                      aria-pressed={selectedId === row.message_id}
                      onClick={() => dispatch({ type: "rowChosen", messageId: row.message_id })}
                    >
                      <div>
                        <span className={`status-badge ${statusClass(row.status)}`}>{t(`history.statuses.${row.status}`)}</span>
                        <small>{t(`channels.${row.channel}`)} · {instant(row.created_at * 1000)}</small>
                      </div>
                      <strong>{row.subject || t("history.noSubject")}</strong>
                      <p>{row.body_excerpt}</p>
                    </button>
                  ))}
                  {state.history.status === "failed" ? <div className="alert alert-error" role="alert">{t("history.moreFailed")} {problemText(state.history.problem)}</div> : null}
                  {history.next_cursor ? (
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={state.history.status === "loading"}
                      onClick={() => dispatch({ type: "historyAsked", more: true })}
                    >{t("history.loadMore")}</button>
                  ) : null}
                </div>
                <article className="outbound-history-detail">
                  <div className="outbound-preview-heading">
                    <div><strong>{t("history.detailTitle")}</strong><small>{t("history.detailCopy")}</small></div>
                    {detail ? <span className="badge">{t(`channels.${detail.channel}`)}</span> : null}
                  </div>
                  {state.detail.status === "idle" ? <div className="empty-state compact"><p>{t("history.choose")}</p></div> : null}
                  {state.detail.status === "loading" ? <p className="page-subtitle" role="status">{t("history.detailLoading")}</p> : null}
                  {state.detail.status === "failed" ? <div className="alert alert-error" role="alert">{t("history.detailFailed")} {problemText(state.detail.problem)}</div> : null}
                  {detail ? (
                    <>
                      {detail.channel === "email" && historyEmailDocument ? (
                        <iframe
                          className="canned-email-frame"
                          sandbox=""
                          srcDoc={historyEmailDocument}
                          title={t("history.emailFrameTitle")}
                        />
                      ) : (
                        <div className="outbound-history-text">
                          {detail.subject ? <strong>{detail.subject}</strong> : null}
                          <p>{detail.body}</p>
                        </div>
                      )}
                      <dl className="detail-list outbound-history-meta">
                        <div className="detail-row"><dt>{t("history.status")}</dt><dd>{t(`history.statuses.${detail.status}`)}</dd></div>
                        {detail.status_reason ? <div className="detail-row"><dt>{t("history.reason")}</dt><dd>{t(`reasons.${detail.status_reason}`)}</dd></div> : null}
                        <div className="detail-row"><dt>{t("history.updated")}</dt><dd>{instant(detail.updated_at * 1000)}</dd></div>
                        <div className="detail-row"><dt>{t("history.actor")}</dt><dd>{detail.sent_by}</dd></div>
                        <div className="detail-row"><dt>{t("history.provenance")}</dt><dd>{detail.template ? t("history.templateRevision", { revision: detail.template.revision }) : t("history.custom")}</dd></div>
                        {detail.channel === "push" && detail.push_mode ? <div className="detail-row"><dt>{t("history.pushMode")}</dt><dd>{t(`history.pushModes.${detail.push_mode}`)}</dd></div> : null}
                        <div className="detail-row"><dt>{t("results.request")}</dt><dd><code>{detail.request_id}</code></dd></div>
                        <div className="detail-row"><dt>{t("history.integrity")}</dt><dd>{t("history.hashVerified")}</dd></div>
                      </dl>
                    </>
                  ) : null}
                </article>
              </div>
            ) : null}
          </section>
        ) : null}

        {ready ? (
          <section className="outbound-section outbound-privacy-section" aria-labelledby="outbound-privacy-title">
            <div className="outbound-section-heading">
              <div>
                <span className="eyebrow">{canSend ? "07" : "02"}</span>
                <h3 id="outbound-privacy-title">{t("privacy.title")}</h3>
                <p>{t("privacy.copy")}</p>
              </div>
            </div>
            <div className="outbound-privacy-grid">
              <article><strong>{t("privacy.sendTitle")}</strong><p>{canSend ? t("privacy.sendAvailable") : t("privacy.sendUnavailable")}</p></article>
              <article><strong>{t("privacy.historyTitle")}</strong><p>{t("privacy.historyAvailable")}</p></article>
              <article><strong>{t("privacy.templateTitle")}</strong><p>{t("privacy.templateSeparate")}</p></article>
            </div>
            <div className="alert alert-info">{t("privacy.withheld")}</div>
          </section>
        ) : null}
      </div>

      {state.confirming && canSend ? (
        <ConfirmDialog
          title={t("confirmation.dialogTitle")}
          copy={t("confirmation.dialogCopy")}
          confirmLabel={t("confirmation.send")}
          busyLabel={t("confirmation.sending")}
          busy={command.status === "sending"}
          tone="primary"
          confirmDisabled={locked}
          onCancel={() => dispatch({ type: "reviewClosed" })}
          onConfirm={confirmSend}
        >
          <dl className="detail-list outbound-confirm-summary">
            <div className="detail-row"><dt>{t("confirmation.recipient")}</dt><dd>{identity}</dd></div>
            <div className="detail-row"><dt>{t("confirmation.channel")}</dt><dd>{t(`channels.${channel}`)}{availabilityOf(channel) ? ` · ${t(`availability.states.${availabilityOf(channel)}.label`)}` : ""}</dd></div>
            <div className="detail-row"><dt>{t("confirmation.source")}</dt><dd>{template ? t("content.templateOption", { name: template.name, revision: template.revision }) : t("content.sources.custom.title")}</dd></div>
            {channel !== "sms" ? (
              <div className="detail-row">
                <dt>{channel === "push" ? t("content.pushTitle") : t("content.subject")}</dt>
                <dd>{template ? template.subject : draft.subject.trim()}</dd>
              </div>
            ) : null}
            <div className="detail-row"><dt>{t("confirmation.auditReason")}</dt><dd>{draft.auditReason.trim()}</dd></div>
            {preview ? <div className="detail-row"><dt>{t("preview.expires")}</dt><dd>{t("preview.validUntil", { time: instant(previewUntil, true) })}</dd></div> : null}
          </dl>
          <div className="outbound-content-preview outbound-confirm-content" aria-label={t("confirmation.content")}>
            {contentPreview}
          </div>
          {state.notice && state.notice.tone === "error" ? <p className="field-hint">{noticeText(state.notice)}</p> : null}
          <p className="field-hint">{t("confirmation.once")}</p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
