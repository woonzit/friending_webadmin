"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { adminCall } from "@/lib/adminClient";
import { formatDate } from "@/lib/format";

// Wire mirror of Core's ModerationPolicy::statusWire + the service extras.
export type ModerationStatus = {
  banned: boolean;
  ban_reason: string;
  banned_at: number;
  suspended: boolean;
  suspended_until: number;
  suspend_reason: string;
  hidden_from_members: boolean;
  last_ip: string;
  ip_banned: boolean;
  footprints_daily_limit: number | null;
};

// Core's SUSPEND_PRESETS, minutes.
const SUSPEND_PRESETS = [10, 60, 600, 1440, 10080, 43200];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function parseModerationStatus(value: unknown): ModerationStatus | null {
  const source = record(value);
  if (!source) return null;
  if (typeof source.banned !== "boolean" || typeof source.suspended !== "boolean"
    || typeof source.hidden_from_members !== "boolean") return null;
  if (typeof source.suspended_until !== "number" || typeof source.banned_at !== "number") return null;
  return {
    banned: source.banned,
    ban_reason: typeof source.ban_reason === "string" ? source.ban_reason : "",
    banned_at: source.banned_at,
    suspended: source.suspended,
    suspended_until: source.suspended_until,
    suspend_reason: typeof source.suspend_reason === "string" ? source.suspend_reason : "",
    hidden_from_members: source.hidden_from_members,
    last_ip: typeof source.last_ip === "string" ? source.last_ip : "",
    ip_banned: source.ip_banned === true,
    footprints_daily_limit: typeof source.footprints_daily_limit === "number" ? source.footprints_daily_limit : null,
  };
}

/** Whole units of the time left until `until`; null when lapsed/indefinite. */
export function remainingParts(until: number, nowMs: number): { d: number; h: number; m: number } | null {
  if (!Number.isFinite(until) || until <= 0) return null;
  const left = until * 1000 - nowMs;
  if (left <= 0) return null;
  const minutes = Math.max(1, Math.floor(left / 60000));
  return {
    d: Math.floor(minutes / 1440),
    h: Math.floor((minutes % 1440) / 60),
    m: minutes % 60,
  };
}

export function validModerationReason(value: string): boolean {
  return value.trim().length > 0;
}

export function validSuspendMinutesInput(value: string): boolean {
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return false;
  const minutes = Number(trimmed);
  return Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= 129600;
}

/** A suspension may be replaced or escalated; a permanent ban must be lifted first. */
export function canComposeRestriction(status: Pick<ModerationStatus, "banned">): boolean {
  return !status.banned;
}

// Lazy: tests import this module for the pure parsers, and module-level JSX
// would evaluate at import time under the node test loader.
function moderationIcon(name: "shield" | "clock" | "globe" | "power" | "coins"): JSX.Element {
  return ICON_TABLE[name]();
}

const ICON_TABLE: Record<string, () => JSX.Element> = {
  shield: () => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 2.5 4 4.8v4.4c0 3.8 2.6 6.6 6 8.3 3.4-1.7 6-4.5 6-8.3V4.8L10 2.5Z" />
    </svg>
  ),
  clock: () => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="10" r="7" /><path d="M10 6v4.2l2.8 1.6" />
    </svg>
  ),
  globe: () => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="10" r="7" /><path d="M3 10h14M10 3c2.2 2 3.2 4.4 3.2 7S12.2 15 10 17c-2.2-2-3.2-4.4-3.2-7S7.8 5 10 3Z" />
    </svg>
  ),
  power: () => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 3v6" /><path d="M6 5.6a6 6 0 1 0 8 0" />
    </svg>
  ),
  coins: () => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="10" cy="5.5" rx="6" ry="2.6" /><path d="M4 5.5v4c0 1.4 2.7 2.6 6 2.6s6-1.2 6-2.6v-4" /><path d="M4 9.5v4c0 1.4 2.7 2.6 6 2.6s6-1.2 6-2.6v-4" />
    </svg>
  ),
};

export default function UserModerationPanel({ uid }: { uid: number }) {
  const t = useTranslations("moderation");
  const locale = useLocale();
  const [status, setStatus] = useState<ModerationStatus | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  // Restriction composer state.
  const [mode, setMode] = useState<"suspend" | "ban">("suspend");
  const [preset, setPreset] = useState<number>(SUSPEND_PRESETS[2]);
  const [customOpen, setCustomOpen] = useState(false);
  const [customMinutes, setCustomMinutes] = useState("");
  const [reason, setReason] = useState("");
  // Two-step confirmation: the marker of the action awaiting its second click.
  const [confirming, setConfirming] = useState("");
  const [quota, setQuota] = useState("");
  const [quotaLoaded, setQuotaLoaded] = useState(false);
  const [quotaSaved, setQuotaSaved] = useState(false);
  // A minute tick so the "time left" line does not go stale while open.
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(""), 5_000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  const adopt = useCallback((parsed: ModerationStatus) => {
    setStatus(parsed);
    setState("ready");
    setQuotaLoaded((loaded) => {
      if (!loaded) setQuota(parsed.footprints_daily_limit === null ? "" : String(parsed.footprints_daily_limit));
      return true;
    });
  }, []);

  const load = useCallback(async () => {
    setState("loading");
    const response = await adminCall("user_moderation", { uid });
    const parsed = response?.success ? parseModerationStatus(response.moderation) : null;
    if (!parsed) {
      setState("error");
      return;
    }
    adopt(parsed);
  }, [adopt, uid]);

  useEffect(() => { void load(); }, [load]);

  // Every mutation returns the fresh moderation block, so a successful command
  // re-renders the authoritative state without a second read.
  async function run(marker: string, action: string, body: Record<string, unknown>) {
    setBusy(marker);
    setActionError("");
    setConfirming("");
    const response = await adminCall(action, { uid, ...body });
    setBusy("");
    const parsed = response?.success ? parseModerationStatus(response.moderation) : null;
    if (!parsed) {
      setActionError(typeof response?.error === "string" && response.error ? response.error : "request-failed");
      return;
    }
    adopt(parsed);
    setReason("");
    setCustomMinutes("");
    setCustomOpen(false);
  }

  /** Dangerous commands need a second click on the same button within 5s. */
  function confirmThen(marker: string, action: string, body: Record<string, unknown>) {
    if (confirming !== marker) {
      setConfirming(marker);
      return;
    }
    void run(marker, action, body);
  }

  async function saveQuota() {
    setBusy("quota");
    setActionError("");
    setQuotaSaved(false);
    const response = await adminCall("set_footprint_user_limit", { uid, limit: quota.trim() });
    setBusy("");
    if (!response?.success) {
      setActionError(typeof response?.error === "string" && response.error ? response.error : "request-failed");
      return;
    }
    setQuotaSaved(true);
  }

  if (state === "loading") {
    return (
      <section className="panel modx-panel">
        <div className="panel-header"><div><h2>{t("title")}</h2><p>{t("copy")}</p></div></div>
        <div className="panel-body"><div className="modx-skeleton" aria-hidden="true"><span /><span /><span /></div></div>
      </section>
    );
  }
  if (state === "error" || !status) {
    return (
      <section className="panel modx-panel">
        <div className="panel-header"><div><h2>{t("title")}</h2></div></div>
        <div className="panel-body">
          <p className="alert alert-error">{t("loadError")}</p>
          <button type="button" className="button-secondary" onClick={() => void load()}>{t("retry")}</button>
        </div>
      </section>
    );
  }

  const restricted = status.banned || status.suspended;
  const pillClass = status.banned ? "is-banned" : status.suspended ? "is-suspended" : "is-active";
  const pillLabel = status.banned ? t("stateBanned") : status.suspended ? t("stateSuspendedShort") : t("stateActive");
  const minutesValue = customOpen && customMinutes.trim() !== "" ? customMinutes.trim() : String(preset);
  const reasonValid = validModerationReason(reason);
  const customMinutesValid = !customOpen || validSuspendMinutesInput(customMinutes);
  const left = status.suspended ? remainingParts(status.suspended_until, nowMs) : null;
  const remainingText = left
    ? left.d > 0
      ? t("remainingDH", { d: left.d, h: left.h })
      : left.h > 0
        ? t("remainingHM", { h: left.h, m: left.m })
        : t("remainingM", { m: left.m })
    : null;

  return (
    <section className="panel modx-panel">
      <div className="panel-header modx-header">
        <div>
          <h2>{t("title")}</h2>
          <p>{t("copy")}</p>
        </div>
        <span className={`modx-pill ${pillClass}`}>
          <span className="modx-pill-dot" aria-hidden="true" />
          {pillLabel}
        </span>
      </div>
      <div className="panel-body">
        {actionError ? <p className="alert alert-error" role="alert">{t("actionError", { code: actionError })}</p> : null}

        <div className="modx-layout">
          <div className="modx-main">
            {status.banned ? (
              <div className="modx-banner is-banned" role="status">
                <div className="modx-banner-head">
                  <span className="modx-banner-icon">{moderationIcon("shield")}</span>
                  <strong>{t("bannerBannedTitle")}</strong>
                </div>
                <dl className="modx-facts">
                  {status.banned_at > 0 ? (
                    <div><dt>{t("factSince")}</dt><dd>{formatDate(status.banned_at, locale, true)}</dd></div>
                  ) : null}
                  {status.ban_reason ? (
                    <div><dt>{t("reasonLabel")}</dt><dd>{status.ban_reason}</dd></div>
                  ) : null}
                  <div><dt>{t("factVisibility")}</dt><dd>{t("hiddenNote")}</dd></div>
                </dl>
                <button type="button" className="button-secondary" disabled={Boolean(busy)} onClick={() => void run("unban", "unban_user", {})}>
                  {busy === "unban" ? "…" : t("unban")}
                </button>
              </div>
            ) : (
              <>
                {status.suspended ? (
                  <div className="modx-banner is-suspended" role="status">
                    <div className="modx-banner-head">
                      <span className="modx-banner-icon">{moderationIcon("clock")}</span>
                      <strong>{t("bannerSuspendedTitle")}</strong>
                      {remainingText ? <span className="modx-remaining">{remainingText}</span> : null}
                    </div>
                    <dl className="modx-facts">
                      <div>
                        <dt>{t("factUntil")}</dt>
                        <dd>
                          {status.suspended_until > 0
                            ? formatDate(status.suspended_until, locale, true)
                            : t("indefinite")}
                        </dd>
                      </div>
                      {status.suspend_reason ? (
                        <div><dt>{t("reasonLabel")}</dt><dd>{status.suspend_reason}</dd></div>
                      ) : null}
                      <div><dt>{t("factVisibility")}</dt><dd>{t("hiddenNote")}</dd></div>
                    </dl>
                    <button type="button" className="button-secondary" disabled={Boolean(busy)} onClick={() => void run("unsuspend", "unsuspend_user", {})}>
                      {busy === "unsuspend" ? "…" : t("unsuspend")}
                    </button>
                  </div>
                ) : null}

                <div className="modx-composer">
                <div className="modx-seg" role="tablist" aria-label={t("restrictionTitle")}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === "suspend"}
                    className={mode === "suspend" ? "is-on" : ""}
                    onClick={() => { setMode("suspend"); setConfirming(""); }}
                  >
                    {t("tabSuspend")}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === "ban"}
                    className={mode === "ban" ? "is-on" : ""}
                    onClick={() => { setMode("ban"); setConfirming(""); }}
                  >
                    {t("tabBan")}
                  </button>
                </div>

                {mode === "suspend" ? (
                  <>
                    <p className="modx-help">{t("suspendHelp")}</p>
                    <div className="modx-chiprow" role="group" aria-label={t("suspendDuration")}>
                      {SUSPEND_PRESETS.map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={`modx-chip${!customOpen && preset === value ? " is-on" : ""}`}
                          onClick={() => { setPreset(value); setCustomOpen(false); setConfirming(""); }}
                        >
                          {t(`preset.${value}`)}
                        </button>
                      ))}
                      <button
                        type="button"
                        className={`modx-chip${customOpen ? " is-on" : ""}`}
                        onClick={() => { setCustomOpen(true); setConfirming(""); }}
                      >
                        {t("customChip")}
                      </button>
                      {customOpen ? (
                        <span className="modx-custom">
                          <input
                            type="number"
                            min={1}
                            max={129600}
                            step={1}
                            value={customMinutes}
                            autoFocus
                            aria-label={t("customLabel")}
                            aria-invalid={!customMinutesValid}
                            onChange={(event) => { setCustomMinutes(event.target.value); setConfirming(""); }}
                          />
                          {t("customUnit")}
                        </span>
                      ) : null}
                    </div>
                    {customOpen && !customMinutesValid ? <small className="modx-validation" role="alert">{t("durationInvalid")}</small> : null}
                  </>
                ) : (
                  <p className="modx-help is-danger">{t("banHelp")}</p>
                )}

                <label className="field modx-reason">
                  <span>{t("reasonLabelRequired")}</span>
                  <input
                    type="text"
                    maxLength={300}
                    required
                    value={reason}
                    placeholder={t("reasonPlaceholder")}
                    aria-invalid={reason.length > 0 && !reasonValid}
                    onChange={(event) => { setReason(event.target.value); setConfirming(""); }}
                  />
                  <small>{t("reasonRequired")}</small>
                </label>

                {mode === "suspend" ? (
                  <button
                    type="button"
                    className={`modx-cta${confirming === "suspend" ? " is-confirming" : ""}`}
                    disabled={Boolean(busy) || !reasonValid || !customMinutesValid}
                    onClick={() => confirmThen("suspend", "suspend_user", { minutes: minutesValue, reason })}
                  >
                    {busy === "suspend"
                      ? "…"
                      : confirming === "suspend"
                        ? t("confirmTap")
                        : status.suspended
                          ? t("resuspendCta")
                          : t("suspendCta")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`modx-cta is-ban${confirming === "ban" ? " is-confirming" : ""}`}
                    disabled={Boolean(busy) || !reasonValid}
                    onClick={() => confirmThen("ban", "ban_user", { reason })}
                  >
                    {busy === "ban" ? "…" : confirming === "ban" ? t("confirmTap") : t("banCta")}
                  </button>
                )}
                </div>
              </>
            )}
          </div>

          <div className="modx-side">
            <div className="modx-row">
              <span className="modx-row-icon">{moderationIcon("globe")}</span>
              <div className="modx-row-body">
                <strong>{t("ipTitle")}</strong>
                <span className="modx-row-detail">
                  {status.last_ip ? <code className="modx-ip">{status.last_ip}</code> : t("ipNone")}
                  {status.ip_banned ? <em className="modx-flag">{t("ipBannedChip")}</em> : null}
                </span>
                <small>{t("ipHelp")}</small>
              </div>
              {status.ip_banned ? (
                <button
                  type="button"
                  className="modx-mini"
                  disabled={Boolean(busy) || !status.last_ip}
                  onClick={() => void run("ip-unban", "remove_ip_ban", { ip: status.last_ip })}
                >
                  {busy === "ip-unban" ? "…" : t("removeIpBan")}
                </button>
              ) : (
                <button
                  type="button"
                  className={`modx-mini is-danger${confirming === "ip-ban" ? " is-confirming" : ""}`}
                  disabled={Boolean(busy) || !status.last_ip}
                  onClick={() => confirmThen("ip-ban", "ban_user_ip", {})}
                >
                  {busy === "ip-ban" ? "…" : confirming === "ip-ban" ? t("confirmTap") : t("banIp")}
                </button>
              )}
            </div>

            <div className="modx-row">
              <span className="modx-row-icon">{moderationIcon("power")}</span>
              <div className="modx-row-body">
                <strong>{t("sessionTitle")}</strong>
                <small>{t("sessionCopy")}</small>
              </div>
              <button
                type="button"
                className={`modx-mini${confirming === "logout" ? " is-confirming" : ""}`}
                disabled={Boolean(busy)}
                onClick={() => confirmThen("logout", "force_logout_user", {})}
              >
                {busy === "logout" ? "…" : confirming === "logout" ? t("confirmTap") : t("forceLogout")}
              </button>
            </div>

            <div className="modx-row">
              <span className="modx-row-icon">{moderationIcon("coins")}</span>
              <div className="modx-row-body">
                <strong>{t("quotaTitle")}</strong>
                <small>{t("quotaCopy")}</small>
                {quotaSaved ? <em className="modx-saved" role="status">{t("quotaSaved")}</em> : null}
              </div>
              <span className="modx-quota">
                <input
                  type="number"
                  min={0}
                  max={1000}
                  value={quota}
                  placeholder={t("quotaDefaultPlaceholder")}
                  aria-label={t("quotaLabel")}
                  onChange={(event) => { setQuota(event.target.value); setQuotaSaved(false); }}
                />
                <button type="button" className="modx-mini" disabled={Boolean(busy)} onClick={() => void saveQuota()}>
                  {busy === "quota" ? "…" : t("quotaSave")}
                </button>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
