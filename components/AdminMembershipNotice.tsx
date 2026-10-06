"use client";

import React, { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { adminMembershipRecovery, adminWriteOutcomeNotice } from "@/lib/adminClient";
import AdminLogoutButton from "@/components/AdminLogoutButton";

export function useAdminMembershipUnconfirmed() {
  return useSyncExternalStore(adminMembershipRecovery.subscribe, adminMembershipRecovery.getSnapshot, adminMembershipRecovery.getServerSnapshot);
}

export default function AdminMembershipNotice({ visible, onLogout }: { visible: boolean; onLogout?: () => Promise<void> }) {
  const t = useTranslations("adminMembership");
  if (!visible) return null;
  return (
    <section className="notice notice-error admin-membership-notice" role="status" aria-live="polite">
      <h2>{t("title")}</h2>
      <p>{t("retained")}</p>
      <p>{t("retrying")}</p>
      <button className="secondary-button" type="button" onClick={() => { void adminMembershipRecovery.retry(); }}>{t("retry")}</button>
      <AdminLogoutButton onLogout={onLogout} />
    </section>
  );
}

export function AdminWriteOutcomeNotice({ visible }: { visible: boolean }) {
  const t = useTranslations("adminWriteOutcome");
  if (!visible) return null;
  return (
    <section className="notice notice-error admin-membership-notice" role="alert">
      <h2>{t("title")}</h2>
      <p>{t("check")}</p>
      <p>{t("retained")}</p>
      <button className="secondary-button" type="button" onClick={adminWriteOutcomeNotice.dismiss}>{t("dismiss")}</button>
    </section>
  );
}

export function useAdminWriteOutcomeUnknown() {
  return useSyncExternalStore(adminWriteOutcomeNotice.subscribe, adminWriteOutcomeNotice.getSnapshot, adminWriteOutcomeNotice.getServerSnapshot);
}
