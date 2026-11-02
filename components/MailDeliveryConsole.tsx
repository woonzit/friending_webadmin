"use client";

import React, { useEffect, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import PageHeader from "@/components/PageHeader";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { formatDate, formatNumber } from "@/lib/format";
import {
  DEFAULT_MAIL_DELIVERY_FILTERS,
  MAIL_DELIVERY_DAYS,
  MAIL_DELIVERY_KINDS,
  MAIL_DELIVERY_STATES,
  mailDelivery,
  mailDeliveryAddress,
  mailDeliveryFailure,
  type MailDelivery,
  type MailDeliveryFailure,
  type MailDeliveryFilters,
  type MailDeliveryRow,
} from "@/lib/mailDelivery";

export type MailDeliveryLoad = "loading" | "ready" | MailDeliveryFailure;

const STATE_BADGE: Record<MailDeliveryRow["state"], string> = {
  delivered: "badge-active",
  pending: "badge-info",
  retrying: "badge-warning",
  failed: "mail-delivery-failed",
  not_sent: "badge-inactive",
};
/** An email Core took this long to hand to Mailgun shows its queue wait beside the delivery time. */
const QUEUE_NOTE_SECONDS = 5;

/** The page body for one read; pure, so every state renders in both locales in tests. */
export function MailDeliveryView({ data, load, filters, onFilters, onReload }: {
  data: MailDelivery | null;
  load: MailDeliveryLoad;
  filters: MailDeliveryFilters;
  onFilters: (next: MailDeliveryFilters) => void;
  onReload: () => void;
}) {
  const t = useTranslations("mailDelivery");
  const common = useTranslations("common");
  const locale = useLocale();
  const [address, setAddress] = useState(filters.email);
  const [addressInvalid, setAddressInvalid] = useState(false);
  const num = (value: number) => formatNumber(value, locale);
  const duration = (value: number | null): string => {
    if (value === null) return "—";
    if (value < 1) return t("duration.underSecond");
    const total = Math.round(value);
    if (total < 60) return t("duration.seconds", { s: num(total) });
    if (total < 3600) return t("duration.minutes", { m: num(Math.floor(total / 60)), s: num(total % 60) });
    return t("duration.hours", { h: num(Math.floor(total / 3600)), m: num(Math.floor((total % 3600) / 60)) });
  };
  const change = (next: Partial<MailDeliveryFilters>) => onFilters({ ...filters, ...next, page: next.page ?? 1 });
  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const canonical = address.trim() === "" ? "" : mailDeliveryAddress(address);
    setAddressInvalid(canonical === null);
    if (canonical !== null) change({ email: canonical });
  };
  const failure = load === "invalid" || load === "error" ? load : null;

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={<button className="button button-secondary" type="button" disabled={load === "loading"} onClick={onReload}>{common("refresh")}</button>}
      />
      <form className="filter-bar mail-delivery-filter-bar" onSubmit={search} noValidate>
        <label className="field">
          <span>{t("filters.period")}</span>
          <select value={filters.days} onChange={(event) => change({ days: Number(event.target.value) as MailDeliveryFilters["days"] })}>
            {MAIL_DELIVERY_DAYS.map((days) => <option key={days} value={days}>{t(`filters.days.${days}`)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t("filters.kind")}</span>
          <select value={filters.kind} onChange={(event) => change({ kind: event.target.value as MailDeliveryFilters["kind"] })}>
            <option value="">{t("filters.all")}</option>
            {MAIL_DELIVERY_KINDS.map((kind) => <option key={kind} value={kind}>{t(`kind.${kind}`)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t("filters.state")}</span>
          <select value={filters.state} onChange={(event) => change({ state: event.target.value as MailDeliveryFilters["state"] })}>
            <option value="">{t("filters.all")}</option>
            {MAIL_DELIVERY_STATES.map((state) => <option key={state} value={state}>{t(`stateFilter.${state}`)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t("filters.recipient")}</span>
          <input
            type="email"
            value={address}
            maxLength={254}
            placeholder={t("filters.recipientPlaceholder")}
            aria-invalid={addressInvalid || undefined}
            onChange={(event) => { setAddress(event.target.value); setAddressInvalid(false); }}
          />
          {addressInvalid ? <small className="field-error" role="alert">{t("filters.recipientInvalid")}</small> : null}
        </label>
        <div className="row-actions">
          <button className="button button-secondary" type="submit">{common("search")}</button>
          {filters.email ? (
            <button className="button button-secondary" type="button" onClick={() => { setAddress(""); setAddressInvalid(false); change({ email: "" }); }}>
              {t("filters.clearRecipient")}
            </button>
          ) : null}
        </div>
      </form>

      {failure ? <ErrorPanel message={t(`failures.${failure}`)} retry={onReload} /> : !data ? <LoadingPanel /> : (
        <div className={load === "loading" ? "mail-delivery-body is-refreshing" : "mail-delivery-body"}>
          {!data.can_see_addresses ? <p className="list-note">{t("maskedNote")}</p> : null}
          <section className="stat-grid mail-delivery-stats" aria-label={t("summaryLabel")}>
            {[
              { key: "total", label: t("cards.total"), value: num(data.summary.total) },
              { key: "delivered", label: t("cards.delivered"), value: num(data.summary.counts.delivered) },
              { key: "median", label: t("cards.median"), value: duration(data.summary.median_seconds) },
              { key: "p90", label: t("cards.p90"), value: duration(data.summary.p90_seconds) },
              { key: "slowest", label: t("cards.slowest"), value: duration(data.summary.max_seconds) },
              { key: "slow", label: t("cards.slow", { s: num(data.slow_seconds) }), value: num(data.summary.slow) },
              {
                key: "problems",
                label: t("cards.problems"),
                value: num(data.summary.counts.retrying + data.summary.counts.failed + data.summary.counts.not_sent),
              },
            ].map((card) => (
              <article className="stat-card" key={card.key}>
                <span className="stat-label">{card.label}</span>
                <strong className="stat-value">{card.value}</strong>
              </article>
            ))}
          </section>

          {data.summary.by_domain.length > 0 ? (
            <section className="panel mail-delivery-panel">
              <div className="panel-header"><div><h2>{t("byDomain.title")}</h2><p>{t("byDomain.subtitle")}</p></div></div>
              <div className="table-wrap mail-delivery-table">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t("byDomain.domain")}</th>
                      <th>{t("byDomain.total")}</th>
                      <th>{t("byDomain.delivered")}</th>
                      <th>{t("byDomain.median")}</th>
                      <th>{t("byDomain.slowest")}</th>
                      <th>{t("byDomain.slow")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.summary.by_domain.map((entry) => (
                      <tr key={entry.domain}>
                        <td>{entry.domain === "?" ? t("byDomain.unknown") : entry.domain}</td>
                        <td>{num(entry.total)}</td>
                        <td>{num(entry.delivered)}</td>
                        <td>{duration(entry.median_seconds)}</td>
                        <td>{duration(entry.max_seconds)}</td>
                        <td>{entry.slow > 0 ? <span className="badge badge-warning">{num(entry.slow)}</span> : num(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="panel mail-delivery-panel">
            <div className="panel-header">
              <div>
                <h2>{t("list.title")}</h2>
                <p>
                  {data.synced_at ? t("sync.synced", { time: formatDate(data.synced_at, locale, true) }) : t("sync.never")}
                  {data.sync_attempted_at && data.sync_attempted_at !== data.synced_at && data.sync_attempted_at !== data.sync_failed_at
                    ? ` ${t("sync.attempted", { time: formatDate(data.sync_attempted_at, locale, true) })}` : ""}
                </p>
              </div>
            </div>
            {data.sync_failed_at ? (
              <div className="alert alert-warning mail-delivery-sync-alert" role="status">
                {t("sync.failed", { time: formatDate(data.sync_failed_at, locale, true) })}
              </div>
            ) : null}
            {data.rows.length === 0 ? <EmptyPanel title={t("list.empty")} /> : (
              <div className="table-wrap mail-delivery-table">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t("list.created")}</th>
                      <th>{t("list.kind")}</th>
                      <th>{t("list.recipient")}</th>
                      <th>{t("list.delivery")}</th>
                      <th>{t("list.state")}</th>
                      <th>{t("list.issue")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => {
                      const queued = row.handed_at === null ? null : row.handed_at - row.created_at;
                      return (
                        <tr key={row.id}>
                          <td>{formatDate(row.created_at, locale, true)}</td>
                          <td>{t(`kind.${row.kind}`)}</td>
                          <td>{row.recipient || "—"}</td>
                          <td>
                            <span className="cell-stack">
                              {row.delivery_seconds === null ? <span>—</span> : (
                                <span className={row.delivery_seconds > data.slow_seconds ? "badge badge-warning" : undefined}>{duration(row.delivery_seconds)}</span>
                              )}
                              {row.delivery_attempts !== null && row.delivery_attempts > 1
                                ? <small>{t("list.attempts", { count: row.delivery_attempts })}</small> : null}
                              {queued !== null && queued >= QUEUE_NOTE_SECONDS ? <small>{t("list.queued", { time: duration(queued) })}</small> : null}
                            </span>
                          </td>
                          <td><span className={`badge ${STATE_BADGE[row.state]}`}>{t(`state.${row.state}`)}</span></td>
                          <td className="mail-delivery-issue">
                            <span className="cell-stack">
                              {row.issue ? (
                                <span>{row.issue.code !== null ? <code>{row.issue.code}</code> : null} {row.issue.message}</span>
                              ) : row.send_error ? <code>{row.send_error}</code> : <span>—</span>}
                              {row.temporary_failures > 0 ? <small>{t("list.refusals", { count: row.temporary_failures })}</small> : null}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="pagination mail-delivery-pagination">
              <span>{t("list.page", { page: num(data.page) })}</span>
              <div className="pagination-buttons">
                <button className="button button-secondary button-small" type="button" disabled={filters.page <= 1 || load === "loading"}
                  onClick={() => change({ page: filters.page - 1 })}>{common("previous")}</button>
                <button className="button button-secondary button-small" type="button" disabled={!data.has_more || load === "loading"}
                  onClick={() => change({ page: filters.page + 1 })}>{common("next")}</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

/** Email delivery: one read per filter change or refresh; never a recovery-loader registration. */
export default function MailDeliveryConsole() {
  const [filters, setFilters] = useState<MailDeliveryFilters>(DEFAULT_MAIL_DELIVERY_FILTERS);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<MailDelivery | null>(null);
  const [load, setLoad] = useState<MailDeliveryLoad>("loading");

  useEffect(() => {
    const controller = new AbortController();
    setLoad("loading");
    void adminCall("mail_delivery", { ...filters }, controller.signal).then((response) => {
      if (controller.signal.aborted) return;
      const parsed = mailDelivery(response, filters);
      setData(parsed);
      setLoad(parsed ? "ready" : mailDeliveryFailure(response));
    });
    return () => controller.abort();
  }, [filters, revision]);

  return (
    <MailDeliveryView
      data={data}
      load={load}
      filters={filters}
      // An answer belongs to its filters: the previous view is cleared, never shown under new ones.
      onFilters={(next) => { setData(null); setFilters(next); }}
      onReload={() => setRevision((value) => value + 1)}
    />
  );
}
