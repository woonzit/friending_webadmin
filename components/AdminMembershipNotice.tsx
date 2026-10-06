"use client";

import React, { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { adminMembershipRecovery } from "@/lib/adminClient";

export function useAdminMembershipUnconfirmed() {
  return useSyncExternalStore(adminMembershipRecovery.subscribe, adminMembershipRecovery.getSnapshot, adminMembershipRecovery.getServerSnapshot);
}

export default function AdminMembershipNotice({ visible }: { visible: boolean }) {
  const t = useTranslations("adminMembership");
  if (!visible) return null;
  return (
    <section className="notice notice-error admin-membership-notice" role="status" aria-live="polite">
      <h2>{t("title")}</h2>
      <p>{t("retained")}</p>
      <p>{t("retrying")}</p>
      <button className="secondary-button" type="button" onClick={() => { void adminMembershipRecovery.retry(); }}>{t("retry")}</button>
    </section>
  );
}
