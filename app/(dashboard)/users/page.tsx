"use client";

import { adminMembershipRefusalForUi } from "@/lib/adminMembershipClientError";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { avatarUrl, formatDate, formatNumber } from "@/lib/format";
import { membershipListSummary, membershipUtcInstant } from "@/lib/membership";
import {
  PHONE_CHECK_FILTERS,
  accountTypeFilterFrom,
  phoneCheckFilterApplied,
  phoneCheckFilterFrom,
  registeredUserPhoneCheck,
  registeredUserSignup,
  registeredUsersHref,
  registeredUsersRefusal,
  signupPlatformFilterApplied,
  type AccountTypeFilter,
  type PhoneCheckFilter,
  type RegisteredUsersRefusal,
} from "@/lib/registeredUsers";
import {
  SIGNUP_PLATFORMS,
  signupPlatformFilterFrom,
  type SignupPlatformFilter,
} from "@/lib/registrationStats";
import { isRegistrationPeriod, REGISTRATION_PERIODS, registrationRange, type RegistrationPeriod } from "@/lib/signupMetrics";

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
  /** P-092: web | ios | android | unknown, and the old-app import marker. */
  signup_platform?: unknown;
  legacy_converted?: unknown;
  /** P-093: {phone_verified, phone_country}. */
  phone_check?: unknown;
};

type Filters = {
  query: string;
  demoMode: AccountTypeFilter;
  hasAvatar: boolean;
  registrationPeriod: RegistrationPeriod;
  registrationAsOf: number;
  platform: SignupPlatformFilter;
  phoneCheck: PhoneCheckFilter;
};

const EMPTY_FILTERS: Filters = {
  query: "",
  demoMode: "all",
  hasAvatar: false,
  registrationPeriod: "all",
  registrationAsOf: 0,
  platform: "all",
  phoneCheck: "all",
};
const PAGE_SIZE = 25;

export default function UsersPage() {
  // useSearchParams needs a Suspense boundary for the static build.
  return (
    <Suspense fallback={<LoadingPanel />}>
      <RegisteredUsers />
    </Suspense>
  );
}

function RegisteredUsers() {
  const t = useTranslations("users");
  const platformT = useTranslations("registrationStats.platforms");
  const membershipT = useTranslations("membershipUser");
  const common = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  // The overview's platform cards open this list pre-filtered (`?platform=web&type=real`).
  const urlPlatform = signupPlatformFilterFrom(search.get("platform"));
  const urlType = accountTypeFilterFrom(search.get("type"));
  const [draft, setDraft] = useState<Filters>(() => ({ ...EMPTY_FILTERS, platform: urlPlatform, demoMode: urlType }));
  const [filters, setFilters] = useState<Filters>(() => ({ ...EMPTY_FILTERS, platform: urlPlatform, demoMode: urlType }));
  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [refusal, setRefusal] = useState<RegisteredUsersRefusal | null>(null);
  const [filterIgnored, setFilterIgnored] = useState(false);
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
      ...registrationRange(filters.registrationPeriod, filters.registrationAsOf),
      signup_platform: filters.platform,
      phone_check: filters.phoneCheck,
      page,
      page_size: PAGE_SIZE,
    }, signal);
    if (signal?.aborted) return;
    if (response?.success !== true || response.status_code !== 200 || !Array.isArray(response.data)) {
      if (!signal?.aborted) {
        setRefusal(registeredUsersRefusal(response));
        setState("error");
      }
      return;
    }
    setRefusal(null);
    // Core echoes the filters it applied; a mismatch means the list is not what was asked for.
    setFilterIgnored(!signupPlatformFilterApplied(response, filters.platform)
      || !phoneCheckFilterApplied(response, filters.phoneCheck));
    setRows(response.data as UserRow[]);
    setTotal(Number(response.total) || 0);
    setState("ready");
  }, [filters, page, rows.length]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [filters, page]); // eslint-disable-line react-hooks/exhaustive-deps

  // A later address change (an overview card, back/forward) re-applies platform and type from it.
  useEffect(() => {
    if (urlPlatform === filters.platform && urlType === filters.demoMode) return;
    setDraft((value) => ({ ...value, platform: urlPlatform, demoMode: urlType }));
    setFilters((value) => ({ ...value, platform: urlPlatform, demoMode: urlType }));
    setPage(1);
  }, [urlPlatform, urlType]); // eslint-disable-line react-hooks/exhaustive-deps

  // The address carries both filters, so the effect above never undoes a choice made in the form.
  function showFilters(platform: SignupPlatformFilter, type: AccountTypeFilter) {
    const href = registeredUsersHref(platform, type);
    router.replace(href === "/users" ? pathname : `${pathname}${href.slice("/users".length)}`, { scroll: false });
  }

  function apply(event: React.FormEvent) {
    event.preventDefault();
    setPage(1);
    setFilters({ ...draft, query: draft.query.trim(), registrationAsOf: Math.floor(Date.now() / 1000) });
    showFilters(draft.platform, draft.demoMode);
  }

  function reset() {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(1);
    showFilters("all", "all");
  }

  async function setDemoVisibilityPermission(row: UserRow, enabled: boolean) {
    if (row.demo_user || permissionBusyUid !== null) return;

    setPermissionBusyUid(row.uid);
    setPermissionMessage(null);
    const response = await adminCall("set_demo_visibility_permission", {
      uid: row.uid,
      can_see_demo_users: enabled,
    }).catch(adminMembershipRefusalForUi);
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
      <form className="filter-bar users-filter-bar" onSubmit={apply}>
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
              demoMode: accountTypeFilterFrom(event.target.value),
            }))}
          >
            <option value="all">{t("typeAll")}</option>
            <option value="real">{t("typeReal")}</option>
            <option value="demo">{t("typeDemo")}</option>
          </select>
        </label>
        <label className="field">
          <span>{t("registrationPeriod")}</span>
          <select
            value={draft.registrationPeriod}
            onChange={(event) => {
              const value = event.target.value;
              if (isRegistrationPeriod(value)) setDraft((current) => ({ ...current, registrationPeriod: value }));
            }}
          >
            {REGISTRATION_PERIODS.map((period) => (
              <option key={period} value={period}>{t(`registrationPeriods.${period}`)}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("platformLabel")}</span>
          <select
            value={draft.platform}
            onChange={(event) => setDraft((value) => ({
              ...value,
              platform: signupPlatformFilterFrom(event.target.value),
            }))}
          >
            <option value="all">{t("platformAll")}</option>
            {SIGNUP_PLATFORMS.map((platform) => (
              <option key={platform} value={platform}>{platformT(platform)}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("phoneCheckLabel")}</span>
          <select
            value={draft.phoneCheck}
            onChange={(event) => setDraft((value) => ({
              ...value,
              phoneCheck: phoneCheckFilterFrom(event.target.value),
            }))}
          >
            {PHONE_CHECK_FILTERS.map((filter) => (
              <option key={filter} value={filter}>{t(`phoneCheckFilters.${filter}`)}</option>
            ))}
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
        <ErrorPanel message={refusal ? t(`filterRefused.${refusal}`) : t("loadError")} retry={() => void load()} />
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
          {filterIgnored && (
            <div className="alert alert-warning page-alert" role="status">{t("filterIgnored")}</div>
          )}
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
                    <th>{t("phoneCheck")}</th>
                    <th>{t("location")}</th>
                    <th>{t("joined")}</th>
                    <th>{t("signupPlatform")}</th>
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
                    const signup = registeredUserSignup(row);
                    const phoneCheck = registeredUserPhoneCheck(row);
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
                        <td>
                          {phoneCheck?.verified ? (
                            <div className="cell-stack">
                              <span className="badge badge-active">{t("phoneVerified")}</span>
                              {phoneCheck.country ? <small>{phoneCheck.country}</small> : null}
                            </div>
                          ) : phoneCheck && row.has_phone ? (
                            <span className="badge badge-inactive">{t("phoneUnverified")}</span>
                          ) : <span>—</span>}
                        </td>
                        <td>{location || "—"}</td>
                        <td>{formatDate(row.created, locale)}</td>
                        <td>
                          <div className="cell-stack">
                            {signup.platform ? (
                              <span className={`badge platform-badge platform-badge-${signup.platform}`}>
                                {platformT(signup.platform)}
                              </span>
                            ) : <span>—</span>}
                            {signup.legacyConverted && <small>{t("legacyConverted")}</small>}
                          </div>
                        </td>
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
