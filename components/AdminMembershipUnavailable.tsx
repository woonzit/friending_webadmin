"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import AdminMembershipNotice from "@/components/AdminMembershipNotice";
import { adminMembershipRecovery } from "@/lib/adminClient";

/** Only rendered instead of an unconfirmed server page, never around an editor. */
export default function AdminMembershipUnavailable({ checkId }: { checkId: string }) {
  const router = useRouter(), common = useTranslations("common");
  useEffect(() => {
    // A fresh neutral server result can follow a positive recovery probe. Its
    // opaque render id restarts recovery even when Next reuses this component.
    // This id is presentation-only; it never identifies or authorizes an actor.
    adminMembershipRecovery.markUnconfirmed();
    let refreshed = false;
    return adminMembershipRecovery.subscribe(() => {
      if (!adminMembershipRecovery.getSnapshot() && !refreshed) { refreshed = true; router.refresh(); }
    });
  }, [checkId, router]);
  return (
    <section className="content" data-membership="unconfirmed">
      <p className="eyebrow">Friending · {common("adminBadge")}</p>
      <AdminMembershipNotice visible />
    </section>
  );
}
