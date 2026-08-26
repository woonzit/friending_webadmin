"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { cannedTemplateEmailPreviewDocument } from "@/lib/cannedTemplates";
import {
  OUTBOUND_MESSAGING_AVAILABILITY,
  OUTBOUND_MESSAGING_CHANNELS,
  OUTBOUND_MESSAGING_OUTCOMES,
  outboundHistoryEmailPreviewDocument,
  outboundMessageDraftMaterial,
  outboundMessagingCanSend,
  type OutboundContentSource,
  type OutboundHistoryDetailEntry,
  type OutboundHistoryEntry,
  type OutboundMessageDraftMaterial,
  type OutboundMessagingChannel,
  type OutboundRecipientPreviewData,
} from "@/lib/outboundMessaging";

type DraftFields = {
  subject: string;
  body: string;
  auditReason: string;
  allowPartial: boolean;
};

type Notice = {
  tone: "info" | "error";
  text: string;
};

const TEMPLATE_IDS: Record<OutboundMessagingChannel, string> = {
  email: "65a000000000000000000001",
  sms: "65a000000000000000000002",
  push: "65a000000000000000000003",
};

const CONTENT_HASHES: Record<"en" | "hu", Record<OutboundMessagingChannel, string>> = {
  en: {
    email: "6ba3a6fed2a9e66abe4d0ddabe002b9f348bfbe839f29d692753d933a15a8a4e",
    sms: "45ed6730ce84efe91b1a5dc077773eb81d17ee77bb288fb078782f71ef9528a0",
    push: "7b7524c5e5451e46232b697cf1530bb8ec31511f3bf1c1fe9410705032d7e6c2",
  },
  hu: {
    email: "9e01814a95d651ea56b61b98741ef111c521532a4637b2878f20175e54ac2247",
    sms: "088e8177183909abecd4fb50e7358d0a815d2fc9e9c2e9278cd7b8a611e54336",
    push: "5774c624327ff89b87a6882dc396194b05805948066ac171e4c590cb81b80162",
  },
};

const FIXTURE_TIME = 1_787_680_000;

function statusClass(value: string): string {
  if (value === "available" || value === "sent") return "status-active";
  if (value === "queued" || value === "sending" || value === "retrying") return "status-info";
  if (value === "partially_sent" || value === "channel_absent" || value === "opted_out") {
    return "status-warning";
  }
  return "status-inactive";
}

function draftForChannel(
  channel: OutboundMessagingChannel,
  t: ReturnType<typeof useTranslations<"outboundMessaging">>,
): DraftFields {
  return {
    subject: channel === "sms" ? "" : t(`fixture.custom.${channel}.subject`),
    body: channel === "email"
      ? t.raw("fixture.custom.email.body")
      : t(`fixture.custom.${channel}.body`),
    auditReason: t("fixture.auditReason"),
    allowPartial: false,
  };
}

export default function OutboundMessagingPanel({
  uid,
  displayName,
  codename,
}: {
  uid: number;
  displayName: string;
  codename: string;
}) {
  const t = useTranslations("outboundMessaging");
  const locale = useLocale();
  const fixtureLocale = locale === "hu" ? "hu" : "en";
  const [channel, setChannel] = useState<OutboundMessagingChannel>("email");
  const [contentSource, setContentSource] = useState<OutboundContentSource>("template");
  const [draft, setDraft] = useState<DraftFields>(() => draftForChannel("email", t));
  const [validated, setValidated] = useState<OutboundMessageDraftMaterial | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState("64f000000000000000000001");

  const preview = useMemo<OutboundRecipientPreviewData>(() => ({
    contract_version: 1,
    principal: {
      role: "admin",
      capabilities: ["outbound_messages_history_read", "outbound_messages_send"],
    },
    preview_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    evaluated_at: FIXTURE_TIME,
    expires_at: FIXTURE_TIME + 300,
    requested_count: 1,
    recipients: [{
      uid,
      display_name: displayName,
      codename,
      channels: {
        email: "available",
        sms: "channel_absent",
        push: "opted_out",
      },
    }],
    limits: {
      max_recipients_per_request: 100,
      window_seconds: 300,
      overall: { limit: 500, used: 120, remaining: 380 },
      sms_push: { limit: 200, used: 44, remaining: 156 },
    },
  }), [codename, displayName, uid]);

  const history = useMemo<OutboundHistoryEntry[]>(() => [
    {
      message_id: "64f000000000000000000001",
      request_id: "123e4567-e89b-42d3-a456-426614174000",
      uid,
      channel: "email",
      format: "sanitized_html",
      subject: t("fixture.history.emailSubject"),
      body_excerpt: t("fixture.history.emailExcerpt"),
      content_sha256: CONTENT_HASHES[fixtureLocale].email,
      template: { template_id: TEMPLATE_IDS.email, revision: 3 },
      status: "sent",
      status_reason: null,
      push_mode: null,
      created_at: FIXTURE_TIME + 300,
      updated_at: FIXTURE_TIME + 310,
      completed_at: FIXTURE_TIME + 310,
      sent_by: "operator@example.test",
    },
    {
      message_id: "64f000000000000000000002",
      request_id: "223e4567-e89b-42d3-a456-426614174000",
      uid,
      channel: "push",
      format: "plain_text",
      subject: t("fixture.history.pushSubject"),
      body_excerpt: t("fixture.history.pushExcerpt"),
      content_sha256: CONTENT_HASHES[fixtureLocale].push,
      template: null,
      status: "partially_sent",
      status_reason: null,
      push_mode: "both",
      created_at: FIXTURE_TIME + 200,
      updated_at: FIXTURE_TIME + 220,
      completed_at: FIXTURE_TIME + 220,
      sent_by: "operator@example.test",
    },
    {
      message_id: "64f000000000000000000003",
      request_id: "323e4567-e89b-42d3-a456-426614174000",
      uid,
      channel: "sms",
      format: "plain_text",
      subject: "",
      body_excerpt: t("fixture.history.smsExcerpt"),
      content_sha256: CONTENT_HASHES[fixtureLocale].sms,
      template: null,
      status: "skipped",
      status_reason: "opted_out",
      push_mode: null,
      created_at: FIXTURE_TIME + 100,
      updated_at: FIXTURE_TIME + 100,
      completed_at: FIXTURE_TIME + 100,
      sent_by: "operator@example.test",
    },
  ], [fixtureLocale, t, uid]);

  const selectedHistory = history.find((row) => row.message_id === selectedHistoryId) ?? history[0];
  const historyDetail = useMemo<OutboundHistoryDetailEntry>(() => ({
    ...selectedHistory,
    body: selectedHistory.channel === "email"
      ? t.raw("fixture.history.emailBody")
      : selectedHistory.channel === "sms"
        ? t("fixture.history.smsBody")
        : t("fixture.history.pushBody"),
  }), [selectedHistory, t]);
  const historyEmailDocument = outboundHistoryEmailPreviewDocument(historyDetail);

  const template = useMemo(() => ({
    template_id: TEMPLATE_IDS[channel],
    revision: channel === "email" ? 3 : 1,
    subject: channel === "sms" ? "" : t(`fixture.templates.${channel}.subject`),
    body: channel === "email"
      ? t.raw("fixture.templates.email.body")
      : t(`fixture.templates.${channel}.body`),
  }), [channel, t]);
  const templateEmailDocument = channel === "email"
    ? cannedTemplateEmailPreviewDocument(template.body)
    : null;
  const selectedRecipient = preview.recipients[0];
  const localeName = locale === "hu" ? "hu-HU" : "en-US";

  function instant(value: number): string {
    return new Intl.DateTimeFormat(localeName, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value * 1000));
  }

  function switchChannel(value: OutboundMessagingChannel) {
    setChannel(value);
    setDraft(draftForChannel(value, t));
    setValidated(null);
    setNotice(null);
  }

  function switchSource(value: OutboundContentSource) {
    setContentSource(value);
    setValidated(null);
    setNotice(null);
  }

  function updateDraft(values: Partial<DraftFields>) {
    setDraft((current) => ({ ...current, ...values }));
    setValidated(null);
    setNotice(null);
  }

  function validateDraft() {
    const result = outboundMessageDraftMaterial({
      channel,
      contentSource,
      templateId: contentSource === "template" ? template.template_id : "",
      templateRevision: contentSource === "template" ? template.revision : 0,
      subject: contentSource === "template" ? "" : draft.subject,
      body: contentSource === "template" ? "" : draft.body,
      allowPartial: draft.allowPartial,
      auditReason: draft.auditReason,
    });
    if (!result.ok) {
      setValidated(null);
      setNotice({ tone: "error", text: t(`validation.${result.error}`) });
      return;
    }
    setValidated(result.value);
    setNotice({ tone: "info", text: t("notices.previewReady") });
  }

  return (
    <section className="panel outbound-messaging-panel">
      <div className="panel-header outbound-messaging-header">
        <div>
          <h2>{t("title")}</h2>
          <p>{t("copy")}</p>
        </div>
        <span className="status-badge status-warning">{t("localOnly")}</span>
      </div>
      <div className="panel-body outbound-messaging-body">
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
            <span className="badge">{t("preview.recipientCount", { count: preview.requested_count })}</span>
          </div>
          <div className="outbound-preview-grid">
            <article className="outbound-recipient-card">
              <div className="outbound-recipient-identity">
                <span aria-hidden="true">{(displayName || "?").slice(0, 1)}</span>
                <div>
                  <strong>{displayName || t("preview.unnamed")}</strong>
                  <small>{t("preview.uid", { uid })}{codename ? ` · @${codename}` : ""}</small>
                </div>
              </div>
              <div className="outbound-channel-statuses">
                {OUTBOUND_MESSAGING_CHANNELS.map((value) => (
                  <div key={value}>
                    <span>{t(`channels.${value}`)}</span>
                    <span className={`status-badge ${statusClass(selectedRecipient.channels[value])}`}>
                      {t(`availability.states.${selectedRecipient.channels[value]}.label`)}
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
                <strong>{t("preview.fiveMinutes")}</strong>
                <small>{instant(preview.expires_at)}</small>
              </article>
            </div>
          </div>
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
                onClick={() => switchChannel(value)}
              >{t(`channels.${value}`)}</button>
            ))}
          </div>
          <div className="outbound-content-grid">
            <div className="outbound-composer-column">
              <div className="outbound-source-options">
                {(["template", "custom"] as const).map((value) => (
                  <button
                    type="button"
                    className={contentSource === value ? "selected" : ""}
                    key={value}
                    aria-pressed={contentSource === value}
                    onClick={() => switchSource(value)}
                  >
                    <strong>{t(`content.sources.${value}.title`)}</strong>
                    <small>{t(`content.sources.${value}.copy`)}</small>
                  </button>
                ))}
              </div>

              {contentSource === "template" ? (
                <div className="outbound-template-card">
                  <div>
                    <span>{t("content.templateName")}</span>
                    <strong>{t(`fixture.templates.${channel}.name`)}</strong>
                  </div>
                  <span className="badge">{t("content.revision", { revision: template.revision })}</span>
                  <p>{t("content.templateLocked")}</p>
                </div>
              ) : (
                <div className="outbound-custom-fields">
                  {channel !== "sms" ? (
                    <label>
                      <span>{channel === "push" ? t("content.pushTitle") : t("content.subject")}</span>
                      <input
                        value={draft.subject}
                        maxLength={channel === "push" ? 80 : 200}
                        onChange={(event) => updateDraft({ subject: event.target.value })}
                      />
                    </label>
                  ) : null}
                  <label>
                    <span>{t("content.body")}</span>
                    <textarea
                      value={draft.body}
                      maxLength={channel === "email" ? 50_000 : channel === "sms" ? 1_600 : 1_000}
                      onChange={(event) => updateDraft({ body: event.target.value })}
                    />
                  </label>
                  <p className="field-hint">{t(`content.guidance.${channel}`)}</p>
                </div>
              )}
            </div>

            <aside className="outbound-content-preview" aria-label={t("content.previewLabel")}>
              <div className="outbound-preview-heading">
                <strong>{contentSource === "template" ? t("content.canonicalPreview") : t("content.draftPreview")}</strong>
                <span className="badge">{t(`channels.${channel}`)}</span>
              </div>
              {contentSource === "template" && channel === "email" && templateEmailDocument ? (
                <iframe
                  className="canned-email-frame"
                  sandbox=""
                  srcDoc={templateEmailDocument}
                  title={t("content.emailFrameTitle")}
                />
              ) : contentSource === "template" && channel === "sms" ? (
                <div className="canned-phone-preview"><div className="canned-sms-bubble">{template.body}</div></div>
              ) : contentSource === "template" ? (
                <div className="canned-push-preview"><span className="canned-push-app" aria-hidden="true">F</span><div><strong>{template.subject}</strong><p>{template.body}</p></div></div>
              ) : channel === "email" ? (
                <div className="outbound-email-source"><p>{t("content.emailSourceOnly")}</p><pre>{draft.body}</pre></div>
              ) : channel === "sms" ? (
                <div className="canned-phone-preview"><div className="canned-sms-bubble">{draft.body}</div></div>
              ) : (
                <div className="canned-push-preview"><span className="canned-push-app" aria-hidden="true">F</span><div><strong>{draft.subject}</strong><p>{draft.body}</p></div></div>
              )}
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
                onChange={(event) => updateDraft({ auditReason: event.target.value })}
              />
              <small>{t("confirmation.auditHint")}</small>
            </label>
            <div className="outbound-confirm-card">
              <dl className="detail-list">
                <div className="detail-row"><dt>{t("confirmation.recipient")}</dt><dd>{displayName || t("preview.unnamed")} · {t("preview.uid", { uid })}</dd></div>
                <div className="detail-row"><dt>{t("confirmation.channel")}</dt><dd>{t(`channels.${channel}`)}</dd></div>
                <div className="detail-row"><dt>{t("confirmation.source")}</dt><dd>{t(`content.sources.${contentSource}.title`)}</dd></div>
                <div className="detail-row"><dt>{t("confirmation.availability")}</dt><dd><span className={`status-badge ${statusClass(selectedRecipient.channels[channel])}`}>{t(`availability.states.${selectedRecipient.channels[channel]}.label`)}</span></dd></div>
              </dl>
              <label className="checkbox-row outbound-partial-choice">
                <input
                  type="checkbox"
                  checked={draft.allowPartial}
                  disabled={preview.requested_count === 1}
                  onChange={(event) => updateDraft({ allowPartial: event.target.checked })}
                />
                <span><strong>{t("confirmation.allowPartial")}</strong><small>{t("confirmation.allowPartialCopy")}</small></span>
              </label>
              {notice ? <div className={`alert alert-${notice.tone}`} role="status">{notice.text}</div> : null}
              <div className="outbound-confirm-actions">
                <button className="button button-secondary" type="button" onClick={validateDraft}>{t("confirmation.validate")}</button>
                <button className="button button-primary" type="button" disabled>{t("confirmation.sendUnavailable")}</button>
              </div>
              {validated ? <p className="field-hint">{t("confirmation.validated", { count: preview.requested_count })}</p> : null}
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
          <div className="outbound-result-guide">
            {OUTBOUND_MESSAGING_OUTCOMES.map((outcome) => (
              <article key={outcome}>
                <span className={`status-badge ${statusClass(outcome)}`}>{t(`results.outcomes.${outcome}.label`)}</span>
                <p>{t(`results.outcomes.${outcome}.copy`)}</p>
              </article>
            ))}
          </div>
          <div className="alert alert-info">{t("results.recovery")}</div>
        </section>

        <section className="outbound-section" aria-labelledby="outbound-history-title">
          <div className="outbound-section-heading">
            <div>
              <span className="eyebrow">06</span>
              <h3 id="outbound-history-title">{t("history.title")}</h3>
              <p>{t("history.copy")}</p>
            </div>
            <span className="badge">{t("history.total", { count: history.length })}</span>
          </div>
          <div className="outbound-history-layout">
            <div className="outbound-history-list">
              {history.map((row) => (
                <button
                  type="button"
                  className={selectedHistory.message_id === row.message_id ? "active" : ""}
                  key={row.message_id}
                  aria-pressed={selectedHistory.message_id === row.message_id}
                  onClick={() => setSelectedHistoryId(row.message_id)}
                >
                  <div>
                    <span className={`status-badge ${statusClass(row.status)}`}>{t(`history.statuses.${row.status}`)}</span>
                    <small>{t(`channels.${row.channel}`)} · {instant(row.created_at)}</small>
                  </div>
                  <strong>{row.subject || t("history.noSubject")}</strong>
                  <p>{row.body_excerpt}</p>
                </button>
              ))}
              <button className="button button-secondary" type="button" disabled>{t("history.loadMore")}</button>
            </div>
            <article className="outbound-history-detail">
              <div className="outbound-preview-heading">
                <div><strong>{t("history.detailTitle")}</strong><small>{t("history.detailCopy")}</small></div>
                <span className="badge">{t(`channels.${historyDetail.channel}`)}</span>
              </div>
              {historyDetail.channel === "email" && historyEmailDocument ? (
                <iframe
                  className="canned-email-frame"
                  sandbox=""
                  srcDoc={historyEmailDocument}
                  title={t("history.emailFrameTitle")}
                />
              ) : (
                <div className="outbound-history-text">
                  {historyDetail.subject ? <strong>{historyDetail.subject}</strong> : null}
                  <p>{historyDetail.body}</p>
                </div>
              )}
              <dl className="detail-list outbound-history-meta">
                <div className="detail-row"><dt>{t("history.status")}</dt><dd>{t(`history.statuses.${historyDetail.status}`)}</dd></div>
                <div className="detail-row"><dt>{t("history.updated")}</dt><dd>{instant(historyDetail.updated_at)}</dd></div>
                <div className="detail-row"><dt>{t("history.actor")}</dt><dd>{historyDetail.sent_by}</dd></div>
                <div className="detail-row"><dt>{t("history.provenance")}</dt><dd>{historyDetail.template ? t("history.templateRevision", { revision: historyDetail.template.revision }) : t("history.custom")}</dd></div>
                {historyDetail.channel === "push" && historyDetail.push_mode ? <div className="detail-row"><dt>{t("history.pushMode")}</dt><dd>{t(`history.pushModes.${historyDetail.push_mode}`)}</dd></div> : null}
                <div className="detail-row"><dt>{t("history.integrity")}</dt><dd>{t("history.hashVerified")}</dd></div>
                {historyDetail.status_reason ? <div className="detail-row"><dt>{t("history.reason")}</dt><dd>{t(`reasons.${historyDetail.status_reason}`)}</dd></div> : null}
              </dl>
            </article>
          </div>
        </section>

        <section className="outbound-section outbound-privacy-section" aria-labelledby="outbound-privacy-title">
          <div className="outbound-section-heading">
            <div>
              <span className="eyebrow">07</span>
              <h3 id="outbound-privacy-title">{t("privacy.title")}</h3>
              <p>{t("privacy.copy")}</p>
            </div>
          </div>
          <div className="outbound-privacy-grid">
            <article><strong>{t("privacy.sendTitle")}</strong><p>{outboundMessagingCanSend(preview.principal) ? t("privacy.sendAvailable") : t("privacy.sendUnavailable")}</p></article>
            <article><strong>{t("privacy.historyTitle")}</strong><p>{t("privacy.historyAvailable")}</p></article>
            <article><strong>{t("privacy.templateTitle")}</strong><p>{t("privacy.templateSeparate")}</p></article>
          </div>
          <div className="alert alert-info">{t("privacy.withheld")}</div>
        </section>
      </div>
    </section>
  );
}
