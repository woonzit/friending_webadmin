"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import {
  APP_REVIEW_CHECK_KEYS,
  APP_REVIEW_COUNT_KEYS,
  appReviewResetAvailable,
  appReviewPendingReset,
  appReviewResetConverged,
  appReviewResetErrorKey,
  appReviewResetResult,
  appReviewResetShouldRetainRequest,
  appReviewSandboxStatus,
  type AppReviewCheckKey,
  type AppReviewCountKey,
  type AppReviewPendingReset,
  type AppReviewSandboxStatus,
} from "@/lib/appReviewSandbox";
import { formatDate, formatNumber } from "@/lib/format";

type Notice = { tone: "success" | "error"; text: string };
const PENDING_RESET_STORAGE_KEY = "freelove.app-review.pending-reset.v1";

function scalarText(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export default function AppReviewSandboxPage() {
  const t = useTranslations("appReview");
  const common = useTranslations("common");
  const locale = useLocale();
  const [status, setStatus] = useState<AppReviewSandboxStatus | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [phrase, setPhrase] = useState("");
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pendingReset, setPendingReset] = useState<AppReviewPendingReset | null>(null);
  const pendingResetRef = useRef<AppReviewPendingReset | null>(null);

  const rememberPendingReset = useCallback((pending: AppReviewPendingReset | null) => {
    pendingResetRef.current = pending;
    setPendingReset(pending);
    if (pending) {
      window.sessionStorage.setItem(PENDING_RESET_STORAGE_KEY, JSON.stringify(pending));
    } else {
      window.sessionStorage.removeItem(PENDING_RESET_STORAGE_KEY);
    }
  }, []);

  const load = useCallback(async (): Promise<AppReviewSandboxStatus | null> => {
    const response = await adminCall("app_review_sandbox_status");
    const decoded = response?.success ? appReviewSandboxStatus(response.data) : null;
    if (!decoded) {
      setState("error");
      return null;
    }
    const pending = pendingResetRef.current;
    if (pending && appReviewResetConverged(decoded, pending)) {
      rememberPendingReset(null);
      setPhrase("");
      setNotice({
        tone: "success",
        text: t("resetRecovered", { revision: decoded.control.resetRevision }),
      });
    } else if (
      pending
      && decoded.control.resetRevision !== pending.expectedRevision
      && decoded.control.lastResetRequestId !== pending.requestId
    ) {
      rememberPendingReset(null);
      setNotice({ tone: "error", text: t("errors.revisionConflict") });
    }
    setStatus(decoded);
    setState("ready");
    return decoded;
  }, [rememberPendingReset, t]);

  useEffect(() => {
    const serialized = window.sessionStorage.getItem(PENDING_RESET_STORAGE_KEY);
    if (serialized) {
      try {
        const restored = appReviewPendingReset(JSON.parse(serialized));
        if (restored) {
          pendingResetRef.current = restored;
          setPendingReset(restored);
        } else {
          window.sessionStorage.removeItem(PENDING_RESET_STORAGE_KEY);
        }
      } catch {
        window.sessionStorage.removeItem(PENDING_RESET_STORAGE_KEY);
      }
    }
    void load();
  }, [load]);

  const resetAvailable = useMemo(
    () => (status ? appReviewResetAvailable(status, pendingReset !== null) : false),
    [pendingReset, status],
  );
  const phraseMatches = status !== null && phrase === status.resetConfirmation;

  async function reset(event: React.FormEvent) {
    event.preventDefault();
    if (!status || !resetAvailable || !phraseMatches || resetting) return;
    setResetting(true);
    setNotice(null);
    // Keep the request id and its original revision until Core proves that
    // exact request converged. This covers lost responses and post-commit
    // finishing failures, including a page refresh in the same browser tab.
    const request = pendingReset ?? {
      requestId: crypto.randomUUID(),
      expectedRevision: status.control.resetRevision,
    };
    if (!pendingReset) rememberPendingReset(request);
    const response = await adminCall("app_review_sandbox_reset", {
      request_id: request.requestId,
      expected_revision: request.expectedRevision,
      confirmation: phrase,
    });
    const result = response?.success ? appReviewResetResult(response.data) : null;
    if (!result) {
      const key = appReviewResetErrorKey(response?.error);
      setNotice({ tone: "error", text: t(`errors.${key}`) });
      if (!appReviewResetShouldRetainRequest(response?.error)) rememberPendingReset(null);
      // The authoritative state after a refusal is whatever Core holds now —
      // a revision conflict in particular means the page was stale.
      await load();
      setResetting(false);
      return;
    }
    setStatus(result.status);
    setPhrase("");
    rememberPendingReset(null);
    if (!appReviewResetConverged(result.status, request)) {
      setNotice({ tone: "error", text: t("resetCompletedNotReady") });
      setResetting(false);
      return;
    }
    setNotice({
      tone: "success",
      text: result.replayed
        ? t("resetReplayed", { revision: result.status.control.resetRevision })
        : t("resetDone", { revision: result.status.control.resetRevision }),
    });
    setResetting(false);
  }

  if (state === "loading" && !status) return <LoadingPanel />;
  if (state === "error" || !status) {
    return <ErrorPanel message={t("loadError")} retry={() => { setState("loading"); void load(); }} />;
  }

  const { control, env } = status;
  const resetStateText = control.resetState === "running"
    ? t("resetStateRunning")
    : control.resetState === "finishing"
      ? t("resetStateFinishing")
      : control.resetState === "failed"
        ? t("resetStateFailed", { error: control.resetError || "—" })
        : t("resetStateIdle");

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <button className="button button-secondary" onClick={() => { void load(); }} disabled={resetting}>
            {t("refresh")}
          </button>
        }
      />

      {notice && (
        <div className={`notice notice-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </div>
      )}

      <section className="panel" aria-labelledby="app-review-identity">
        <h2 id="app-review-identity">{t("identityTitle")}</h2>
        <dl className="detail-grid">
          <div><dt>{t("reviewUid")}</dt><dd>{control.reviewUid > 0 ? formatNumber(control.reviewUid, locale) : "—"}</dd></div>
          <div><dt>{t("reviewEmail")}</dt><dd>{env.email || (env.emailConfigured ? t("configured") : t("notConfigured"))}</dd></div>
          <div><dt>{t("reviewPhone")}</dt><dd>{env.phone || (env.phoneConfigured ? t("configured") : t("notConfigured"))}</dd></div>
          <div><dt>{t("loginEnabled")}</dt><dd>{env.loginEnabled ? common("enabled") : common("disabled")}</dd></div>
          <div><dt>{t("codeConfigured")}</dt><dd>{env.codeConfigured ? t("configured") : t("notConfigured")}</dd></div>
          <div><dt>{t("demoSystem")}</dt><dd>{env.demoSystemEnabled ? common("enabled") : common("disabled")}</dd></div>
        </dl>
        {control.present && !env.uidMatchesControl && (
          <p className="notice notice-error" role="alert">
            {t("envMismatch", { control: control.reviewUid, env: env.uidConfigured })}
          </p>
        )}
      </section>

      <section className="panel" aria-labelledby="app-review-control">
        <h2 id="app-review-control">{t("controlTitle")}</h2>
        {!control.present && <p className="notice notice-error" role="alert">{t("controlAbsent")}</p>}
        {control.present && control.state === "prepared" && (
          <p className="notice notice-error" role="alert">{t("controlPrepared")}</p>
        )}
        <dl className="detail-grid">
          <div>
            <dt>{common("status")}</dt>
            <dd>
              <span className={`badge ${status.ready ? "badge-success" : "badge-muted"}`}>
                {status.ready ? t("readyYes") : t("readyNo")}
              </span>
            </dd>
          </div>
          <div><dt>{t("fixture", { fixture: status.fixture, version: status.fixtureVersion })}</dt><dd>{t("revision", { revision: control.resetRevision })}</dd></div>
          <div>
            <dt>{resetStateText}</dt>
            <dd>
              {control.lastResetAt > 0
                ? t("lastReset", { date: formatDate(control.lastResetAt, locale, true), actor: control.lastResetBy || "—" })
                : t("neverReset")}
            </dd>
          </div>
          <div><dt>{t("reprovisionState")}</dt><dd>{t(`reprovisionStates.${control.reprovisionState}`)}</dd></div>
          <div><dt>{t("mediaReadiness")}</dt><dd>{t("mediaCount", { valid: status.media.valid, expected: status.media.expected })}</dd></div>
        </dl>
        {!status.contentComplete && <p className="page-subtitle">{t("contentIncomplete")}</p>}
      </section>

      <section className="panel" aria-labelledby="app-review-counts">
        <h2 id="app-review-counts">{t("countsTitle")}</h2>
        <dl className="detail-grid">
          {APP_REVIEW_COUNT_KEYS.map((key: AppReviewCountKey) => (
            <div key={key}>
              <dt>{t(`counts.${key}`)}</dt>
              <dd>{formatNumber(status.counts[key], locale)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="panel" aria-labelledby="app-review-checks">
        <h2 id="app-review-checks">{t("checksTitle")}</h2>
        <ul className="check-list">
          {status.checks.map((check) => (
            <li key={check.key} className={check.ok ? "check-ok" : "check-failed"}>
              <span className={`badge ${check.ok ? "badge-success" : "badge-error"}`} aria-hidden="true">
                {check.ok ? "✓" : "✕"}
              </span>
              <span>{t(`checks.${check.key as AppReviewCheckKey}`)}</span>
              {!check.ok && (
                <small>
                  {" "}{t("checkActual", { actual: scalarText(check.actual) })}
                  {" · "}{t("checkExpected", { expected: scalarText(check.expected) })}
                </small>
              )}
            </li>
          ))}
          {APP_REVIEW_CHECK_KEYS.every((key) => status.checks.some((check) => check.key === key)) ? null : (
            <li className="check-failed"><small>{t("checkExpected", { expected: APP_REVIEW_CHECK_KEYS.join(", ") })}</small></li>
          )}
        </ul>
      </section>

      <section className="panel" aria-labelledby="app-review-reset">
        <h2 id="app-review-reset">{t("resetTitle")}</h2>
        <p className="page-subtitle">{t("resetCopy")}</p>
        {pendingReset && <p className="notice notice-muted">{t("resetRetryPending")}</p>}
        {!resetAvailable && <p className="notice notice-muted">{t("resetUnavailable")}</p>}
        <form onSubmit={reset} className="form-row">
          <label>
            <span>{t("resetPhraseLabel")}</span>
            <input
              type="text"
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              placeholder={status.resetConfirmation}
              autoComplete="off"
              spellCheck={false}
              disabled={!resetAvailable || resetting}
            />
          </label>
          <button className="button button-danger" type="submit" disabled={!resetAvailable || !phraseMatches || resetting}>
            {resetting ? t("resetting") : t("resetButton")}
          </button>
        </form>
      </section>
    </>
  );
}
