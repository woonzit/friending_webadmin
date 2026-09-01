"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { normalizeAdminRole } from "@/lib/authPolicy";
import {
  membershipActionErrorKey,
  membershipExpiryChange,
  membershipGrantPreview,
  membershipStoreContribution,
  membershipUserDetail,
  type MembershipAdminGrant,
  type MembershipAction,
  type MembershipGrantPreview,
  type MembershipUserDetail,
} from "@/lib/membership";

type GrantPreset = "plus_week" | "plus_month" | "plus_quarter" | "custom";
type StartMode = "extend" | "start_now";

function formatInstant(value: string | null, locale: string, withTime = true): string {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function formatUtcInstant(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toISOString().replace("T", " ").replace(".000Z", " UTC");
}

function InstantValue({ value, locale }: { value: string | null; locale: string }) {
  if (!value) return <>—</>;
  return (
    <time className="membership-instant" dateTime={value}>
      <span>{formatInstant(value, locale)}</span>
      <small>{formatUtcInstant(value)}</small>
    </time>
  );
}

function toWireInstant(localValue: string): string | null {
  if (!localValue) return null;
  const date = new Date(localValue);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function toLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
}

function validReason(value: string): boolean {
  const length = value.trim().replace(/\s+/g, " ").length;
  return length >= 3 && length <= 500;
}

function sourceLabel(kinds: string[]): string {
  const unique = [...new Set(kinds)];
  return unique.length > 0 ? unique.join(" + ") : "—";
}

function isEditableGrant(grant: MembershipAdminGrant | null): grant is MembershipAdminGrant {
  return Boolean(grant && grant.current && (grant.status === "active" || grant.status === "scheduled"));
}

export default function UserMembershipPanel({
  uid,
  initial,
}: {
  uid: number;
  initial: MembershipUserDetail;
}) {
  const t = useTranslations("membershipUser");
  const membershipErrors = useTranslations("membershipErrors");
  const common = useTranslations("common");
  const locale = useLocale();
  const [detail, setDetail] = useState(initial);
  const [adminRole, setAdminRole] = useState("");
  const [adminAccess, setAdminAccess] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [preset, setPreset] = useState<GrantPreset>("plus_month");
  const [startMode, setStartMode] = useState<StartMode>("extend");
  const [customExpiry, setCustomExpiry] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<MembershipGrantPreview | null>(null);
  const [expiryEdit, setExpiryEdit] = useState(() => toLocalInput(initial.admin_grant?.expires_at ?? null));
  const [expiryReason, setExpiryReason] = useState("");

  const loadAdminAccess = useCallback(async () => {
    setAdminAccess("loading");
    setAdminRole("");
    const response = await adminCall("admin_me");
    const role = response?.success === true ? normalizeAdminRole(response.role) : "";
    if (!role) {
      setAdminAccess("error");
      return;
    }
    setAdminRole(role);
    setAdminAccess("ready");
  }, []);

  useEffect(() => { void loadAdminAccess(); }, [loadAdminAccess]);

  const status = detail.effective_membership;
  const activeSources = useMemo(
    () => status.sources.filter((source) => source.contributes_to_access).map((source) => source.kind),
    [status.sources],
  );
  const editor = adminAccess === "ready" && (adminRole === "owner" || adminRole === "admin");
  const owner = adminAccess === "ready" && adminRole === "owner";
  const customWire = preset === "custom" ? toWireInstant(customExpiry) : null;
  const grantInputValid = editor && validReason(reason) && (preset !== "custom" || customWire !== null);
  const currentGrant = detail.admin_grant;
  const canEditGrant = editor && isEditableGrant(currentGrant);
  const expiryWire = toWireInstant(expiryEdit);
  const expiryChange = membershipExpiryChange(currentGrant?.expires_at ?? null, expiryWire);
  const expiryValid = canEditGrant && expiryWire !== null && validReason(expiryReason)
    && (expiryChange !== "shorten" || owner);

  function resetPreview() {
    setPreview(null);
    setNotice(null);
  }

  function adopt(value: unknown): boolean {
    const parsed = membershipUserDetail(value);
    if (!parsed || parsed.uid !== uid) return false;
    setDetail(parsed);
    setExpiryEdit(toLocalInput(parsed.admin_grant?.expires_at ?? null));
    return true;
  }

  function actionErrorText(action: MembershipAction, error: unknown): string {
    return membershipErrors(membershipActionErrorKey(action, error));
  }

  async function reload() {
    setBusy("reload");
    setNotice(null);
    const response = await adminCall("membership_user_detail", { uid });
    setBusy("");
    if (!response?.success || !adopt(response.data)) {
      setNotice({ tone: "error", text: t("loadError") });
    }
  }

  function grantBody(): Record<string, unknown> {
    return {
      uid,
      preset_id: preset,
      start_mode: startMode,
      custom_expires_at: customWire,
    };
  }

  async function previewGrant() {
    if (!grantInputValid) return;
    setBusy("preview");
    setNotice(null);
    setPreview(null);
    const response = await adminCall("membership_admin_grant_preview", grantBody());
    setBusy("");
    if (!response?.success) {
      setNotice({ tone: "error", text: actionErrorText("grant_preview", response?.error) });
      return;
    }
    const parsed = membershipGrantPreview(response.data);
    if (!parsed || parsed.uid !== uid) {
      setNotice({ tone: "error", text: membershipErrors("invalidResponse") });
      return;
    }
    setPreview(parsed);
  }

  async function confirmGrant() {
    if (!preview || !grantInputValid) return;
    if (startMode === "start_now" && preview.store_overlap
      && !window.confirm(t("grant.overlapConfirm"))) return;
    setBusy("grant");
    setNotice(null);
    const response = await adminCall("membership_admin_grant", {
      ...grantBody(),
      expected_revision: preview.current_grant_revision,
      reason: reason.trim().replace(/\s+/g, " "),
      request_id: crypto.randomUUID(),
    });
    setBusy("");
    if (!response?.success) {
      const errorKey = membershipActionErrorKey("grant_create", response?.error);
      if (errorKey === "grantConflict" && response?.data) adopt(response.data);
      setPreview(null);
      setNotice({ tone: "error", text: membershipErrors(errorKey) });
      return;
    }
    if (!adopt(response.data)) {
      setPreview(null);
      setNotice({ tone: "error", text: membershipErrors("invalidResponse") });
      return;
    }
    setReason("");
    setPreview(null);
    setNotice({ tone: "success", text: t("grantSaved") });
  }

  async function updateExpiry() {
    if (!currentGrant || !expiryValid || !expiryWire) return;
    const confirmation = expiryChange === "shorten"
      ? t("expiryShortenConfirm", {
        from: formatInstant(currentGrant.expires_at, locale),
        to: formatInstant(expiryWire, locale),
      })
      : t("expiryConfirm", { date: formatInstant(expiryWire, locale) });
    if (!window.confirm(confirmation)) return;
    setBusy("expiry");
    setNotice(null);
    const response = await adminCall("membership_admin_grant_update", {
      uid,
      expected_revision: currentGrant.revision,
      expires_at: expiryWire,
      reason: expiryReason.trim().replace(/\s+/g, " "),
      request_id: crypto.randomUUID(),
    });
    setBusy("");
    if (!response?.success) {
      const errorKey = membershipActionErrorKey("expiry_update", response?.error);
      if (errorKey === "expiryConflict" && response?.data) adopt(response.data);
      setNotice({ tone: "error", text: membershipErrors(errorKey) });
      return;
    }
    if (!adopt(response.data)) {
      setNotice({ tone: "error", text: membershipErrors("invalidResponse") });
      return;
    }
    setExpiryReason("");
    setNotice({ tone: "success", text: t("expirySaved") });
  }

  async function revokeGrant() {
    if (!owner || !currentGrant || !isEditableGrant(currentGrant) || !validReason(expiryReason)) return;
    if (!window.confirm(t("revokeConfirm"))) return;
    setBusy("revoke");
    setNotice(null);
    const response = await adminCall("membership_admin_grant_revoke", {
      uid,
      expected_revision: currentGrant.revision,
      reason: expiryReason.trim().replace(/\s+/g, " "),
      request_id: crypto.randomUUID(),
    });
    setBusy("");
    if (!response?.success) {
      const errorKey = membershipActionErrorKey("grant_revoke", response?.error);
      if (errorKey === "revokeConflict" && response?.data) adopt(response.data);
      setNotice({ tone: "error", text: membershipErrors(errorKey) });
      return;
    }
    if (!adopt(response.data)) {
      setNotice({ tone: "error", text: membershipErrors("invalidResponse") });
      return;
    }
    setExpiryReason("");
    setNotice({ tone: "success", text: t("revoked") });
  }

  if (status.lifecycle_state === "unavailable") {
    return (
      <section className="panel membership-user-panel">
        <div className="panel-header membership-user-header">
          <div>
            <h2>{t("title")}</h2>
            <p>{t("copy")}</p>
          </div>
          <button className="button button-secondary button-small" type="button" disabled={Boolean(busy)} onClick={() => void reload()}>
            {busy === "reload" ? common("loading") : t("refresh")}
          </button>
        </div>
        <div className="panel-body membership-user-body">
          <p className="alert alert-error" role="alert">{t("unavailable")}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel membership-user-panel">
      <div className="panel-header membership-user-header">
        <div>
          <h2>{t("title")}</h2>
          <p>{t("copy")}</p>
        </div>
        <div className="membership-header-actions">
          <span className={`badge ${status.entitled ? "badge-active" : "badge-inactive"}`}>
            {status.tier === "plus" ? t("tiers.plus") : status.tier === "free" ? t("tiers.free") : t("tiers.unknown")}
          </span>
          <button className="button button-secondary button-small" type="button" disabled={Boolean(busy)} onClick={() => void reload()}>
            {busy === "reload" ? common("loading") : t("refresh")}
          </button>
        </div>
      </div>
      <div className="panel-body membership-user-body">
        {notice ? (
          <p className={`alert ${notice.tone === "success" ? "alert-success" : "alert-error"}`} role="status">
            {notice.text}
          </p>
        ) : null}
        <div className="membership-summary-grid">
          <div><span>{t("state")}</span><strong>{t(`states.${status.lifecycle_state}`)}</strong></div>
          <div><span>{t("effectiveStart")}</span><strong><InstantValue value={status.effective_starts_at} locale={locale} /></strong></div>
          <div><span>{t("firstSubscribed")}</span><strong>{formatInstant(status.first_subscribed_at, locale)}</strong></div>
          <div><span>{t("effectiveExpiry")}</span><strong><InstantValue value={status.effective_expires_at} locale={locale} /></strong></div>
          <div><span>{t("nextTransition")}</span><strong><InstantValue value={status.next_transition_at} locale={locale} /></strong></div>
          <div><span>{t("source")}</span><strong>{sourceLabel(activeSources)}</strong></div>
        </div>

        <div className="membership-policy-grid">
          <section className="membership-subpanel">
            <div className="membership-subpanel-head"><div><h3>{t("capabilities.title")}</h3><p>{t("capabilities.copy")}</p></div></div>
            <div className="membership-capability-list">
              {(["invisible_presence", "hide_profile_visit", "quick_phrases", "vip_badge"] as const).map((key) => (
                <div key={key}>
                  <span>{t(`capabilities.items.${key}`)}</span>
                  <strong className={`badge ${status.capabilities[key] ? "badge-active" : "badge-inactive"}`}>
                    {status.capabilities[key] ? common("enabled") : common("disabled")}
                  </strong>
                </div>
              ))}
            </div>
          </section>
          <section className="membership-subpanel">
            <div className="membership-subpanel-head"><div><h3>{t("badge.title")}</h3><p>{t("badge.copy")}</p></div></div>
            <dl className="detail-list compact">
              <div className="detail-row"><dt>{t("badge.eligible")}</dt><dd>{status.badge.eligible ? common("yes") : common("no")}</dd></div>
              <div className="detail-row"><dt>{t("badge.hidden")}</dt><dd>{status.badge.hidden ? common("yes") : common("no")}</dd></div>
              <div className="detail-row"><dt>{t("badge.visible")}</dt><dd>{status.badge.visible ? common("yes") : common("no")}</dd></div>
            </dl>
          </section>
        </div>

        <div className="membership-benefit-grid">
          {(["footprint_send", "pinger_send", "private_album_access", "quick_phrase_slots"] as const).map((key) => {
            const quota = status.quotas[key];
            const limit = quota.mode === "unlimited"
              ? t("unlimited")
              : quota.mode === "disabled"
                ? t("disabled")
                : String(quota.limit ?? 0);
            const remaining = quota.mode === "unlimited"
              ? t("unlimited")
              : quota.mode === "disabled"
                ? t("disabled")
                : String(quota.remaining ?? 0);
            return (
              <div className="membership-benefit" key={key}>
                <span>{t(`quotas.${key}`)}</span>
                <strong>{t(`quotaModes.${quota.mode}`)}</strong>
                <dl className="membership-quota-detail">
                  <div><dt>{t("quota.scope")}</dt><dd>{t(`scopes.${quota.scope}`)}</dd></div>
                  <div><dt>{t("quota.used")}</dt><dd>{quota.used}</dd></div>
                  <div><dt>{t("quota.limit")}</dt><dd>{limit}</dd></div>
                  <div><dt>{t("quota.remaining")}</dt><dd>{remaining}</dd></div>
                  <div><dt>{t("quota.reset")}</dt><dd><InstantValue value={quota.reset_at} locale={locale} /></dd></div>
                </dl>
              </div>
            );
          })}
        </div>

        {adminAccess === "loading" ? <LoadingPanel /> : adminAccess === "error" ? (
          <ErrorPanel message={t("accessUnavailable")} retry={() => void loadAdminAccess()} />
        ) : <div className="membership-admin-grid">
          <section className="membership-subpanel">
            <div className="membership-subpanel-head">
              <div><h3>{t("grant.title")}</h3><p>{t("grant.copy")}</p></div>
            </div>
            {!editor ? <p className="alert alert-warning">{t("writeRequired")}</p> : null}
            <div className="form-grid">
              <label className="field">
                <span>{t("grant.preset")}</span>
                <select value={preset} disabled={!editor || Boolean(busy)} onChange={(event) => { setPreset(event.target.value as GrantPreset); resetPreview(); }}>
                  <option value="plus_week">{t("presets.plus_week")}</option>
                  <option value="plus_month">{t("presets.plus_month")}</option>
                  <option value="plus_quarter">{t("presets.plus_quarter")}</option>
                  <option value="custom">{t("presets.custom")}</option>
                </select>
              </label>
              <label className="field">
                <span>{t("grant.startMode")}</span>
                <select value={startMode} disabled={!editor || Boolean(busy)} onChange={(event) => { setStartMode(event.target.value as StartMode); resetPreview(); }}>
                  <option value="extend">{t("grant.extend")}</option>
                  <option value="start_now">{t("grant.startNow")}</option>
                </select>
              </label>
              {startMode === "start_now" ? (
                <p className="alert alert-warning field-full">{t("grant.startNowWarning")}</p>
              ) : null}
              {preset === "custom" ? (
                <label className="field field-full">
                  <span>{t("grant.customExpiry")}</span>
                  <input type="datetime-local" step={1} value={customExpiry} disabled={!editor || Boolean(busy)} onChange={(event) => { setCustomExpiry(event.target.value); resetPreview(); }} />
                </label>
              ) : null}
              <label className="field field-full">
                <span>{t("reason")}</span>
                <textarea maxLength={500} value={reason} disabled={!editor || Boolean(busy)} placeholder={t("reasonPlaceholder")} onChange={(event) => { setReason(event.target.value); resetPreview(); }} />
                <small className="field-hint">{t("reasonHint")}</small>
              </label>
            </div>
            <div className="row-actions">
              <button type="button" className="button button-secondary" disabled={!grantInputValid || Boolean(busy)} onClick={() => void previewGrant()}>
                {busy === "preview" ? common("loading") : t("grant.preview")}
              </button>
            </div>
            {preview ? (
              <div className="membership-preview" role="status">
                <h4>{t("grant.previewTitle")}</h4>
                <dl className="detail-list compact">
                  <div className="detail-row"><dt>{t("grant.starts")}</dt><dd><InstantValue value={preview.schedule.starts_at} locale={locale} /></dd></div>
                  <div className="detail-row"><dt>{t("grant.expires")}</dt><dd><InstantValue value={preview.schedule.expires_at} locale={locale} /></dd></div>
                  <div className="detail-row"><dt>{t("grant.resultExpiry")}</dt><dd><InstantValue value={preview.resulting_effective_expires_at} locale={locale} /></dd></div>
                  <div className="detail-row"><dt>{t("grant.storeOverlap")}</dt><dd>{preview.store_overlap ? common("yes") : common("no")}</dd></div>
                </dl>
                {startMode === "start_now" && preview.store_overlap ? (
                  <p className="alert alert-warning">{t("grant.overlapWarning")}</p>
                ) : null}
                <button type="button" className="button button-primary" disabled={Boolean(busy)} onClick={() => void confirmGrant()}>
                  {busy === "grant" ? common("saving") : t("grant.confirm")}
                </button>
              </div>
            ) : null}
          </section>

          <section className="membership-subpanel">
            <div className="membership-subpanel-head"><div><h3>{t("manage.title")}</h3><p>{t("manage.copy")}</p></div></div>
            {currentGrant ? (
              <dl className="detail-list compact membership-current-grant">
                <div className="detail-row"><dt>{t("manage.status")}</dt><dd>{t(`states.${currentGrant.status}`)}</dd></div>
                <div className="detail-row"><dt>{t("manage.period")}</dt><dd>{t(`presets.${currentGrant.preset_id}`)}</dd></div>
                <div className="detail-row"><dt>{t("manage.starts")}</dt><dd><InstantValue value={currentGrant.starts_at} locale={locale} /></dd></div>
                <div className="detail-row"><dt>{t("manage.expires")}</dt><dd><InstantValue value={currentGrant.expires_at} locale={locale} /></dd></div>
                <div className="detail-row"><dt>{t("manage.current")}</dt><dd>{currentGrant.current ? common("yes") : common("no")}</dd></div>
                <div className="detail-row"><dt>{t("manage.revision")}</dt><dd>{currentGrant.revision}</dd></div>
                <div className="detail-row"><dt>{t("reason")}</dt><dd>{currentGrant.reason || "—"}</dd></div>
                <div className="detail-row"><dt>{t("manage.createdBy")}</dt><dd>{currentGrant.created_by || "—"}</dd></div>
                <div className="detail-row"><dt>{t("manage.createdAt")}</dt><dd><InstantValue value={currentGrant.created_at} locale={locale} /></dd></div>
                <div className="detail-row"><dt>{t("manage.updatedBy")}</dt><dd>{currentGrant.updated_by || "—"}</dd></div>
                <div className="detail-row"><dt>{t("manage.updatedAt")}</dt><dd><InstantValue value={currentGrant.updated_at} locale={locale} /></dd></div>
                {currentGrant.revoked_by || currentGrant.revoked_at ? (
                  <>
                    <div className="detail-row"><dt>{t("manage.revokedBy")}</dt><dd>{currentGrant.revoked_by || "—"}</dd></div>
                    <div className="detail-row"><dt>{t("manage.revokedAt")}</dt><dd><InstantValue value={currentGrant.revoked_at} locale={locale} /></dd></div>
                  </>
                ) : null}
              </dl>
            ) : <p className="page-subtitle">{t("manage.none")}</p>}
            {isEditableGrant(currentGrant) ? (
              <div className="form-stack membership-expiry-form">
                <label className="field">
                  <span>{t("manage.newExpiry")}</span>
                  <input type="datetime-local" step={1} value={expiryEdit} disabled={!editor || Boolean(busy)} onChange={(event) => setExpiryEdit(event.target.value)} />
                </label>
                <label className="field">
                  <span>{t("reason")}</span>
                  <textarea maxLength={500} value={expiryReason} disabled={!editor || Boolean(busy)} placeholder={t("reasonPlaceholder")} onChange={(event) => setExpiryReason(event.target.value)} />
                </label>
                {!owner ? <p className="field-hint">{t("manage.shortenOwnerOnly")}</p> : null}
                {expiryChange === "shorten" ? <p className="alert alert-warning">{t("manage.shortenWarning")}</p> : null}
                <div className="row-actions">
                  <button type="button" className="button button-secondary" disabled={!expiryValid || Boolean(busy)} onClick={() => void updateExpiry()}>
                    {busy === "expiry" ? common("saving") : t("manage.saveExpiry")}
                  </button>
                  {owner ? (
                    <button type="button" className="button button-danger" disabled={!validReason(expiryReason) || Boolean(busy)} onClick={() => void revokeGrant()}>
                      {busy === "revoke" ? common("saving") : t("manage.revoke")}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>
        </div>}

        <section className="membership-subpanel">
          <div className="membership-subpanel-head"><div><h3>{t("store.title")}</h3><p>{t("store.copy")}</p></div></div>
          {detail.store_sources.length === 0 ? <p className="page-subtitle">{t("store.none")}</p> : (
            <div className="table-wrap membership-inner-table">
              <table className="data-table">
                <thead><tr>
                  <th>{t("store.platform")}</th>
                  <th>{t("store.product")}</th>
                  <th>{t("store.basePlan")}</th>
                  <th>{t("store.state")}</th>
                  <th>{t("store.verification")}</th>
                  <th>{t("store.contribution")}</th>
                  <th>{t("store.purchased")}</th>
                  <th>{t("store.periodStart")}</th>
                  <th>{t("store.expires")}</th>
                  <th>{t("store.graceEnd")}</th>
                  <th>{t("store.renewal")}</th>
                  <th>{t("store.lastVerified")}</th>
                </tr></thead>
                <tbody>{detail.store_sources.map((source, index) => {
                  const contribution = membershipStoreContribution(
                    source,
                    status.sources,
                    detail.store_sources,
                  );
                  return (
                    <tr key={`${source.platform}-${source.product_id}-${source.expires_at ?? index}`}>
                      <td>{source.platform} · {source.environment || "—"}</td>
                      <td>{source.product_id || "—"}</td>
                      <td>{source.base_plan_id || "—"}</td>
                      <td><span>{source.normalized_state || "—"}</span><small className="table-subline">{source.provider_state || "—"}</small></td>
                      <td>
                        <span className={`badge ${source.verification_status === "verified" ? "badge-active" : "badge-warning"}`}>
                          {source.verification_status || t("store.unknown")}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${contribution === true ? "badge-active" : contribution === false ? "badge-inactive" : "badge-warning"}`}>
                          {contribution === true
                            ? t("store.contributing")
                            : contribution === false
                              ? t("store.notContributing")
                              : t("store.unknown")}
                        </span>
                      </td>
                      <td><InstantValue value={source.first_purchased_at} locale={locale} /></td>
                      <td><InstantValue value={source.current_period_started_at} locale={locale} /></td>
                      <td><InstantValue value={source.expires_at} locale={locale} /></td>
                      <td><InstantValue value={source.grace_expires_at} locale={locale} /></td>
                      <td>{source.auto_renews === null ? "—" : source.auto_renews ? common("yes") : common("no")}</td>
                      <td><InstantValue value={source.last_verified_at} locale={locale} /></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </section>

        <section className="membership-subpanel">
          <div className="membership-subpanel-head"><div><h3>{t("history.title")}</h3><p>{t("history.copy")}</p></div></div>
          {detail.history.length === 0 ? <p className="page-subtitle">{t("history.none")}</p> : (
            <div className="membership-history-list">
              {detail.history.map((entry, index) => (
                <div key={`${entry.created_at ?? "none"}-${entry.action}-${index}`}>
                  <strong>{entry.action || entry.kind}</strong>
                  <span>{formatInstant(entry.created_at, locale)}{entry.actor ? ` · ${entry.actor}` : ""}</span>
                  {entry.reason ? <p>{entry.reason}</p> : null}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
