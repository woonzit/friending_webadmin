"use client";
import React, { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import { chooseResearchNavigation, getResearchNavigationNotice, subscribeResearchNavigation, type ResearchNavigationNotice } from "@/lib/datesResearchNavigation";

export function ResearchNavigationNoticeView({ notice, choose }: { notice: ResearchNavigationNotice | null; choose: (leave: boolean) => void }) {
  const t = useTranslations("datesAdmin.research"), common = useTranslations("common");
  if (!notice) return null;
  return notice.kind === "confirm" ? <ConfirmDialog title={t("navigation.title")} copy={notice.message} confirmLabel={t("navigation.leave")}
    onCancel={() => choose(false)} onConfirm={() => choose(true)} />
    : <aside className="alert alert-warning" role="status"><p>{notice.message}</p><button type="button" className="button button-secondary" onClick={() => choose(false)}>{common("close")}</button></aside>;
}
export default function DatesResearchNavigationNotice() {
  const notice = useSyncExternalStore(subscribeResearchNavigation, getResearchNavigationNotice, () => null);
  return <ResearchNavigationNoticeView notice={notice} choose={chooseResearchNavigation} />;
}
