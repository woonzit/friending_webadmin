"use client";

// P-074: the read-only moderation insight on the member page. It holds sign-in
// addresses (IP) and the accounts that share them, so it is collapsed by
// default, fetched only when an operator opens it, dropped from memory again
// when it is closed, and never logged, stored or sent anywhere but the screen.
// It loads on its own: a failure here never hides the rest of the member page.

import Link from "next/link";
// The explicit React import keeps the view renderable by the node test runner (classic JSX).
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { adminCall } from "@/lib/adminClient";
import { formatDate } from "@/lib/format";
import {
  INSIGHT_PLATFORMS,
  userModerationInsight,
  type InsightGeo,
  type InsightTag,
  type UserModerationInsight as Insight,
} from "@/lib/userModerationInsight";

function place(geo: InsightGeo | null): string {
  return geo ? [geo.city, geo.country || geo.country_code].filter(Boolean).join(", ") : "";
}

/** The parsed insight as the panel shows it. Pure: no fetch, no state. */
export function UserModerationInsightView({ data }: { data: Insight }) {
  const t = useTranslations("userInsight");
  const locale = useLocale();
  const when = (seconds: number) => (seconds > 0 ? formatDate(seconds, locale, true) : t("unknown"));
  const platform = (value: Insight["signup"]["platform"]) => t(`platforms.${value}`);
  const address = (value: string) => (value ? <code>{value}</code> : t("unknown"));
  const chips = (items: InsightTag[]) => items.length > 0 ? (
    <span className="tag-list">
      {items.map((item) => (
        <span className={`tag${item.named ? "" : " insight-tag-raw"}`} key={item.key} title={item.named ? undefined : t("rawKey")}>
          {item.name}
        </span>
      ))}
    </span>
  ) : t("none");

  return (
    <div className="insight-body">
      {data.flags.length > 0 ? (
        <ul className="insight-flags" aria-label={t("flagsLabel")}>
          {data.flags.map((flag) => <li key={flag}>{t(`flags.${flag}`)}</li>)}
        </ul>
      ) : <p className="page-subtitle">{t("noFlags")}</p>}

      <div className="insight-grid">
        <article>
          <h3>{t("signup.title")}</h3>
          <dl className="detail-list">
            <div className="detail-row"><dt>{t("signup.when")}</dt><dd>{when(data.signup.at)}</dd></div>
            <div className="detail-row"><dt>{t("signup.platform")}</dt><dd>{platform(data.signup.platform)}</dd></div>
            <div className="detail-row">
              <dt>{t("signup.ip")}</dt>
              <dd>{address(data.signup.ip)} · {place(data.signup.ip_geo) || t("locationUnknown")}</dd>
            </div>
            <div className="detail-row">
              <dt>{t("signup.chosen")}</dt>
              <dd>
                {place(data.signup.chosen_location) || t("unknown")}
                {data.signup.chosen_location.source ? <> · {t("signup.source", { source: data.signup.chosen_location.source })}</> : null}
              </dd>
            </div>
            <div className="detail-row">
              <dt>{t("signup.sameIp")}</dt>
              <dd>{t("signup.sameIpCount", { count: data.shared_addresses.registered_from_signup_ip })}</dd>
            </div>
            <div className="detail-row">
              <dt>{t("signup.methods")}</dt>
              <dd>
                {data.signup.methods.length > 0 ? data.signup.methods.map((method) => t(`methods.${method}`)).join(" · ") : t("unknown")}
                {" · "}
                {t(data.signup.email_verified ? "signup.emailVerified" : "signup.emailUnverified")}
              </dd>
            </div>
            <div className="detail-row"><dt>{t("signup.legal")}</dt><dd>{data.signup.legal_source || t("unknown")}</dd></div>
          </dl>
        </article>
        <article>
          <h3>{t("logins.title")}</h3>
          <dl className="detail-list">
            <div className="detail-row">
              <dt>{t("logins.total")}</dt>
              <dd>{t("logins.totalValue", { total: data.logins.total, after: data.logins.after_signup })}</dd>
            </div>
            <div className="detail-row">
              <dt>{t("logins.last")}</dt>
              <dd>{data.last_login ? `${when(data.last_login.at)} · ${platform(data.last_login.platform)}` : t("logins.never")}</dd>
            </div>
            <div className="detail-row">
              <dt>{t("logins.lastIp")}</dt>
              <dd>{data.last_login ? <>{address(data.last_login.ip)} · {place(data.last_login) || t("locationUnknown")}</> : t("unknown")}</dd>
            </div>
            <div className="detail-row"><dt>{t("logins.lastSeen")}</dt><dd>{when(data.last_seen_at)}</dd></div>
            <div className="detail-row">
              <dt>{t("logins.spread")}</dt>
              <dd>{t("logins.spreadValue", { addresses: data.logins.distinct_addresses, countries: data.logins.distinct_countries })}</dd>
            </div>
            <div className="detail-row">
              <dt>{t("logins.platforms")}</dt>
              <dd>
                {INSIGHT_PLATFORMS
                  .filter((name) => data.logins.by_platform[name] > 0)
                  .map((name) => `${platform(name)} ${data.logins.by_platform[name]}`)
                  .join(" · ") || t("none")}
              </dd>
            </div>
          </dl>
        </article>
      </div>

      <h3>{t("provided.title")}</h3>
      <dl className="detail-list">
        <div className="detail-row">
          <dt>{t("provided.interests", { count: data.profile.interests, maximum: data.profile.interests_maximum })}</dt>
          <dd>{chips(data.provided.interests)}</dd>
        </div>
        <div className="detail-row">
          <dt>{t("provided.identity")}</dt>
          <dd>{[data.provided.gender, data.provided.visible_to].filter(Boolean).join(" · ") || t("none")}</dd>
        </div>
        <div className="detail-row">
          <dt>{t("provided.about", { length: data.profile.about_length })}</dt>
          <dd className="insight-about">{data.provided.about_me || t("none")}</dd>
        </div>
      </dl>

      <h3>{t("shared.title", { count: data.shared_addresses.seen_on_any_address })}</h3>
      {data.shared_addresses.accounts.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("shared.member")}</th>
                <th>{t("shared.registered")}</th>
                <th>{t("shared.platform")}</th>
                <th>{t("shared.relation")}</th>
                <th>{t("shared.lastSeen")}</th>
              </tr>
            </thead>
            <tbody>
              {data.shared_addresses.accounts.map((account) => (
                <tr key={account.uid}>
                  <td>
                    {/* No prefetch: opening the panel must not fire a request per shared account. */}
                    <Link href={`/users/${account.uid}`} prefetch={false}>{account.display_name || `#${account.uid}`}</Link>{" "}
                    <small>#{account.uid}</small>
                    {account.demo ? <> <span className="status-badge">{t("shared.demo")}</span></> : null}
                  </td>
                  <td>{when(account.created_at)}</td>
                  <td>{platform(account.platform)}</td>
                  <td>
                    {account.registered_from_signup_ip
                      ? t("shared.sameSignupIp")
                      : t("shared.sameLoginIp", { count: account.shared_address_count })}
                  </td>
                  <td>{when(account.last_seen_on_shared_address_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="page-subtitle">{t("shared.none")}</p>}
      {data.shared_addresses.seen_on_any_address > data.shared_addresses.accounts.length ? (
        <p className="page-subtitle">{t("shared.truncated", { shown: data.shared_addresses.accounts.length })}</p>
      ) : null}

      <h3>{t("recent.title")}</h3>
      {data.logins.recent.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("recent.when")}</th>
                <th>{t("recent.platform")}</th>
                <th>{t("recent.ip")}</th>
                <th>{t("recent.place")}</th>
                <th>{t("recent.build")}</th>
              </tr>
            </thead>
            <tbody>
              {data.logins.recent.map((row, index) => (
                <tr key={`${row.at}-${index}`}>
                  <td>{when(row.at)}</td>
                  <td>{platform(row.platform)}</td>
                  <td>{address(row.ip)}</td>
                  <td>{place(row) || t("locationUnknown")}</td>
                  <td>{row.app_build || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="page-subtitle">{t("recent.none")}</p>}
      <p className="page-subtitle insight-caveat">{t("caveat")}</p>
    </div>
  );
}

export default function UserModerationInsight({ uid }: { uid: number }) {
  const t = useTranslations("userInsight");
  const common = useTranslations("common");
  const bodyId = useId();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [data, setData] = useState<Insight | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setState("loading");
    setData(null);
    const response = await adminCall("user_moderation_insight", { uid }, controller.signal);
    if (controller.signal.aborted) return;
    const parsed = userModerationInsight(response, uid);
    setData(parsed);
    setState(parsed ? "ready" : "error");
  }, [uid]);

  // Closing (or leaving the member) cancels the read and forgets the addresses.
  useEffect(() => {
    if (open) void load();
    return () => {
      inFlight.current?.abort();
      setData(null);
      setState("idle");
    };
  }, [open, load]);

  return (
    <section className="panel insight-panel" aria-labelledby={`${bodyId}-title`}>
      <div className="panel-header">
        <div>
          <h2 id={`${bodyId}-title`}>{t("title")}</h2>
          <p className="page-subtitle">{t("subtitle")}</p>
        </div>
        <div className="insight-actions">
          {open ? (
            <button type="button" className="button button-secondary button-small" disabled={state === "loading"} onClick={() => void load()}>
              {t("reload")}
            </button>
          ) : null}
          <button
            type="button"
            className="button button-secondary button-small"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((current) => !current)}
          >
            {open ? t("hide") : t("show")}
          </button>
        </div>
      </div>
      <div className="panel-body">
        <p className="insight-sensitive" role="note">{t("sensitive")}</p>
        <div id={bodyId} hidden={!open}>
          {open && state === "loading" ? <p className="page-subtitle">{t("loading")}</p> : null}
          {open && state === "error" ? (
            <div className="alert alert-error insight-error" role="alert">
              <p>{t("error")}</p>
              <button type="button" className="button button-secondary button-small" onClick={() => void load()}>
                {common("retry")}
              </button>
            </div>
          ) : null}
          {open && state === "ready" && data ? <UserModerationInsightView data={data} /> : null}
        </div>
      </div>
    </section>
  );
}
