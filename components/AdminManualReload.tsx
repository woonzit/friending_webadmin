"use client";
import React, { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { adminMembershipRecovery } from "@/lib/adminClient";

/** Manual fallback even when an unregistered legacy loader stopped mid-load. */
export default function AdminManualReload() {
  const t = useTranslations("adminMembership"), [confirm, setConfirm] = useState(false);
  const epoch = useSyncExternalStore(adminMembershipRecovery.subscribe, adminMembershipRecovery.getRecoveryEpoch, adminMembershipRecovery.getServerRecoveryEpoch);
  if (epoch === 0) return null;
  return <section className="admin-manual-reload">
    <button type="button" className="text-button" onClick={() => setConfirm(true)}>{t("reload")}</button>
    {confirm && <div className="notice notice-error" role="alertdialog" aria-label={t("reload")}>
      <p>{t("reloadWarning")}</p>
      <button type="button" className="secondary-button" onClick={() => setConfirm(false)}>{t("keepPage")}</button>
      <button type="button" className="secondary-button" onClick={() => window.location.reload()}>{t("reloadConfirm")}</button>
    </div>}
  </section>;
}
