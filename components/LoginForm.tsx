"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import {
  isVerificationCodeComplete,
  normalizeVerificationCode,
  VERIFICATION_CODE_DIGITS,
} from "@/lib/authCode";

type Step = "email" | "code";

export default function LoginForm() {
  const t = useTranslations("login");
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function errorText(value?: string): string {
    switch (value) {
      case "invalid":
      case "invalid-code":
        return t("invalid");
      case "expired":
        return t("expired");
      case "banned":
        return t("banned");
      case "rate-limited":
        return t("rateLimited");
      case "request-failed":
      case "core-unavailable":
        return t("requestFailed");
      default:
        return t("genericError");
    }
  }

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (response.ok && data?.ok) {
        setStep("code");
        return;
      }
      setError(errorText(data?.error));
    } catch {
      setError(t("genericError"));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await response.json();
      if (response.ok && data?.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      setError(errorText(data?.error));
    } catch {
      setError(t("genericError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <section className="login-story">
        <div className="login-story-inner">
          <div className="login-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" width="58" height="58" alt="" />
            <span><strong>Freelove</strong><small>Admin</small></span>
          </div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1>{t("brandHeadline")}<br /><span>{t("brandHeadlineAccent")}</span></h1>
          <p className="login-story-copy">{t("brandCopy")}</p>
          <div className="security-note">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>
            <span>{t("securityNote")}</span>
          </div>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-locale"><LocaleSwitcher /></div>
        <div className="login-card">
          <div className="login-mobile-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" width="48" height="48" alt="" />
            <strong>Freelove</strong>
          </div>
          <h2>{step === "email" ? t("title") : t("codeTitle")}</h2>
          <p className="login-intro">
            {step === "email" ? t("subtitle") : t("codeIntro", { email })}
          </p>

          {step === "email" ? (
            <form className="form-stack" onSubmit={requestCode}>
              <label className="field">
                <span>{t("emailLabel")}</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={t("emailPlaceholder")}
                />
              </label>
              {error && <div className="alert alert-error" role="alert">{error}</div>}
              <button className="button button-primary button-wide" disabled={busy || !email.trim()}>
                {busy ? t("sending") : t("sendCode")}
              </button>
            </form>
          ) : (
            <form className="form-stack" onSubmit={verifyCode}>
              <label className="field">
                <span>{t("codeLabel")}</span>
                <input
                  className="code-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  autoFocus
                  maxLength={VERIFICATION_CODE_DIGITS}
                  value={code}
                  onChange={(event) => setCode(normalizeVerificationCode(event.target.value))}
                  placeholder={t("codePlaceholder")}
                />
              </label>
              {error && <div className="alert alert-error" role="alert">{error}</div>}
              <button
                className="button button-primary button-wide"
                disabled={busy || !isVerificationCodeComplete(code)}
              >
                {busy ? t("verifying") : t("verify")}
              </button>
              <button
                type="button"
                className="button-link"
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setError("");
                }}
              >
                {t("changeEmail")}
              </button>
            </form>
          )}
          <p className="login-privacy">{t("privacy")}</p>
        </div>
      </section>
    </div>
  );
}
