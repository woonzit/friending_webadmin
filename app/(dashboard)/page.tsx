"use client";

import Link from "next/link";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import PageHeader from "@/components/PageHeader";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { formatDate, formatNumber } from "@/lib/format";

type AuditRow = {
  id: string;
  actor_email: string;
  action: string;
  target: string;
  created_at: number;
};

type Overview = {
  total_users: number;
  new_users_7d: number;
  demo_profiles: number;
  profiles_with_avatar: number;
  active_heroes: number;
  active_admins: number;
  recent_audit: AuditRow[];
};

export default function OverviewPage() {
  const t = useTranslations("overview");
  const locale = useLocale();
  const [data, setData] = useState<Overview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    setState(data ? "ready" : "loading");
    const response = await adminCall("overview");
    if (!response?.success || !response.data || typeof response.data !== "object") {
      setState("error");
      return;
    }
    setData(response.data as unknown as Overview);
    setState("ready");
  }, [data]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === "loading") return <LoadingPanel />;
  if (state === "error" || !data) return <ErrorPanel message={t("loadError")} retry={load} />;

  const avatarCoverage = data.total_users > 0
    ? Math.round((data.profiles_with_avatar / data.total_users) * 100)
    : 0;
  const stats = [
    { label: t("totalUsers"), value: formatNumber(data.total_users, locale), tone: "" },
    { label: t("newUsers"), value: formatNumber(data.new_users_7d, locale), tone: "green" },
    { label: t("demoProfiles"), value: formatNumber(data.demo_profiles, locale), tone: "pink" },
    // T-468b finding 27: the legacy people_hero count is stale by construction after the cutover.
    { label: t("activeAdmins"), value: formatNumber(data.active_admins, locale), tone: "green" },
    { label: t("avatarCoverage"), value: `${avatarCoverage}%`, tone: "pink" },
  ];

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />
      <section className="stat-grid">
        {stats.map((item) => (
          <article className={`stat-card ${item.tone}`} key={item.label}>
            <span className="stat-label">{item.label}</span>
            <strong className="stat-value">{item.value}</strong>
          </article>
        ))}
      </section>
      <section className="section-grid">
        <article className="panel">
          <div className="panel-header">
            <div><h2>{t("quickActions")}</h2><p>{t("quickActionsCopy")}</p></div>
          </div>
          <div className="panel-body quick-grid">
            <Link className="quick-link" href="/users">
              <strong>{t("manageUsers")}</strong><span>{t("manageUsersCopy")}</span>
            </Link>
            <Link className="quick-link" href="/appearance">
              <strong>{t("manageHeroes")}</strong><span>{t("manageHeroesCopy")}</span>
            </Link>
            <Link className="quick-link" href="/configuration">
              <strong>{t("manageConfig")}</strong><span>{t("manageConfigCopy")}</span>
            </Link>
          </div>
        </article>
        <article className="panel">
          <div className="panel-header">
            <div><h2>{t("recentAudit")}</h2><p>{t("recentAuditCopy")}</p></div>
            <Link className="button-link" href="/audit">{t("viewAudit")}</Link>
          </div>
          {data.recent_audit.length === 0 ? (
            <EmptyPanel title={t("noAudit")} />
          ) : (
            <div className="panel-body audit-feed">
              {data.recent_audit.map((row) => (
                <div className="audit-feed-row" key={row.id}>
                  <span className="avatar-dot">{row.actor_email.slice(0, 1).toUpperCase()}</span>
                  <div><strong>{row.action}</strong><span>{row.actor_email} · {row.target || "—"}</span></div>
                  <time>{formatDate(row.created_at, locale, true)}</time>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </>
  );
}
