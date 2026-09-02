"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  AUDIENCE_VISIBILITY_VALUES,
  audienceVisibilityIdentityUnchanged,
  type AudienceVisibilityGender,
  type AudienceVisibilityIdentityDraft,
  type AudienceVisibilityMemberDetail,
  type AudienceVisibilityValue,
} from "@/lib/audienceVisibilityAdmin";

/**
 * The two genders D-097 #1 offers, in the owner's order (Nő / Férfi).
 *
 * `nonbinary` is deliberately absent. Core accepts it only as the value a
 * member already holds and never as a new assignment, so offering it here
 * could only produce a refusal — and a member who already holds it is shown
 * read-only by the branch below rather than being re-gendered by an editor
 * that has no third option.
 */
export const AUDIENCE_VISIBILITY_OFFERED_GENDERS = ["woman", "man"] as const;

/** "Ki láthatja az adatlapomat", in the owner's order (Nők / Férfiak / Mindenki). */
export const AUDIENCE_VISIBILITY_OFFERED_AUDIENCES = ["female", "male", "both"] as const;

export type AudienceVisibilityDetailOption = { key: string; label: string };

export type AudienceVisibilityIdentityNotice = {
  tone: "success" | "error";
  text: string;
};

function unicodeLength(value: string): number {
  return [...value].length;
}

export function audienceVisibilityAuditReasonValid(value: string): boolean {
  const length = unicodeLength(value.trim());
  return value === value.trim() && length >= 1 && length <= 300;
}

/**
 * The member-identity editor of the users detail page (T-653).
 *
 * Presentational on purpose: the panel around it owns the authoritative read,
 * the durable request identity and the Core round trip, so this file can be
 * rendered by a test exactly as an operator sees it.
 */
export default function AudienceVisibilityIdentityEditor({
  member,
  detailOptions,
  draft,
  busy,
  notice,
  onChange,
  onSubmit,
}: {
  member: AudienceVisibilityMemberDetail;
  detailOptions: readonly AudienceVisibilityDetailOption[];
  draft: AudienceVisibilityIdentityDraft;
  busy: boolean;
  notice: AudienceVisibilityIdentityNotice | null;
  onChange: (draft: AudienceVisibilityIdentityDraft) => void;
  onSubmit: () => void;
}) {
  const t = useTranslations("userDetail.audienceVisibility");
  const common = useTranslations("common");

  if (member.gender === "nonbinary") {
    // The offered set is two genders and a nonbinary member's audience is fixed
    // to everyone, so every control this editor has would either re-gender them
    // or be refused. The values stay visible; the note says why they are not
    // editable here.
    return (
      <div className="system-option-notice field-full" role="note">
        <strong>{t("editor.nonbinaryTitle")}</strong>
        <span>{t("editor.nonbinaryCopy")}</span>
      </div>
    );
  }

  const reasonValid = audienceVisibilityAuditReasonValid(draft.audit_reason);
  const blocked = busy
    || draft.gender === ""
    || !reasonValid
    || audienceVisibilityIdentityUnchanged(member, draft);

  function setGender(value: string) {
    const gender = (AUDIENCE_VISIBILITY_OFFERED_GENDERS as readonly string[]).includes(value)
      ? value as AudienceVisibilityGender
      : "";
    // A detail belongs to exactly one gender, so a stored `trans_woman` cannot
    // survive a change to `man` — Core would answer
    // `identity-gender-detail-mismatch`. Clearing it here keeps the refusal off
    // the wire and shows the operator what will be written.
    const keep = detailOptions.some((option) => option.key === draft.gender_detail)
      && gender === draft.gender;
    onChange({ ...draft, gender, gender_detail: keep ? draft.gender_detail : "" });
  }

  function setVisibleTo(value: string) {
    const visibleTo = (AUDIENCE_VISIBILITY_VALUES as readonly string[]).includes(value)
      ? value as AudienceVisibilityValue
      : draft.visible_to;
    onChange({ ...draft, visible_to: visibleTo });
  }

  return (
    <div className="form-grid audience-visibility-identity-editor">
      <label className="field">
        <span>{t("editor.gender")}</span>
        <select
          value={draft.gender}
          disabled={busy}
          onChange={(event) => setGender(event.target.value)}
        >
          {member.gender === null || draft.gender === ""
            ? <option value="">{t("editor.genderSelect")}</option>
            : null}
          {AUDIENCE_VISIBILITY_OFFERED_GENDERS.map((gender) => (
            <option value={gender} key={gender}>{t(`genders.${gender}`)}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t("editor.genderDetail")}</span>
        <select
          value={draft.gender_detail}
          disabled={busy || draft.gender === "" || detailOptions.length === 0}
          onChange={(event) => onChange({ ...draft, gender_detail: event.target.value })}
        >
          <option value="">{t("editor.genderDetailNone")}</option>
          {detailOptions.map((option) => (
            <option value={option.key} key={option.key}>{option.label}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t("editor.visibleTo")}</span>
        <select
          value={draft.visible_to}
          disabled={busy}
          onChange={(event) => setVisibleTo(event.target.value)}
        >
          {AUDIENCE_VISIBILITY_OFFERED_AUDIENCES.map((value) => (
            <option value={value} key={value}>{t(`visibleToValues.${value}`)}</option>
          ))}
        </select>
      </label>
      <label className="field field-full">
        <span>{t("editor.auditReason")}</span>
        <textarea
          rows={2}
          maxLength={600}
          value={draft.audit_reason}
          disabled={busy}
          onChange={(event) => onChange({ ...draft, audit_reason: event.target.value })}
        />
        <small className={draft.audit_reason && !reasonValid ? "field-error" : "field-hint"}>
          {t("editor.auditHint", { count: unicodeLength(draft.audit_reason) })}
        </small>
      </label>
      <p className="page-subtitle field-full">
        {t("editor.disclosure", {
          state: member.identity?.show_gender_detail ? common("yes") : common("no"),
          revision: member.identity?.identity_revision ?? 0,
        })}
      </p>
      {notice ? (
        <div className={`alert alert-${notice.tone === "success" ? "success" : "error"} field-full`} role="status">
          {notice.text}
        </div>
      ) : null}
      <div className="field-full editor-actions">
        <button className="button button-primary" type="button" disabled={blocked} onClick={onSubmit}>
          {busy ? common("saving") : t("editor.save")}
        </button>
      </div>
    </div>
  );
}
