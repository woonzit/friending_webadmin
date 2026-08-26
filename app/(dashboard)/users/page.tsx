"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { avatarUrl, formatDate, formatNumber } from "@/lib/format";
import { membershipListSummary, membershipUtcInstant } from "@/lib/membership";

type UserRow = {
  uid: number;
  display_name: string;
  codename: string;
  avatar_url: string;
  city: string;
  region: string;
  country: string;
  created: number;
  email: string;
  phone_e164: string;
  has_email: boolean;
  has_phone: boolean;
  is_apple_signup: boolean;
  demo_user: boolean;
  can_see_demo_users: boolean;
  profile_suspended: boolean;
  membership?: unknown;
};

type Filters = {
  query: string;
  demoMode: "all" | "real" | "demo";
  hasAvatar: boolean;
};

const EMPTY_FILTERS: Filters = { query: "", demoMode: "all", hasAvatar: false };
const PAGE_SIZE = 25;

export default function UsersPage() {
  const t = useTranslations("users");
  const membershipT = useTranslations("membershipUser");
  const common = useTranslations("common");
  const locale = useLocale();
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [permissionBusyUid, setPermissionBusyUid] = useState<number | null>(null);
  const [permissionMessage, setPermissionMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (rows.length === 0) setState("loading");
    const response = await adminCall("list_users", {
      query: filters.query,
      demo_mode: filters.demoMode,
      has_avatar: filters.hasAvatar,
      page,
      page_size: PAGE_SIZE,
    }, signal);
    if (!response?.success || !Array.isArray(response.data)) {
      if (!signal?.aborted) setState("error");
      return;
    }
    setRows(response.data as UserRow[]);
    setTotal(Number(response.total) || 0);
    setState("ready");
  }, [filters, page, rows.length]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [filters, page]); // eslint-disable-line react-hooks/exhaustive-deps

  function apply(event: React.FormEvent) {
    event.preventDefault();
    setPage(1);
    setFilters({ ...draft, query: draft.query.trim() });
  }

  function reset() {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(1);
  }

  async function setDemoVisibilityPermission(row: UserRow, enabled: boolean) {
    if (row.demo_user || permissionBusyUid !== null) return;

    setPermissionBusyUid(row.uid);
    setPermissionMessage(null);
    const response = await adminCall("set_demo_visibility_permission", {
      uid: row.uid,
      can_see_demo_users: enabled,
    });
    const permission = response?.permission;
    const returnedUid = permission && typeof permission === "object"
      ? Number((permission as Record<string, unknown>).uid)
      : 0;
    const returnedValue = permission && typeof permission === "object"
      ? (permission as Record<string, unknown>).can_see_demo_users
      : null;

    if (
      !response?.success
      || returnedUid !== row.uid
      || typeof returnedValue !== "boolean"
    ) {
      setPermissionMessage({ tone: "error", text: t("permissionSaveError") });
      setPermissionBusyUid(null);
      return;
    }

    setRows((current) => current.map((candidate) => (
      candidate.uid === row.uid
        ? { ...candidate, can_see_demo_users: returnedValue }
        : candidate
    )));
    setPermissionMessage({
      tone: "success",
      text: t("permissionSaved", {
        name: row.display_name || row.codename || `#${row.uid}`,
      }),
    });
    setPermissionBusyUid(null);
  }

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />
      <form className="filter-bar" onSubmit={apply}>
        <label className="field">
          <span>{t("searchLabel")}</span>
          <input
            value={draft.query}
            onChange={(event) => setDraft((value) => ({ ...value, query: event.target.value.slice(0, 80) }))}
            placeholder={t("searchPlaceholder")}
          />
        </label>
        <label className="field">
          <span>{t("typeLabel")}</span>
          <select
            value={draft.demoMode}
            onChange={(event) => setDraft((value) => ({
              ...value,
              demoMode: event.target.value as Filters["demoMode"],
            }))}
          >
            <option value="all">{t("typeAll")}</option>
            <option value="real">{t("typeReal")}</option>
            <option value="demo">{t("typeDemo")}</option>
          </select>
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={draft.hasAvatar}
            onChange={(event) => setDraft((value) => ({ ...value, hasAvatar: event.target.checked }))}
          />
          <span>{t("avatarOnly")}</span>
        </label>
        <div className="row-actions">
          <button className="button button-primary" type="submit">{t("apply")}</button>
          <button className="button button-secondary" type="button" onClick={reset}>{t("reset")}</button>
        </div>
      </form>

      {permissionMessage && (
        <div
          className={`alert ${
            permissionMessage.tone === "success" ? "alert-success" : "alert-error"
          } page-alert`}
          role="status"
        >
          {permissionMessage.text}
        </div>
      )}

      {state === "loading" ? (
        <LoadingPanel />
      ) : state === "error" ? (
        <ErrorPanel message={t("loadError")} retry={() => void load()} />
      ) : (
        <>
          <div className="list-summary">
            <strong>{t("resultCount", { count: total })}</strong>
            <span>{t("page", { page })}</span>
          </div>
          <p className="list-note">
            {t("demoAccessNote")}{" "}
            <Link href="/configuration">{t("demoAccessConfiguration")}</Link>
          </p>
          <p className="list-note membership-list-note">{t("membershipSummaryNote")}</p>
          <div className="table-wrap">
            {rows.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-inner"><h3>{t("noRows")}</h3><p>{t("noRowsCopy")}</p></div>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("user")}</th>
                    <th>{t("contact")}</th>
                    <th>{t("location")}</th>
                    <th>{t("joined")}</th>
                    <th>{t("account")}</th>
                    <th>{t("membership")}</th>
                    <th>{t("demoAccess")}</th>
                    <th><span className="sr-only">{common("actions")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const image = avatarUrl(row.avatar_url);
                    const location = [row.city, row.region, row.country].filter(Boolean).join(", ");
                    const membership = membershipListSummary(row.membership);
                    const membershipExpiry = membershipUtcInstant(membership.effective_expires_at);
                    const membershipFirstSource = membershipUtcInstant(membership.first_subscribed_at);
                    const membershipSources = membership.source_kinds.length > 0
                      ? membership.source_kinds.map((kind) => t(`membershipSources.${kind}`)).join(" · ")
                      : membership.lifecycle_state === "unavailable"
                        ? t("membershipValueUnavailable")
                        : t("membershipSourcesNone");
                    return (
                      <tr key={row.uid}>
                        <td>
                          <div className="user-cell">
                            {image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img className="user-thumb" src={image} alt="" width="46" height="46" loading="lazy" />
                            ) : (
                              <span className="user-thumb-placeholder">{(row.display_name || "?").slice(0, 1).toUpperCase()}</span>
                            )}
                            <span>
                              <strong>{row.display_name || t("unknownUser")}</strong>
                              <small>#{row.uid} · {row.codename || "—"}</small>
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="cell-stack">
                            <span>{row.email || "—"}</span>
                            <small>{row.phone_e164 || (row.is_apple_signup ? "Apple" : "—")}</small>
                          </div>
                        </td>
                        <td>{location || "—"}</td>
                        <td>{formatDate(row.created, locale)}</td>
                        <td>
                          <div className="cell-stack">
                            <span className={`badge ${row.demo_user ? "badge-demo" : ""}`}>
                              {row.demo_user ? t("demoBadge") : t("regularBadge")}
                            </span>
                            {row.profile_suspended && <span className="badge badge-warning">{t("suspendedBadge")}</span>}
                          </div>
                        </td>
                        <td>
                          <div className="cell-stack membership-list-cell">
                            <span className={`badge ${membership.entitled ? "badge-active" : "badge-inactive"}`}>
                              {membership.tier === "plus"
                                ? t("membershipPlus")
                                : membership.tier === "free"
                                  ? t("membershipFree")
                                  : t("membershipUnknown")}
                            </span>
                            <small>{t("membershipLifecycle", {
                              state: membershipT(`states.${membership.lifecycle_state}`),
                            })}</small>
                            <small>{t("membershipExpiryUtc", {
                              date: membershipExpiry ?? (membership.lifecycle_state === "unavailable"
                                ? t("membershipValueUnavailable")
                                : t("membershipNoEffectiveExpiry")),
                            })}</small>
                            <small>{t("membershipSourceSummary", { sources: membershipSources })}</small>
                            {membershipFirstSource ? (
                              <small>{t("membershipEarliestSourceUtc", { date: membershipFirstSource })}</small>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          {row.demo_user ? (
                            <span className="demo-permission-state">{t("demoAccessNative")}</span>
                          ) : (
                            <div className="demo-permission-control">
                              <label className={`switch ${permissionBusyUid !== null ? "is-disabled" : ""}`}>
                                <span className="sr-only">
                                  {t("demoAccessToggle", {
                                    name: row.display_name || row.codename || `#${row.uid}`,
                                  })}
                                </span>
                                <input
                                  type="checkbox"
                                  checked={row.can_see_demo_users}
                                  disabled={permissionBusyUid !== null}
                                  onChange={(event) => {
                                    void setDemoVisibilityPermission(row, event.target.checked);
                                  }}
                                />
                                <span className="switch-track" />
                              </label>
                              <span>
                                {permissionBusyUid === row.uid
                                  ? common("saving")
                                  : row.can_see_demo_users
                                    ? t("demoAccessAllowed")
                                    : t("demoAccessHidden")}
                              </span>
                            </div>
                          )}
                        </td>
                        <td>
                          <Link className="button button-secondary button-small" href={`/users/${row.uid}`}>
                            {common("view")}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="pagination">
            <span>{formatNumber(total, locale)}</span>
            <div className="pagination-buttons">
              <button
                className="button button-secondary button-small"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                {common("previous")}
              </button>
              <button
                className="button button-secondary button-small"
                disabled={page * PAGE_SIZE >= total}
                onClick={() => setPage((value) => value + 1)}
              >
                {common("next")}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
