"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { adminCall } from "@/lib/adminClient";
import {
  audienceVisibilityAdminMe,
  audienceVisibilityMemberDetailResponse,
  type AudienceVisibilityMemberDetail,
} from "@/lib/audienceVisibilityAdmin";

export default function AudienceVisibilityUserPanel({ uid }: { uid: number }) {
  const t = useTranslations("userDetail.audienceVisibility");
  const [state, setState] = useState<"loading" | "ready" | "error" | "hidden">("loading");
  const [detail, setDetail] = useState<AudienceVisibilityMemberDetail | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    const meResponse = await adminCall("admin_me", {});
    const block = audienceVisibilityAdminMe(meResponse?.audience_visibility);
    if (!block?.contract_ready || !block.actions.includes("audience_visibility_member_detail")) {
      setState(block ? "hidden" : "error");
      return;
    }
    const response = await adminCall("audience_visibility_member_detail", { contract_version: 1, uid });
    const parsed = audienceVisibilityMemberDetailResponse(response);
    if (!parsed || parsed.uid !== uid) {
      setState("error");
      return;
    }
    setDetail(parsed);
    setState("ready");
  }, [uid]);

  useEffect(() => { void load(); }, [load]);

  if (state === "hidden") return null;
  return (
    <section className="panel audience-visibility-user-panel">
      <div className="panel-header"><div><h2>{t("title")}</h2><p>{t("copy")}</p></div></div>
      <div className="panel-body">
        {state === "loading" ? <p className="page-subtitle">{t("loading")}</p> : null}
        {state === "error" ? <><div className="alert alert-error">{t("loadError")}</div><button type="button" className="button button-secondary button-small" onClick={() => void load()}>{t("retry")}</button></> : null}
        {state === "ready" && detail ? <dl className="detail-list">
          <div className="detail-row"><dt>{t("gender")}</dt><dd>{detail.gender ? t(`genders.${detail.gender}`) : t("unresolved")}</dd></div>
          <div className="detail-row"><dt>{t("visibleTo")}</dt><dd>{t(`visibleToValues.${detail.visible_to}`)}{detail.gender === "nonbinary" ? <small className="audience-visibility-fixed-note">{t("nonbinaryFixed")}</small> : null}</dd></div>
          <div className="detail-row"><dt>{t("group")}</dt><dd>{detail.group ? <><code>{detail.group.key}</code><small>{detail.group.legacy_segment}</small></> : t("groupUnresolved")}</dd></div>
          <div className="detail-row"><dt>{t("revision")}</dt><dd>{detail.revision}</dd></div>
        </dl> : null}
      </div>
    </section>
  );
}
