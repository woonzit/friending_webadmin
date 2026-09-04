"use client";

import React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { formatDate, formatNumber } from "@/lib/format";
import {
  INVITE_ATTRIBUTION_CHANNELS,
  inviteConversionRate,
  type InviteAttributionSummary,
} from "@/lib/inviteConfiguration";

/**
 * D-124 point 3 / D-126. The read-only "Invite results" panel on the mobile invites console.
 *
 * It renders Core's `attribution` summary and nothing else: no control here writes, and
 * `inviteSaveBody()` never serialises the block, so the save/discard/conflict flow is untouched.
 *
 * The three states are deliberate. `null` — the whole summary is absent, `null` or malformed —
 * prints ONE muted line rather than an `ErrorPanel`, because statistics must never take the
 * configuration form down. An empty `senders` array is a real answer ("nothing recorded yet"), not
 * a failure, and is rendered as such. `truncated` says out loud that the table is a page and the
 * totals are the whole collection.
 *
 * Counts only. Core never serves a phone number, a phone hash or a converted member's uid, so
 * nothing here can print one.
 */
export function InviteAttributionPanel({ attribution }: { attribution: InviteAttributionSummary | null }) {
  const t = useTranslations("inviteConfiguration.attribution");
  const locale = useLocale();

  const percent = (recorded: number, converted: number): string => {
    const rate = inviteConversionRate(recorded, converted);
    if (rate === null) return "—";
    return new Intl.NumberFormat(locale === "hu" ? "hu-HU" : "en-US", {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(rate);
  };

  return (
    <section className="panel invite-config-panel invite-attribution-panel" aria-labelledby="invite-attribution-title">
      <div className="panel-header">
        <div><h2 id="invite-attribution-title">{t("title")}</h2><p>{t("copy")}</p></div>
      </div>
      {attribution === null ? (
        <div className="panel-body invite-attribution-body" data-invite-attribution="unavailable">
          <p className="invite-attribution-unavailable">{t("unavailable")}</p>
        </div>
      ) : (
        <div
          className="panel-body invite-attribution-body"
          data-invite-attribution={attribution.senders.length === 0 ? "empty" : "populated"}
        >
          <div className="stat-grid invite-attribution-tiles">
            <article className="stat-card" data-invite-tile="recorded">
              <span className="stat-label">{t("tiles.recorded")}</span>
              <span className="stat-value">{formatNumber(attribution.totals.recorded, locale)}</span>
            </article>
            <article className="stat-card green" data-invite-tile="converted">
              <span className="stat-label">{t("tiles.converted")}</span>
              <span className="stat-value">{formatNumber(attribution.totals.converted, locale)}</span>
              <span className="stat-meta">{t("convertedMembers", { count: attribution.totals.converted_members })}</span>
            </article>
            <article className="stat-card pink" data-invite-tile="rate">
              <span className="stat-label">{t("tiles.rate")}</span>
              <span className="stat-value">{percent(attribution.totals.recorded, attribution.totals.converted)}</span>
            </article>
            <article className="stat-card" data-invite-tile="senders">
              <span className="stat-label">{t("tiles.senders")}</span>
              <span className="stat-value">{formatNumber(attribution.totals.senders, locale)}</span>
            </article>
            <article className="stat-card" data-invite-tile="expiring">
              <span className="stat-label">{t("tiles.expiring")}</span>
              <span className="stat-value">{formatNumber(attribution.totals.expiring_within_7d, locale)}</span>
            </article>
          </div>

          <div className="invite-attribution-channels">
            <h3>{t("channels.title")}</h3>
            {INVITE_ATTRIBUTION_CHANNELS.map((channel) => {
              const counts = attribution.totals.by_channel[channel];
              return (
                <p className="invite-attribution-channel" data-invite-channel={channel} key={channel}>
                  <strong>{t(`channels.${channel}`)}</strong>
                  <span>{formatNumber(counts.recorded, locale)} {t("channels.recorded")}</span>
                  <span>{formatNumber(counts.converted, locale)} {t("channels.converted")}</span>
                  <span>{formatNumber(counts.expiring_within_7d, locale)} {t("channels.expiring")}</span>
                </p>
              );
            })}
          </div>

          <div className="invite-attribution-senders">
            <h3>{t("table.title")}</h3>
            {attribution.senders.length === 0 ? (
              <div className="empty-state-inner"><h3>{t("empty")}</h3></div>
            ) : (
              <>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">{t("table.sender")}</th>
                        <th scope="col">{t("table.uid")}</th>
                        <th scope="col">{t("table.recorded")}</th>
                        <th scope="col">{t("table.converted")}</th>
                        <th scope="col">{t("table.lastConversion")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attribution.senders.map((sender) => (
                        <tr data-invite-sender-uid={sender.uid} key={sender.uid}>
                          <td data-label={t("table.sender")}>
                            {/* An erased account leaves the row and an empty name; the uid is then
                                the only honest label, and it still opens the member page. */}
                            <Link href={`/users/${sender.uid}`}>{sender.display_name || String(sender.uid)}</Link>
                          </td>
                          <td data-label={t("table.uid")}><code>{sender.uid}</code></td>
                          <td data-label={t("table.recorded")}>{formatNumber(sender.recorded, locale)}</td>
                          <td data-label={t("table.converted")}>{formatNumber(sender.converted, locale)}</td>
                          <td data-label={t("table.lastConversion")}>{formatDate(sender.last_converted_at, locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {attribution.truncated && (
                  <p className="field-hint invite-attribution-truncated">{t("truncated", { limit: attribution.limit })}</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default InviteAttributionPanel;
