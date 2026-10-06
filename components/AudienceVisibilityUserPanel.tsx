"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { adminCall } from "@/lib/adminClient";
import AudienceVisibilityIdentityEditor, {
  type AudienceVisibilityIdentityNotice,
} from "@/components/AudienceVisibilityIdentityEditor";
import {
  AUDIENCE_VISIBILITY_IDENTITY_ACTIONS,
  audienceVisibilityAdminMe,
  audienceVisibilityConflict,
  audienceVisibilityError,
  audienceVisibilityIdentityAdminMe,
  audienceVisibilityMemberDetailResponse,
  audienceVisibilityMemberIdentityBody,
  audienceVisibilityMemberIdentityMutationResponse,
  audienceVisibilityShouldRetainMutation,
  type AudienceVisibilityIdentityDraft,
  type AudienceVisibilityMemberDetail,
} from "@/lib/audienceVisibilityAdmin";

/**
 * Refusals that mean the panel's copy of the member is no longer the state Core
 * is guarding against, so the only correct next step is an authoritative re-read
 * and a fresh operator gesture. A revision conflict that carries the canonical
 * member is adopted directly instead; this list is the rest.
 */
const RELOAD_ERRORS: ReadonlySet<string> = new Set([
  "audience-visibility-conflict",
  "audience-visibility-request-id-conflict",
  "audience-visibility-request-in-progress",
  "audience-visibility-member-unresolved",
  "audience-visibility-stored-invalid",
  "feature-retired",
]);

/**
 * Error codes this editor has real copy for; anything else reports its code.
 *
 * The two gender-detail refusals stay mapped although T-669 removes the control
 * that could provoke them: the DEPLOYED Core still validates the echoed detail,
 * and a member holding a value its catalogue later retires would otherwise get
 * a bare error code.
 */
const EDITOR_ERRORS: ReadonlySet<string> = new Set([
  "feature-retired",
  "identity-gender-invalid",
  "identity-gender-detail-invalid",
  "identity-gender-detail-mismatch",
  "profile-visibility-fixed",
  "audience-visibility-member-unresolved",
]);

function draftFrom(detail: AudienceVisibilityMemberDetail): AudienceVisibilityIdentityDraft {
  return {
    gender: detail.gender === "nonbinary" ? "" : detail.gender ?? "",
    visible_to: detail.visible_to,
    audit_reason: "",
  };
}

export default function AudienceVisibilityUserPanel({
  uid,
  onIdentitySaved,
}: {
  uid: number;
  /**
   * A successful identity write changes the derived segment and the legacy
   * gender projection the rest of this page renders, so the page re-reads.
   */
  onIdentitySaved?: () => void;
}) {
  const t = useTranslations("userDetail.audienceVisibility");
  const [state, setState] = useState<"loading" | "ready" | "error" | "hidden">("loading");
  const [detail, setDetail] = useState<AudienceVisibilityMemberDetail | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [draft, setDraft] = useState<AudienceVisibilityIdentityDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<AudienceVisibilityIdentityNotice | null>(null);
  /**
   * The command's durable identity. It is minted once per logical change and
   * REUSED while the outcome is uncertain, so a retry after a timeout is the
   * same command to Core's receipt store rather than a second admin write.
   */
  const requestRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setNotice(null);
    const meResponse = await adminCall("admin_me", {});
    const block = audienceVisibilityAdminMe(meResponse?.audience_visibility);
    // The sibling block (T-653 §2a). Absent on a Core that predates the
    // amendment, which reads as "no editor" and leaves the panel read-only.
    const identityBlock = audienceVisibilityIdentityAdminMe(meResponse?.audience_visibility_identity);
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
    setCanWrite(Boolean(
      identityBlock?.contract_ready
      && identityBlock.actions.includes(AUDIENCE_VISIBILITY_IDENTITY_ACTIONS[0]),
    ));
    setDetail(parsed);
    setDraft(draftFrom(parsed));
    setState("ready");
  }, [uid]);

  useEffect(() => { void load(); }, [load]);

  function adopt(member: AudienceVisibilityMemberDetail, message: AudienceVisibilityIdentityNotice) {
    requestRef.current = null;
    setDetail(member);
    setDraft(draftFrom(member));
    setNotice(message);
  }

  async function save() {
    if (busy || !detail || !draft) return;
    const request = requestRef.current ?? crypto.randomUUID();
    const body = audienceVisibilityMemberIdentityBody(detail, draft, request);
    if (!body) {
      setNotice({ tone: "error", text: t("editor.invalidDraft") });
      return;
    }
    requestRef.current = request;
    setBusy(true);
    setNotice(null);
    const response = await adminCall(AUDIENCE_VISIBILITY_IDENTITY_ACTIONS[0], body);
    setBusy(false);

    const result = audienceVisibilityMemberIdentityMutationResponse(response);
    if (result && result.member.uid === uid) {
      adopt(result.member, {
        tone: "success",
        text: t(result.replayed ? "editor.replayed" : "editor.saved"),
      });
      onIdentitySaved?.();
      return;
    }

    const conflict = audienceVisibilityConflict(response);
    if (conflict?.kind === "member" && conflict.member.uid === uid) {
      adopt(conflict.member, { tone: "error", text: t("editor.conflict") });
      return;
    }

    const error = audienceVisibilityError(response);
    if (error !== null && !audienceVisibilityShouldRetainMutation(error)) requestRef.current = null;
    setNotice({
      tone: "error",
      text: error && EDITOR_ERRORS.has(error)
        ? t(`editor.errors.${error}`)
        : t("editor.errorCode", { code: error ?? t("editor.unknownError") }),
    });
    if (error !== null && RELOAD_ERRORS.has(error)) void load();
  }

  if (state === "hidden") return null;
  return (
    <section className="panel audience-visibility-user-panel">
      <div className="panel-header"><div><h2>{t("title")}</h2><p>{canWrite ? t("editorCopy") : t("copy")}</p></div></div>
      <div className="panel-body">
        {state === "loading" ? <p className="page-subtitle">{t("loading")}</p> : null}
        {state === "error" ? <><div className="alert alert-error">{t("loadError")}</div><button type="button" className="button button-secondary button-small" onClick={() => void load()}>{t("retry")}</button></> : null}
        {state === "ready" && detail ? <dl className="detail-list">
          <div className="detail-row"><dt>{t("gender")}</dt><dd>{detail.gender ? t(`genders.${detail.gender}`) : t("unresolved")}</dd></div>
          <div className="detail-row"><dt>{t("visibleTo")}</dt><dd>{t(`visibleToValues.${detail.visible_to}`)}{detail.gender === "nonbinary" ? <small className="audience-visibility-fixed-note">{t("nonbinaryFixed")}</small> : null}</dd></div>
          <div className="detail-row"><dt>{t("group")}</dt><dd>{detail.group ? <><code>{detail.group.key}</code><small>{detail.group.legacy_segment}</small></> : t("groupUnresolved")}</dd></div>
          <div className="detail-row"><dt>{t("revision")}</dt><dd>{detail.revision}</dd></div>
        </dl> : null}
        {state === "ready" && detail && draft && canWrite && detail.identity ? (
          <AudienceVisibilityIdentityEditor
            member={detail}
            draft={draft}
            busy={busy}
            notice={notice}
            onChange={setDraft}
            onSubmit={() => void save()}
          />
        ) : null}
      </div>
    </section>
  );
}
