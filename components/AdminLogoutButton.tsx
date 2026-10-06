"use client";
import React, { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { confirmResearchNavigation } from "@/lib/datesResearchNavigation";

/** The neutral shell has no protected router/page context. Logout needs no Core proof. */
export async function logoutWithoutCore() {
  if (!await confirmResearchNavigation()) return;
  const response = await fetch("/api/auth/logout", { method: "POST" });
  if (!response.ok) throw new Error("admin-logout-failed");
  window.location.assign("/login");
}
export default function AdminLogoutButton({ onLogout = logoutWithoutCore, className = "secondary-button" }: {
  onLogout?: () => Promise<void>; className?: string;
}) {
  const common = useTranslations("common"), t = useTranslations("adminMembership");
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), inFlight = useRef(false);
  async function signOut() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setFailed(false);
    try { await onLogout(); } catch { setFailed(true); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <><button className={className} type="button" disabled={busy} onClick={() => { void signOut(); }}>{common(busy ? "working" : "logout")}</button>
    {failed && <p className="field-error" role="alert">{t("logoutFailed")}</p>}</>;
}
