"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { normalizeAdminRole } from "@/lib/authPolicy";
import {
  membershipActionErrorKey,
  membershipConfiguration,
  membershipExpiryChange,
  membershipGrantPreview,
  membershipLiveQuickPhrases,
  membershipMutationOutcome,
  membershipNonProductionOnlyAccess,
  membershipRolloutMode,
  membershipStoreAutoRenews,
  membershipStoreEnvironment,
  membershipStoreRowContribution,
  membershipUserDetail,
  type MembershipAdminGrant,
  type MembershipAction,
  type MembershipGrantPreview,
  type MembershipQuotaMode,
  type MembershipRolloutMode,
  type MembershipUserDetail,
} from "@/lib/membership";
import {
  MEMBERSHIP_PENDING_GRANT_TTL_MS,
  membershipAdminScope,
  membershipCheckPendingGrant,
  membershipReadUserDetail,
  membershipRememberPendingGrant,
  membershipRestorePendingGrant,
  membershipSessionStorage,
  membershipSubmitGrant,
  type MembershipPendingGrant,
} from "@/lib/membershipFlows";

type GrantPreset = "plus_week" | "plus_month" | "plus_quarter" | "custom";
type StartMode = "extend" | "start_now";
type Notice = { tone: "success" | "warning" | "error"; text: string };
/** What Core's gates apply now; `unknown` when the membership configuration could not be read. */
type RolloutState = "loading" | MembershipRolloutMode | "unknown";

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

function normalizedReason(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function validReason(value: string): boolean {
  const length = normalizedReason(value).length;
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
  // The signed-in administrator's e-mail scopes the tab-local copy of a pinned grant request.
  const [adminScope, setAdminScope] = useState<string | null>(null);
  const [adminAccess, setAdminAccess] = useState<"loading" | "ready" | "error">("loading");
  const [rollout, setRollout] = useState<RolloutState>("loading");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [preset, setPreset] = useState<GrantPreset>("plus_month");
  const [startMode, setStartMode] = useState<StartMode>("extend");
  const [customExpiry, setCustomExpiry] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<MembershipGrantPreview | null>(null);
  const [pendingGrant, setPendingGrant] = useState<MembershipPendingGrant | null>(null);
  const [expiryEdit, setExpiryEdit] = useState(() => toLocalInput(initial.admin_grant?.expires_at ?? null));
  const [expiryReason, setExpiryReason] = useState("");
  const restoreChecked = useRef<string | null>(null);

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
    setAdminScope(membershipAdminScope(response?.email));
    setAdminAccess("ready");
  }, []);

  // One extra read: whether Core enforces the saved plan now, or still runs the legacy rules.
  const loadRollout = useCallback(async () => {
    const response = await adminCall("membership_configuration");
    const parsed = response?.success === true ? membershipConfiguration(response.data) : null;
    setRollout(parsed ? membershipRolloutMode(parsed) : "unknown");
  }, []);

  useEffect(() => { void loadAdminAccess(); }, [loadAdminAccess]);
  // P-100 Part B: when Core sends this member's live access, its rollout mode replaces the
  // configuration read below (the Part A inference), which stays the fallback without it.
  const liveAccessPresent = detail.live_access.state === "present";
  useEffect(() => {
    if (!liveAccessPresent) void loadRollout();
  }, [liveAccessPresent, loadRollout]);

  const detailReadable = detail.effective_membership.lifecycle_state !== "unavailable";

  // A grant request pinned before a page reload comes back for the same administrator and member
  // with the same lock, retry and discard controls, so a retry replays that exact request instead
  // of minting a new identity. Runs once per scope, as soon as a readable member detail exists.
  useEffect(() => {
    if (!adminScope || !detailReadable || restoreChecked.current === adminScope) return;
    restoreChecked.current = adminScope;
    const restored = membershipRestorePendingGrant(membershipSessionStorage(), {
      admin: adminScope,
      uid,
      detail,
      now: Date.now(),
    });
    if (restored.kind === "restored") {
      setPendingGrant(restored.pending);
      setPreset(restored.request.preset_id);
      setStartMode(restored.request.start_mode);
      setCustomExpiry(toLocalInput(restored.request.custom_expires_at));
      setReason(restored.request.reason);
      setPreview(null);
    } else if (restored.kind === "resolved") {
      setNotice({ tone: "warning", text: t("grant.uncertainResolved") });
    } else if (restored.kind === "expired") {
      setNotice({
        tone: "warning",
        text: t("grant.restoreExpired", { minutes: MEMBERSHIP_PENDING_GRANT_TTL_MS / 60_000 }),
      });
    }
  }, [adminScope, detail, detailReadable, t, uid]);

  const status = detail.effective_membership;
  const activeSources = useMemo(
    () => status.sources.filter((source) => source.contributes_to_access).map((source) => source.kind),
    [status.sources],
  );
  const storeAutoRenews = membershipStoreAutoRenews(status);
  const nonProductionOnly = membershipNonProductionOnlyAccess(detail);
  // What Core's gates answer for this member now (P-100 Part B); null falls back to the inference.
  const live = detail.live_access.state === "present" ? detail.live_access.access : null;
  const shownRollout: RolloutState = live ? live.rollout_mode : rollout;
  // No label while the rollout read is in flight; an unreadable read is labeled as unknown.
  const planLabel = shownRollout === "loading" ? null : t(`plan.${shownRollout}`);
  const editor = adminAccess === "ready" && (adminRole === "owner" || adminRole === "admin");
  const owner = adminAccess === "ready" && adminRole === "owner";
  const customWire = preset === "custom" ? toWireInstant(customExpiry) : null;
  const grantInputValid = editor && validReason(reason) && (preset !== "custom" || customWire !== null);
  const currentGrant = detail.admin_grant;
  const canEditGrant = editor && isEditableGrant(currentGrant);
  // While a grant request is pinned, no other grant mutation may run against the same member.
  const grantLocked = pendingGrant !== null;
  const expiryWire = toWireInstant(expiryEdit);
  const expiryChange = membershipExpiryChange(currentGrant?.expires_at ?? null, expiryWire);
  const expiryValid = canEditGrant && !grantLocked && expiryWire !== null && validReason(expiryReason)
    && (expiryChange !== "shorten" || owner);

  /** A quota limit or remainder as the saved-plan cards show it. */
  function quotaAmount(mode: MembershipQuotaMode, value: number | null): string {
    return mode === "unlimited" ? t("unlimited") : mode === "disabled" ? t("disabled") : String(value ?? 0);
  }

  function resetPreview() {
    setPreview(null);
    setNotice(null);
  }

  function adoptParsed(parsed: MembershipUserDetail) {
    setDetail(parsed);
    setExpiryEdit(toLocalInput(parsed.admin_grant?.expires_at ?? null));
  }

  function adopt(value: unknown): boolean {
    const parsed = membershipUserDetail(value);
    if (!parsed || parsed.uid !== uid) return false;
    adoptParsed(parsed);
    return true;
  }

  function actionErrorText(action: MembershipAction, error: unknown): string {
    return membershipErrors(membershipActionErrorKey(action, error));
  }

  /** Reads the authoritative member state; `null` when it could not be read. */
  async function reloadDetail(): Promise<MembershipUserDetail | null> {
    setBusy("reload");
    const parsed = await membershipReadUserDetail(adminCall, uid);
    setBusy("");
    if (parsed) adoptParsed(parsed);
    return parsed;
  }

  /** Keeps the in-memory pin and its tab-local stored copy together; `null` releases both. */
  function rememberPendingGrant(pending: MembershipPendingGrant | null) {
    setPendingGrant(pending);
    membershipRememberPendingGrant(membershipSessionStorage(), adminScope, uid, pending, Date.now());
  }

  /** Releases a pinned grant whose outcome is now known to be most likely applied. */
  function releaseResolvedGrant() {
    rememberPendingGrant(null);
    setPreview(null);
    setReason("");
    setNotice({ tone: "warning", text: t("grant.uncertainResolved") });
  }

  async function reload() {
    setNotice(null);
    if (!liveAccessPresent) void loadRollout();
    if (pendingGrant) {
      // A still-unchanged grant keeps the request pinned; only a changed grant releases it.
      setBusy("reload");
      const result = await membershipCheckPendingGrant(adminCall, uid, pendingGrant);
      setBusy("");
      if (result.kind === "unreadable") {
        setNotice({ tone: "error", text: t("loadError") });
        return;
      }
      adoptParsed(result.detail);
      if (result.kind === "changed") releaseResolvedGrant();
      return;
    }
    const refreshed = await reloadDetail();
    if (!refreshed) setNotice({ tone: "error", text: t("loadError") });
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
    if (!grantInputValid || grantLocked) return;
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
    // A retry replays the pinned body and needs no preview (a restored pin has none); a first
    // attempt needs a preview of valid input.
    if (!editor || (!pendingGrant && (!preview || !grantInputValid))) return;
    if (!pendingGrant && startMode === "start_now" && preview?.store_overlap
      && !window.confirm(t("grant.overlapConfirm"))) return;
    // The first attempt pins the exact body; a retry after an uncertain result resends it
    // unchanged, so Core replays its receipt instead of granting twice. The pin is stored before
    // each send, so a reload mid-request restores the same identity.
    setBusy("grant");
    setNotice(null);
    const result = await membershipSubmitGrant(adminCall, {
      uid,
      pending: pendingGrant,
      detail,
      preview,
      body: { ...grantBody(), reason: normalizedReason(reason) },
      mintRequestId: () => crypto.randomUUID(),
      persist: (pinned) => {
        membershipRememberPendingGrant(membershipSessionStorage(), adminScope, uid, pinned, Date.now());
      },
    });
    setBusy("");
    rememberPendingGrant(result.pending);
    if (result.detail) adoptParsed(result.detail);
    if (result.kind === "granted") {
      setReason("");
      setPreview(null);
      setNotice({ tone: "success", text: t("grantSaved") });
      return;
    }
    if (result.kind === "uncertainResolved") {
      releaseResolvedGrant();
      return;
    }
    if (result.kind === "uncertain") {
      setNotice({ tone: "error", text: membershipErrors("grantUncertain") });
      return;
    }
    if (result.kind === "previewStale") {
      // Nothing was sent: the grant moved since the preview, so the operator previews again.
      setPreview(null);
      setNotice({ tone: "warning", text: t("grant.previewStale") });
      return;
    }
    // A definite refusal or a conflict released the request identity.
    setPreview(null);
    setNotice({ tone: "error", text: membershipErrors(result.errorKey) });
  }

  async function discardPendingGrant() {
    if (!pendingGrant || !window.confirm(t("grant.discardConfirm"))) return;
    setBusy("reload");
    setNotice(null);
    const result = await membershipCheckPendingGrant(adminCall, uid, pendingGrant);
    setBusy("");
    if (result.kind === "unreadable") {
      // Without a fresh read the outcome cannot be compared, so the request stays pinned.
      setNotice({ tone: "error", text: t("grant.discardUnreadable") });
      return;
    }
    adoptParsed(result.detail);
    if (result.kind === "changed") {
      releaseResolvedGrant();
      return;
    }
    rememberPendingGrant(null);
    setPreview(null);
    setNotice({ tone: "warning", text: t("grant.discarded") });
  }

  async function updateExpiry() {
    if (!currentGrant || !expiryValid || !expiryWire || grantLocked) return;
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
      expected_grant_id: currentGrant.grant_id,
      expires_at: expiryWire,
      reason: normalizedReason(expiryReason),
      request_id: crypto.randomUUID(),
    });
    const adopted = response?.success === true && adopt(response.data);
    const outcome = membershipMutationOutcome("expiry_update", response, adopted);
    if (outcome !== "success") {
      // The expected revision fences a second attempt; an unknown outcome reads the authoritative
      // state so the operator sees whether the change landed before trying again.
      if (outcome === "conflict" && response?.data) adopt(response.data);
      if (outcome === "uncertain" || outcome === "conflict") await reloadDetail();
      setBusy("");
      setNotice({
        tone: "error",
        text: response?.success === true
          ? membershipErrors("invalidResponse")
          : actionErrorText("expiry_update", response?.error),
      });
      return;
    }
    setBusy("");
    setExpiryReason("");
    setNotice({ tone: "success", text: t("expirySaved") });
  }

  async function revokeGrant() {
    if (!owner || grantLocked || !currentGrant || !isEditableGrant(currentGrant) || !validReason(expiryReason)) return;
    if (!window.confirm(t("revokeConfirm"))) return;
    setBusy("revoke");
    setNotice(null);
    const response = await adminCall("membership_admin_grant_revoke", {
      uid,
      expected_revision: currentGrant.revision,
      expected_grant_id: currentGrant.grant_id,
      reason: normalizedReason(expiryReason),
      request_id: crypto.randomUUID(),
    });
    const adopted = response?.success === true && adopt(response.data);
    const outcome = membershipMutationOutcome("grant_revoke", response, adopted);
    if (outcome !== "success") {
      if (outcome === "conflict" && response?.data) adopt(response.data);
      if (outcome === "uncertain" || outcome === "conflict") await reloadDetail();
      setBusy("");
      setNotice({
        tone: "error",
        text: response?.success === true
          ? membershipErrors("invalidResponse")
          : actionErrorText("grant_revoke", response?.error),
      });
      return;
    }
    setExpiryReason("");
    setBusy("");
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
          {notice ? <p className={`alert alert-${notice.tone}`} role="status">{notice.text}</p> : null}
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
          <p className={`alert alert-${notice.tone}`} role="status">
            {notice.text}
          </p>
        ) : null}
        {live ? (
          <p
            className={`alert ${live.rollout_mode === "enforced" ? "alert-success" : live.rollout_mode === "deny" ? "alert-error" : "alert-warning"}`}
            role={live.rollout_mode === "deny" ? "alert" : "status"}
            data-live-rollout-state={live.rollout_mode}
          >
            {t(`live.rollout.${live.rollout_mode}`)}
          </p>
        ) : rollout === "loading" ? null : rollout === "enforced" ? (
          <p className="alert alert-success" role="status" data-rollout-state="enforced">{t("rollout.enforced")}</p>
        ) : rollout === "deny" ? (
          <p className="alert alert-error" role="alert" data-rollout-state="deny">{t("rollout.deny")}</p>
        ) : rollout === "legacy" ? (
          <p className="alert alert-warning" role="status" data-rollout-state="legacy">{t("rollout.legacy")}</p>
        ) : (
          <p className="alert alert-warning" role="status" data-rollout-state="unknown">{t("rollout.unknown")}</p>
        )}
        {detail.live_access.state === "invalid" ? (
          <p className="alert alert-warning" role="status" data-live-access="invalid">{t("live.invalid")}</p>
        ) : null}
        {nonProductionOnly ? (
          <p className="alert alert-warning" role="status" data-non-production-only="true">{t("store.nonProductionOnly")}</p>
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
            <div className="membership-subpanel-head">
              <div>
                <h3>{live ? t("capabilities.titleLive") : t("capabilities.title")}</h3>
                <p>{live ? t("capabilities.copyLive") : t("capabilities.copy")}</p>
              </div>
              {planLabel ? <span className="badge badge-info membership-plan-label" data-plan-label={shownRollout}>{planLabel}</span> : null}
            </div>
            <div className="membership-capability-list">
              {(["invisible_presence", "hide_profile_visit", "quick_phrases", "vip_badge"] as const).map((key) => {
                const saved = (
                  <strong className={`badge ${status.capabilities[key] ? "badge-active" : "badge-inactive"}`}>
                    {status.capabilities[key] ? common("enabled") : common("disabled")}
                  </strong>
                );
                if (!live) {
                  return <div key={key}><span>{t(`capabilities.items.${key}`)}</span>{saved}</div>;
                }
                const now = key === "quick_phrases"
                  ? membershipLiveQuickPhrases(live)
                  : live.capabilities[key] ? "enabled" : "disabled";
                return (
                  <div key={key}>
                    <span>{t(`capabilities.items.${key}`)}</span>
                    <span className="membership-access-compare">
                      <span className="membership-access-value"><small>{t("live.saved")}</small>{saved}</span>
                      <span className="membership-access-value" data-live-capability={key} data-live-value={now}>
                        <small>{t("live.now")}</small>
                        <strong className={`badge ${now === "enabled" ? "badge-active" : "badge-inactive"}`}>
                          {now === "enabled" ? common("enabled") : now === "disabled" ? common("disabled") : t("live.quickPhrasesOff")}
                        </strong>
                      </span>
                    </span>
                  </div>
                );
              })}
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
                {planLabel ? <small className="membership-plan-label" data-plan-label={shownRollout}>{planLabel}</small> : null}
                <strong>{t(`quotaModes.${quota.mode}`)}</strong>
                <dl className="membership-quota-detail">
                  <div><dt>{t("quota.scope")}</dt><dd>{t(`scopes.${quota.scope}`)}</dd></div>
                  <div><dt>{t("quota.used")}</dt><dd>{quota.used}</dd></div>
                  <div><dt>{t("quota.limit")}</dt><dd>{limit}</dd></div>
                  <div><dt>{t("quota.remaining")}</dt><dd>{remaining}</dd></div>
                  <div><dt>{t("quota.reset")}</dt><dd><InstantValue value={quota.reset_at} locale={locale} /></dd></div>
                </dl>
                {live ? (() => {
                  const now = live.quotas[key];
                  return (
                    <div className="membership-live-quota" data-live-quota={key} data-live-enforced={String(now.enforced)}>
                      <span>{t("live.now")} · {now.enforced ? t("live.planRule") : t("live.legacyRule")}</span>
                      <strong>{t(`quotaModes.${now.mode}`)}</strong>
                      <dl className="membership-quota-detail">
                        <div><dt>{t("quota.used")}</dt><dd>{now.used}</dd></div>
                        <div><dt>{t("quota.limit")}</dt><dd>{quotaAmount(now.mode, now.limit)}</dd></div>
                        <div><dt>{t("quota.remaining")}</dt><dd>{quotaAmount(now.mode, now.remaining)}</dd></div>
                        {now.reset_at ? (
                          <div><dt>{t("quota.reset")}</dt><dd><InstantValue value={now.reset_at} locale={locale} /></dd></div>
                        ) : null}
                      </dl>
                    </div>
                  );
                })() : null}
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
                <select value={preset} disabled={!editor || Boolean(busy) || grantLocked} onChange={(event) => { setPreset(event.target.value as GrantPreset); resetPreview(); }}>
                  <option value="plus_week">{t("presets.plus_week")}</option>
                  <option value="plus_month">{t("presets.plus_month")}</option>
                  <option value="plus_quarter">{t("presets.plus_quarter")}</option>
                  <option value="custom">{t("presets.custom")}</option>
                </select>
              </label>
              <label className="field">
                <span>{t("grant.startMode")}</span>
                <select value={startMode} disabled={!editor || Boolean(busy) || grantLocked} onChange={(event) => { setStartMode(event.target.value as StartMode); resetPreview(); }}>
                  <option value="extend">{t("grant.extend")}</option>
                  <option value="start_now">{t("grant.startNow")}</option>
                </select>
              </label>
              {startMode === "start_now" ? (
                <p className="alert alert-warning field-full">{t("grant.startNowWarning")}</p>
              ) : null}
              {startMode === "extend" && storeAutoRenews ? (
                <p className="alert alert-warning field-full" data-extend-auto-renew="true">{t("grant.extendAutoRenewWarning")}</p>
              ) : null}
              {preset === "custom" ? (
                <label className="field field-full">
                  <span>{t("grant.customExpiry")}</span>
                  <input type="datetime-local" step={1} value={customExpiry} disabled={!editor || Boolean(busy) || grantLocked} onChange={(event) => { setCustomExpiry(event.target.value); resetPreview(); }} />
                </label>
              ) : null}
              <label className="field field-full">
                <span>{t("reason")}</span>
                <textarea maxLength={500} value={reason} disabled={!editor || Boolean(busy) || grantLocked} placeholder={t("reasonPlaceholder")} onChange={(event) => { setReason(event.target.value); resetPreview(); }} />
                <small className="field-hint">{t("reasonHint")}</small>
              </label>
            </div>
            <div className="row-actions">
              <button type="button" className="button button-secondary" disabled={!grantInputValid || Boolean(busy) || grantLocked} onClick={() => void previewGrant()}>
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
                <div className="row-actions">
                  <button type="button" className="button button-primary" disabled={Boolean(busy)} onClick={() => void confirmGrant()}>
                    {busy === "grant" ? common("saving") : pendingGrant?.uncertain ? t("grant.retry") : t("grant.confirm")}
                  </button>
                  {pendingGrant?.uncertain ? (
                    <button type="button" className="button button-secondary" disabled={Boolean(busy)} onClick={() => void discardPendingGrant()}>
                      {t("grant.discard")}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {!preview && pendingGrant?.uncertain ? (
              <div className="membership-preview" role="status" data-grant-pending="true">
                <h4>{t("grant.pendingTitle")}</h4>
                <p className="alert alert-warning">{t("grant.pendingCopy")}</p>
                <div className="row-actions">
                  <button type="button" className="button button-primary" disabled={!editor || Boolean(busy)} onClick={() => void confirmGrant()}>
                    {busy === "grant" ? common("saving") : t("grant.retry")}
                  </button>
                  <button type="button" className="button button-secondary" disabled={Boolean(busy)} onClick={() => void discardPendingGrant()}>
                    {t("grant.discard")}
                  </button>
                </div>
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
                  <input type="datetime-local" step={1} value={expiryEdit} disabled={!editor || Boolean(busy) || grantLocked} onChange={(event) => setExpiryEdit(event.target.value)} />
                </label>
                <label className="field">
                  <span>{t("reason")}</span>
                  <textarea maxLength={500} value={expiryReason} disabled={!editor || Boolean(busy) || grantLocked} placeholder={t("reasonPlaceholder")} onChange={(event) => setExpiryReason(event.target.value)} />
                </label>
                {grantLocked ? <p className="alert alert-warning" data-grant-locked="true">{t("manage.lockedByPendingGrant")}</p> : null}
                {!owner ? <p className="field-hint">{t("manage.shortenOwnerOnly")}</p> : null}
                {expiryChange === "shorten" ? <p className="alert alert-warning">{t("manage.shortenWarning")}</p> : null}
                <div className="row-actions">
                  <button type="button" className="button button-secondary" disabled={!expiryValid || Boolean(busy)} onClick={() => void updateExpiry()}>
                    {busy === "expiry" ? common("saving") : t("manage.saveExpiry")}
                  </button>
                  {owner ? (
                    <button type="button" className="button button-danger" disabled={!validReason(expiryReason) || Boolean(busy) || grantLocked} onClick={() => void revokeGrant()}>
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
                  const contribution = membershipStoreRowContribution(
                    source,
                    status.sources,
                    detail.store_sources,
                  );
                  const environment = membershipStoreEnvironment(source.environment);
                  return (
                    <tr key={`${source.platform}-${source.product_id}-${source.expires_at ?? index}`}>
                      <td>
                        <span>{source.platform}</span>
                        {environment === "sandbox" || environment === "test" ? (
                          <span className="badge badge-warning membership-environment-badge" data-store-environment={environment}>
                            {t(`store.environments.${environment}`)}
                          </span>
                        ) : (
                          <small className="table-subline" data-store-environment={environment ?? "unknown"}>
                            {t(`store.environments.${environment ?? "unknown"}`)}
                          </small>
                        )}
                      </td>
                      <td>{source.product_id || "—"}</td>
                      <td>{source.base_plan_id || "—"}</td>
                      <td><span>{source.normalized_state || "—"}</span><small className="table-subline">{source.provider_state || "—"}</small></td>
                      <td>
                        <span className={`badge ${source.verification_status === "verified" ? "badge-active" : "badge-warning"}`}>
                          {source.verification_status || t("store.unknown")}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`badge ${contribution === "contributing" ? "badge-active" : contribution === "unknown" ? "badge-warning" : "badge-inactive"}`}
                          data-store-contribution={contribution}
                        >
                          {t(`store.${contribution}`)}
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
