"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import FriendingGoCommandStatus, { FriendingGoDiscardDialog } from "@/components/FriendingGoCommandStatus";
import FriendingGoTabs from "@/components/FriendingGoTabs";
import PageHeader from "@/components/PageHeader";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { useFriendingGoAccess, useFriendingGoEmailCommand, type FriendingGoAccess } from "@/components/useFriendingGoEmailCommand";
import { useFriendingGoReasonList, type FriendingGoCommandView } from "@/components/FriendingGoEmailConsole";
import { adminCall } from "@/lib/adminClient";
import { cannedTemplateEmailPreviewDocument } from "@/lib/cannedTemplates";
import { formatDate, formatNumber } from "@/lib/format";
import {
  FRIENDINGGO_CAMPAIGN_STATES,
  FRIENDINGGO_DELIVERY_COUNT_KEYS,
  friendingGoCampaignDetail,
  friendingGoCampaigns,
  friendingGoErrorKey,
  friendingGoNotResumable,
  type FriendingGoCampaignDetail,
  type FriendingGoCampaignFilter,
  type FriendingGoCampaignList,
  type FriendingGoCampaignState,
  type FriendingGoDeliveryState,
  type FriendingGoListedCampaign,
} from "@/lib/friendinggo";
import type { FriendingGoPendingEmail, FriendingGoRunOutcome } from "@/lib/friendinggoConsole";
import { friendingGoReadFailure, FRIENDINGGO_STATUS_BADGE, type FriendingGoListLoad, type FriendingGoNotice } from "@/components/FriendingGoPreordersConsole";

const CAMPAIGN_STATE_BADGE: Record<FriendingGoCampaignState, string> = {
  draft: "badge-info",
  sending: "badge-warning",
  sent: "badge-active",
};

const DELIVERY_BADGE: Record<FriendingGoDeliveryState, string> = {
  delivered: "badge-active",
  pending: "badge-info",
  retrying: "badge-warning",
  failed: "friendinggo-badge-danger",
  not_sent: "badge-inactive",
};

/** A campaign's state badge: a `sending` campaign Core marks resumable is shown as stalled. */
function CampaignState({ campaign }: { campaign: Pick<FriendingGoListedCampaign, "state" | "resumable" | "progress"> }) {
  const t = useTranslations("friendinggo");
  const locale = useLocale();
  return (
    <span className="cell-stack">
      <span className={`badge ${campaign.resumable ? "friendinggo-badge-danger" : CAMPAIGN_STATE_BADGE[campaign.state]}`}>
        {campaign.resumable ? t("sent.stalled") : t(`campaignState.${campaign.state}`)}
      </span>
      {campaign.state === "sending" && campaign.progress ? (
        <small>{t("sent.list.progress", { processed: formatNumber(campaign.progress.processed, locale), total: formatNumber(campaign.progress.total, locale) })}</small>
      ) : null}
    </span>
  );
}

/** The campaign list; pure, so every state renders in both locales in tests. */
export function FriendingGoCampaignListView({
  data,
  load,
  page,
  state,
  canWrite,
  notice,
  command,
  onPage,
  onState,
  onReload,
  onOpen,
  onAskResume,
  onRetryPending,
  onAskDiscard,
}: {
  data: FriendingGoCampaignList | null;
  load: FriendingGoListLoad;
  page: number;
  /** Core's state filter: every campaign, or only drafts, sending or sent ones. */
  state: FriendingGoCampaignFilter;
  /** Core's `can_write` for this operator: "Finish sending" and Retry are offered only then. */
  canWrite: boolean;
  notice: FriendingGoNotice | null;
  command: FriendingGoCommandView;
  onPage: (page: number) => void;
  onState: (state: FriendingGoCampaignFilter) => void;
  onReload: () => void;
  onOpen: (campaign: FriendingGoListedCampaign) => void;
  onAskResume: (campaign: FriendingGoListedCampaign) => void;
  onRetryPending: () => void;
  onAskDiscard: () => void;
}) {
  const t = useTranslations("friendinggo");
  const common = useTranslations("common");
  const locale = useLocale();
  const num = (value: number) => formatNumber(value, locale);
  const failure = load === "invalid" || load === "unavailable" || load === "error" ? load : null;
  // "Finish sending" only for a writer, and only while this tab runs no other email command.
  const canResume = canWrite && !command.busy && command.pending === null;
  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("sent.title")}
        subtitle={t("sent.subtitle")}
        actions={<button className="button button-secondary" type="button" disabled={load === "loading"} onClick={onReload}>{common("refresh")}</button>}
      />
      {notice ? <div className={`alert alert-${notice.tone} page-alert`} role="status">{notice.text}</div> : null}
      <FriendingGoCommandStatus pending={command.pending} busy={command.busy} progress={command.progress} canRetry={canWrite && !command.busy}
        onRetry={onRetryPending} onAskDiscard={onAskDiscard} />
      <div className="filter-bar friendinggo-sent-filter">
        <label className="field">
          <span>{t("sent.filters.state")}</span>
          <select value={state} onChange={(event) => onState(event.target.value as FriendingGoCampaignFilter)}>
            <option value="">{t("sent.filters.all")}</option>
            {FRIENDINGGO_CAMPAIGN_STATES.map((value) => <option key={value} value={value}>{t(`campaignState.${value}`)}</option>)}
          </select>
        </label>
      </div>
      {failure ? <ErrorPanel message={t(`sent.failures.${failure}`)} retry={onReload} /> : !data ? <LoadingPanel /> : (
        <section className={load === "loading" ? "panel friendinggo-panel is-refreshing" : "panel friendinggo-panel"}>
          <div className="panel-header"><div><h2>{t("sent.list.title")}</h2><p>{t("sent.list.copy")}</p></div></div>
          {data.campaigns.some((campaign) => campaign.state === "sending") ? <p className="list-note friendinggo-sending-note">{t("sent.sendingNote")}</p> : null}
          {data.campaigns.length === 0 ? <EmptyPanel title={state ? t("sent.list.emptyFiltered") : t("sent.list.empty")} /> : (
            <div className="table-wrap friendinggo-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("sent.list.subject")}</th>
                    <th>{t("sent.list.kind")}</th>
                    <th>{t("sent.list.audience")}</th>
                    <th>{t("sent.list.sentBy")}</th>
                    <th>{t("sent.list.when")}</th>
                    <th>{t("sent.list.counts")}</th>
                    <th>{common("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.campaigns.map((campaign) => (
                    <tr key={campaign.id}>
                      <td>
                        <span className="cell-stack">
                          <strong>{campaign.subject}</strong>
                          {campaign.preheader ? <small>{campaign.preheader}</small> : null}
                        </span>
                      </td>
                      <td>
                        <span className="cell-stack">
                          <span>{t(`kind.${campaign.kind}`)}</span>
                          <CampaignState campaign={campaign} />
                        </span>
                      </td>
                      <td>{campaign.audience.mode === "all_active"
                        ? campaign.audience.count === null ? t("sent.audience.allActive") : t("sent.audience.allActiveCount", { count: campaign.audience.count })
                        : t("sent.audience.selected", { count: campaign.audience.count ?? 0 })}</td>
                      <td>{campaign.sent_by ?? campaign.created_by}</td>
                      <td>{formatDate(campaign.sent_at ?? campaign.updated_at, locale, true)}</td>
                      <td>{campaign.counts
                        ? t("sent.list.countsValue", { queued: num(campaign.counts.queued), suppressed: num(campaign.counts.suppressed) })
                        : "—"}</td>
                      <td>
                        <span className="row-actions">
                          <button className="button button-secondary button-small" type="button" onClick={() => onOpen(campaign)}>{common("view")}</button>
                          {campaign.state === "draft"
                            ? <Link className="button button-secondary button-small" href={`/friendinggo/email?draft=${campaign.id}`}>{t("sent.list.editDraft")}</Link> : null}
                          {campaign.resumable && canResume
                            ? <button className="button button-primary button-small" type="button" onClick={() => onAskResume(campaign)}>{t("sent.resume.button")}</button> : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="pagination friendinggo-pagination">
            <span>{t("page", { page: num(page) })}</span>
            <div className="pagination-buttons">
              <button className="button button-secondary button-small" type="button" disabled={page <= 1 || load === "loading"} onClick={() => onPage(page - 1)}>{common("previous")}</button>
              <button className="button button-secondary button-small" type="button" disabled={!data.has_more || load === "loading"} onClick={() => onPage(page + 1)}>{common("next")}</button>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

/** One campaign: its counts, its stored content and a page of recipients with their delivery state. */
export function FriendingGoCampaignDetailView({
  data,
  load,
  page,
  canWrite,
  notice,
  command,
  onPage,
  onReload,
  onBack,
  onAskResume,
  onRetryPending,
  onAskDiscard,
}: {
  data: FriendingGoCampaignDetail | null;
  load: FriendingGoListLoad;
  page: number;
  canWrite: boolean;
  notice: FriendingGoNotice | null;
  command: FriendingGoCommandView;
  onPage: (page: number) => void;
  onReload: () => void;
  onBack: () => void;
  onAskResume: (campaign: FriendingGoListedCampaign) => void;
  onRetryPending: () => void;
  onAskDiscard: () => void;
}) {
  const t = useTranslations("friendinggo");
  const common = useTranslations("common");
  const locale = useLocale();
  const reasonList = useFriendingGoReasonList();
  const num = (value: number) => formatNumber(value, locale);
  const failure = load === "invalid" || load === "unavailable" || load === "error" ? load : null;
  const campaign = data?.campaign ?? null;
  const contentDocument = campaign ? cannedTemplateEmailPreviewDocument(campaign.body_html) : null;
  const canResume = canWrite && !command.busy && command.pending === null;
  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={campaign?.subject ?? t("sent.detail.title")}
        subtitle={campaign ? t("sent.detail.subtitle", { kind: t(`kind.${campaign.kind}`), when: formatDate(campaign.sent_at ?? campaign.updated_at, locale, true) }) : t("sent.subtitle")}
        actions={(
          <>
            <button className="button button-secondary" type="button" onClick={onBack}>{t("sent.detail.back")}</button>
            <button className="button button-secondary" type="button" disabled={load === "loading"} onClick={onReload}>{common("refresh")}</button>
          </>
        )}
      />
      {notice ? <div className={`alert alert-${notice.tone} page-alert`} role="status">{notice.text}</div> : null}
      <FriendingGoCommandStatus pending={command.pending} busy={command.busy} progress={command.progress} canRetry={canWrite && !command.busy}
        onRetry={onRetryPending} onAskDiscard={onAskDiscard} />
      {failure ? <ErrorPanel message={t(`sent.failures.${failure}`)} retry={onReload} /> : !data || !campaign ? <LoadingPanel /> : (
        <div className={load === "loading" ? "friendinggo-body is-refreshing" : "friendinggo-body"}>
          {!data.can_see_addresses ? <p className="list-note friendinggo-read-only">{t("maskedNote")}</p> : null}
          {campaign.state === "sending" ? (
            <div className="alert alert-warning page-alert friendinggo-sending-note" role="status">
              <span>{campaign.resumable ? t("sent.detail.stalledNote") : t("sent.sendingNote")}</span>
              {campaign.resumable && canResume
                ? <button className="button button-primary button-small" type="button" onClick={() => onAskResume(campaign)}>{t("sent.resume.button")}</button> : null}
            </div>
          ) : null}
          <dl className="detail-list compact friendinggo-envelope">
            <div className="detail-row"><dt>{t("sent.detail.state")}</dt><dd><CampaignState campaign={campaign} /></dd></div>
            <div className="detail-row"><dt>{t("email.composer.preheader")}</dt><dd>{campaign.preheader || "—"}</dd></div>
            <div className="detail-row"><dt>{t("sent.detail.createdBy")}</dt><dd>{campaign.created_by} · {formatDate(campaign.created_at, locale, true)}</dd></div>
            <div className="detail-row"><dt>{t("sent.list.sentBy")}</dt><dd>{campaign.sent_by ? `${campaign.sent_by} · ${formatDate(campaign.sent_at, locale, true)}` : "—"}</dd></div>
            <div className="detail-row"><dt>{t("sent.list.audience")}</dt><dd>{campaign.audience.mode === "all_active"
              ? t("sent.audience.allActive") : t("sent.audience.selected", { count: campaign.audience.count ?? 0 })}</dd></div>
          </dl>

          {campaign.counts ? (
            <>
              <section className="stat-grid friendinggo-stats" aria-label={t("sent.detail.countsLabel")}>
                {([["selected", campaign.counts.selected], ["queued", campaign.counts.queued], ["suppressed", campaign.counts.suppressed]] as const).map(([key, value]) => (
                  <article className="stat-card" key={key}>
                    <span className="stat-label">{t(`sent.counts.${key}`)}</span>
                    <strong className="stat-value">{num(value)}</strong>
                  </article>
                ))}
              </section>
              {campaign.counts.suppressed > 0
                ? <p className="field-hint friendinggo-left-out">{t("email.preview.leftOutBy", { reasons: reasonList(campaign.counts.suppressed_by_reason) })}</p> : null}
              <section className="stat-grid friendinggo-delivery-stats" aria-label={t("sent.detail.deliveryLabel")}>
                {FRIENDINGGO_DELIVERY_COUNT_KEYS.map((key) => (
                  <article className="stat-card" key={key}>
                    <span className="stat-label">{t(`delivery.${key}`)}</span>
                    <strong className="stat-value">{num(data.delivery_counts[key])}</strong>
                  </article>
                ))}
              </section>
            </>
          ) : <p className="list-note">{t("sent.detail.draftNote")}</p>}

          <details className="panel friendinggo-content">
            <summary>{t("sent.detail.content")}</summary>
            <div className="panel-body">
              {contentDocument
                ? <iframe className="friendinggo-email-frame is-content" sandbox="" srcDoc={contentDocument} title={t("sent.detail.contentFrame", { subject: campaign.subject })} />
                : <pre className="friendinggo-source">{campaign.body_html}</pre>}
              <p className="field-hint">{t("sent.detail.contentHint")}</p>
            </div>
          </details>

          <section className="panel friendinggo-panel">
            <div className="panel-header"><div><h2>{t("sent.recipients.title")}</h2><p>{t("sent.recipients.copy")}</p></div></div>
            {data.recipients.length === 0 ? <EmptyPanel title={t("sent.recipients.empty")} /> : (
              <div className="table-wrap friendinggo-table">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t("preorders.list.name")}</th>
                      <th>{t("preorders.list.email")}</th>
                      <th>{t("sent.recipients.state")}</th>
                      <th>{t("sent.recipients.delivery")}</th>
                      <th>{t("sent.recipients.deliveredAt")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recipients.map((recipient) => (
                      <tr key={recipient.preorder_id}>
                        <td>{recipient.name || "—"}</td>
                        <td>{recipient.email}</td>
                        <td>
                          {recipient.state === "queued"
                            ? <span className="badge badge-active">{t("sent.recipients.queued")}</span>
                            : (
                              <span className="cell-stack">
                                <span className="badge badge-inactive">{t("sent.recipients.suppressed")}</span>
                                {recipient.suppressed_reason ? (
                                  <small><span className={`badge ${FRIENDINGGO_STATUS_BADGE[recipient.suppressed_reason]}`}>{t(`status.${recipient.suppressed_reason}`)}</span></small>
                                ) : null}
                              </span>
                            )}
                        </td>
                        <td>{recipient.delivery_state
                          ? <span className={`badge ${DELIVERY_BADGE[recipient.delivery_state]}`}>{t(`delivery.${recipient.delivery_state}`)}</span>
                          : recipient.state === "queued" ? <small>{t("delivery.purged")}</small> : "—"}</td>
                        <td>{recipient.delivered_at !== null ? formatDate(recipient.delivered_at, locale, true) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="pagination friendinggo-pagination">
              <span>{t("page", { page: num(page) })}</span>
              <div className="pagination-buttons">
                <button className="button button-secondary button-small" type="button" disabled={page <= 1 || load === "loading"} onClick={() => onPage(page - 1)}>{common("previous")}</button>
                <button className="button button-secondary button-small" type="button" disabled={!data.has_more || load === "loading"} onClick={() => onPage(page + 1)}>{common("next")}</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

/** The resume confirmation: what will be finished, and that nobody is mailed twice. */
export function FriendingGoResumeDialog({ campaign, onCancel, onConfirm }: {
  campaign: Pick<FriendingGoListedCampaign, "subject" | "progress">;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("friendinggo");
  const locale = useLocale();
  return (
    <ConfirmDialog
      title={t("sent.resume.title")}
      copy={t("sent.resume.copy", {
        subject: campaign.subject,
        processed: formatNumber(campaign.progress?.processed ?? 0, locale),
        total: formatNumber(campaign.progress?.total ?? 0, locale),
      })}
      confirmLabel={t("sent.resume.confirm")}
      tone="primary"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

/**
 * Sent: the campaign list, one campaign's recipients page by page, and "Finish sending" for a stalled send
 * (Core round 3 `mode=resume`): a fresh request id, then the same id repeated until the campaign is `sent`,
 * through the tab's one email command (the Email tab's runner, guard and storage).
 */
export default function FriendingGoSentConsole() {
  const t = useTranslations("friendinggo");
  const locale = useLocale();
  const access: FriendingGoAccess = useFriendingGoAccess();
  const [page, setPage] = useState(1);
  const [state, setState] = useState<FriendingGoCampaignFilter>("");
  const [revision, setRevision] = useState(0);
  const [list, setList] = useState<FriendingGoCampaignList | null>(null);
  const [listLoad, setListLoad] = useState<FriendingGoListLoad>("loading");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detailPage, setDetailPage] = useState(1);
  const [detail, setDetail] = useState<FriendingGoCampaignDetail | null>(null);
  const [detailLoad, setDetailLoad] = useState<FriendingGoListLoad>("loading");
  const [notice, setNotice] = useState<FriendingGoNotice | null>(null);
  const [resume, setResume] = useState<FriendingGoListedCampaign | null>(null);
  const [discarding, setDiscarding] = useState(false);

  const onOutcome = (outcome: Exclude<FriendingGoRunOutcome, { kind: "left" }>, _stored: FriendingGoPendingEmail) => {
    setRevision((value) => value + 1);
    if (outcome.kind === "done") {
      const result = outcome.result;
      setNotice({
        tone: "success",
        text: result.mode === "resume" || result.mode === "send"
          ? t("sent.resume.done", { subject: result.campaign.subject, total: formatNumber(result.progress.total, locale) })
          : result.mode === "test" ? t("email.notices.test", { to: result.to }) : t("email.notices.draftSaved", { subject: result.campaign.subject }),
      });
    } else if (outcome.kind === "paused") {
      setNotice({ tone: "warning", text: t("email.pending.paused", { processed: formatNumber(outcome.progress.processed, locale), total: formatNumber(outcome.progress.total, locale) }) });
    } else if (outcome.kind === "unknown") {
      setNotice({ tone: "warning", text: t("email.pending.stillSending") });
    } else if (outcome.error === "go-campaign-not-resumable") {
      // Final for its request id: the next "Finish sending" draws a new one.
      const wait = friendingGoNotResumable(outcome.response);
      setNotice({ tone: "warning", text: wait?.retry_after_seconds ? t("sent.resume.notYet", { seconds: formatNumber(wait.retry_after_seconds, locale) }) : t("sent.resume.notSending") });
    } else {
      setNotice({ tone: "error", text: t(`errors.${friendingGoErrorKey(outcome.error)}`) });
    }
  };
  const command = useFriendingGoEmailCommand(onOutcome, {
    confirm: t("navigation.confirm"), history: t("navigation.history"), title: t("navigation.title"), leave: t("navigation.leave"),
  });
  const canWrite = access.load === "ready" && access.canWrite;
  const canResume = canWrite && !command.busy && command.pending === null;

  useEffect(() => {
    if (openId !== null) return;
    const controller = new AbortController();
    setListLoad("loading");
    void adminCall("go_email_campaigns", { page, ...(state ? { state } : {}) }, controller.signal).then((response) => {
      if (controller.signal.aborted) return;
      const parsed = friendingGoCampaigns(response, page, state);
      setList(parsed);
      setListLoad(parsed ? "ready" : friendingGoReadFailure(response));
    });
    return () => controller.abort();
  }, [page, state, revision, openId]);

  useEffect(() => {
    if (openId === null) return;
    const controller = new AbortController();
    setDetailLoad("loading");
    void adminCall("go_email_campaigns", { campaign_id: openId, page: detailPage }, controller.signal).then((response) => {
      if (controller.signal.aborted) return;
      const parsed = friendingGoCampaignDetail(response, openId, detailPage);
      setDetail(parsed);
      setDetailLoad(parsed ? "ready" : friendingGoReadFailure(response));
    });
    return () => controller.abort();
  }, [openId, detailPage, revision]);

  function confirmResume() {
    const campaign = resume;
    setResume(null);
    if (!campaign || !canResume) return;
    setNotice(null);
    // A fresh request id for every "Finish sending"; it is stored before it leaves and then repeated until `sent`.
    if (!command.start({ mode: "resume", campaign_id: campaign.id, request_id: crypto.randomUUID() })) {
      setNotice({ tone: "error", text: t("errors.storageUnavailable") });
    }
  }

  const commandView = { pending: command.pending, busy: command.busy, progress: command.progress };
  return (
    <>
      <FriendingGoTabs />
      {openId === null ? (
        <FriendingGoCampaignListView
          data={list}
          load={listLoad}
          page={page}
          state={state}
          canWrite={canWrite}
          notice={notice}
          command={commandView}
          onPage={(next) => { setList(null); setPage(next); }}
          // An answer belongs to its filter: the previous list is cleared, never shown under another one.
          onState={(next) => { setList(null); setPage(1); setState(next); }}
          onReload={() => setRevision((value) => value + 1)}
          onOpen={(campaign) => { setDetail(null); setDetailPage(1); setOpenId(campaign.id); }}
          onAskResume={(campaign) => { if (canResume) setResume(campaign); }}
          onRetryPending={command.retry}
          onAskDiscard={() => setDiscarding(true)}
        />
      ) : (
        <FriendingGoCampaignDetailView
          data={detail}
          load={detailLoad}
          page={detailPage}
          canWrite={canWrite}
          notice={notice}
          command={commandView}
          onPage={(next) => { setDetail(null); setDetailPage(next); }}
          onReload={() => setRevision((value) => value + 1)}
          onBack={() => { setOpenId(null); setDetail(null); }}
          onAskResume={(campaign) => { if (canResume) setResume(campaign); }}
          onRetryPending={command.retry}
          onAskDiscard={() => setDiscarding(true)}
        />
      )}
      {resume ? <FriendingGoResumeDialog campaign={resume} onCancel={() => setResume(null)} onConfirm={confirmResume} /> : null}
      {discarding && command.pending ? (
        <FriendingGoDiscardDialog pending={command.pending} onCancel={() => setDiscarding(false)}
          onConfirm={() => { setDiscarding(false); command.discard(); setNotice({ tone: "info", text: t("pending.discarded") }); setRevision((value) => value + 1); }} />
      ) : null}
    </>
  );
}
