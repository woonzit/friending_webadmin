"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import FriendingGoTabs from "@/components/FriendingGoTabs";
import PageHeader from "@/components/PageHeader";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { cannedTemplateEmailPreviewDocument } from "@/lib/cannedTemplates";
import { formatDate, formatNumber } from "@/lib/format";
import {
  FRIENDINGGO_DELIVERY_COUNT_KEYS,
  FRIENDINGGO_SUPPRESSION_REASONS,
  friendingGoCampaignDetail,
  friendingGoCampaigns,
  type FriendingGoCampaign,
  type FriendingGoCampaignDetail,
  type FriendingGoCampaignList,
  type FriendingGoCampaignState,
  type FriendingGoDeliveryState,
} from "@/lib/friendinggo";
import { friendingGoReadFailure, FRIENDINGGO_STATUS_BADGE, type FriendingGoListLoad } from "@/components/FriendingGoPreordersConsole";

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

/** The campaign list; pure, so every state renders in both locales in tests. */
export function FriendingGoCampaignListView({
  data,
  load,
  page,
  onPage,
  onReload,
  onOpen,
}: {
  data: FriendingGoCampaignList | null;
  load: FriendingGoListLoad;
  page: number;
  onPage: (page: number) => void;
  onReload: () => void;
  onOpen: (campaign: FriendingGoCampaign) => void;
}) {
  const t = useTranslations("friendinggo");
  const common = useTranslations("common");
  const locale = useLocale();
  const num = (value: number) => formatNumber(value, locale);
  const failure = load === "invalid" || load === "unavailable" || load === "error" ? load : null;
  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("sent.title")}
        subtitle={t("sent.subtitle")}
        actions={<button className="button button-secondary" type="button" disabled={load === "loading"} onClick={onReload}>{common("refresh")}</button>}
      />
      {failure ? <ErrorPanel message={t(`sent.failures.${failure}`)} retry={onReload} /> : !data ? <LoadingPanel /> : (
        <section className={load === "loading" ? "panel friendinggo-panel is-refreshing" : "panel friendinggo-panel"}>
          <div className="panel-header"><div><h2>{t("sent.list.title")}</h2><p>{t("sent.list.copy")}</p></div></div>
          {data.campaigns.length === 0 ? <EmptyPanel title={t("sent.list.empty")} /> : (
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
                          <span className={`badge ${CAMPAIGN_STATE_BADGE[campaign.state]}`}>{t(`campaignState.${campaign.state}`)}</span>
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
  onPage,
  onReload,
  onBack,
}: {
  data: FriendingGoCampaignDetail | null;
  load: FriendingGoListLoad;
  page: number;
  onPage: (page: number) => void;
  onReload: () => void;
  onBack: () => void;
}) {
  const t = useTranslations("friendinggo");
  const common = useTranslations("common");
  const locale = useLocale();
  const num = (value: number) => formatNumber(value, locale);
  const failure = load === "invalid" || load === "unavailable" || load === "error" ? load : null;
  const campaign = data?.campaign ?? null;
  const contentDocument = campaign ? cannedTemplateEmailPreviewDocument(campaign.body_html) : null;
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
      {failure ? <ErrorPanel message={t(`sent.failures.${failure}`)} retry={onReload} /> : !data || !campaign ? <LoadingPanel /> : (
        <div className={load === "loading" ? "friendinggo-body is-refreshing" : "friendinggo-body"}>
          {!data.can_see_addresses ? <p className="list-note friendinggo-read-only">{t("maskedNote")}</p> : null}
          <dl className="detail-list compact friendinggo-envelope">
            <div className="detail-row"><dt>{t("sent.detail.state")}</dt><dd><span className={`badge ${CAMPAIGN_STATE_BADGE[campaign.state]}`}>{t(`campaignState.${campaign.state}`)}</span></dd></div>
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
              {campaign.counts.suppressed_by_reason ? (
                <p className="field-hint">{t("email.preview.leftOutBy", {
                  reasons: FRIENDINGGO_SUPPRESSION_REASONS.filter((reason) => campaign.counts!.suppressed_by_reason![reason] > 0)
                    .map((reason) => t("email.preview.leftOutReason", { count: campaign.counts!.suppressed_by_reason![reason], status: t(`status.${reason}`) })).join(", "),
                })}</p>
              ) : null}
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

/** Sent: the campaign list, and one campaign's recipients page by page. Reads only. */
export default function FriendingGoSentConsole() {
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [list, setList] = useState<FriendingGoCampaignList | null>(null);
  const [listLoad, setListLoad] = useState<FriendingGoListLoad>("loading");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detailPage, setDetailPage] = useState(1);
  const [detail, setDetail] = useState<FriendingGoCampaignDetail | null>(null);
  const [detailLoad, setDetailLoad] = useState<FriendingGoListLoad>("loading");

  useEffect(() => {
    if (openId !== null) return;
    const controller = new AbortController();
    setListLoad("loading");
    void adminCall("go_email_campaigns", { page }, controller.signal).then((response) => {
      if (controller.signal.aborted) return;
      const parsed = friendingGoCampaigns(response, page);
      setList(parsed);
      setListLoad(parsed ? "ready" : friendingGoReadFailure(response));
    });
    return () => controller.abort();
  }, [page, revision, openId]);

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

  return (
    <>
      <FriendingGoTabs />
      {openId === null ? (
        <FriendingGoCampaignListView
          data={list}
          load={listLoad}
          page={page}
          onPage={(next) => { setList(null); setPage(next); }}
          onReload={() => setRevision((value) => value + 1)}
          onOpen={(campaign) => { setDetail(null); setDetailPage(1); setOpenId(campaign.id); }}
        />
      ) : (
        <FriendingGoCampaignDetailView
          data={detail}
          load={detailLoad}
          page={detailPage}
          onPage={(next) => { setDetail(null); setDetailPage(next); }}
          onReload={() => setRevision((value) => value + 1)}
          onBack={() => { setOpenId(null); setDetail(null); }}
        />
      )}
    </>
  );
}
