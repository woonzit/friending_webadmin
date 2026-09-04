"use client";

// Imported explicitly so a test can render this component (repo convention).
import React from "react";
import type { UserCastGroup } from "@/lib/userCastGroups";
import { representedLegacySegments } from "@/lib/memberAudience";

export const MEMBER_AUDIENCE_GENDERS = ["male", "female", "other"] as const;
export type MemberAudienceGender = typeof MEMBER_AUDIENCE_GENDERS[number];

export type MemberAudienceValue = {
  mode: "global" | "segments";
  genders: string[];
  groupIds: string[];
  legacySegments: string[];
};

type LocalizedOption = { key: string; labels: Record<string, string> };

export type MemberAudienceLabels = {
  legend: string;
  help: string;
  global: string;
  custom: string;
  globalHint: string;
  genders: string;
  groups: string;
  matchAny: string;
  /** Short marker on the group row: the selection is stored, not enforced. */
  groupsRecorded: string;
  /** Sentence shown whenever a group or legacy segment is selected. */
  groupsNotEnforced: string;
  required: string;
  inactive: string;
  legacy: string;
  gender: Record<MemberAudienceGender, string>;
};

function localeText(labels: Record<string, string>, locale: string): string {
  return labels[locale] || labels[locale.split("-")[0]] || labels.en || labels.hu || "";
}

function toggle(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export default function MemberAudienceSelector({
  value,
  groups,
  legacyOptions = [],
  locale,
  labels,
  disabled = false,
  onChange,
}: {
  value: MemberAudienceValue;
  groups: UserCastGroup[];
  legacyOptions?: LocalizedOption[];
  locale: string;
  labels: MemberAudienceLabels;
  disabled?: boolean;
  onChange: (next: MemberAudienceValue) => void;
}) {
  const custom = value.mode === "segments";
  const selectableGroups = groups.filter((group) => group.active || value.groupIds.includes(group.id));
  const representedSegments = representedLegacySegments(groups);
  const compatibilityOptions = legacyOptions.filter((option) => (
    !representedSegments.has(option.key) || value.legacySegments.includes(option.key)
  ));
  const invalid = custom
    && value.genders.length === 0
    && value.groupIds.length === 0
    && value.legacySegments.length === 0;
  const summary = [
    ...value.genders.map((gender) => labels.gender[gender as MemberAudienceGender] || gender),
    ...value.groupIds.map((id) => {
      const group = groups.find((item) => item.id === id);
      return group ? localeText(group.labels, locale) : id;
    }),
    ...value.legacySegments.map((key) => {
      const option = legacyOptions.find((item) => item.key === key);
      return option ? localeText(option.labels, locale) : key;
    }),
  ];

  return (
    <fieldset className={`footprints-audience member-audience-selector${invalid ? " is-invalid" : ""}`}>
      <legend>
        <span>
          <strong>{labels.legend}</strong>
          <small>{labels.help}</small>
        </span>
      </legend>
      <div className="footprints-mode" role="radiogroup" aria-label={labels.legend}>
        <button
          type="button"
          role="radio"
          aria-checked={!custom}
          className={custom ? "" : "is-active"}
          disabled={disabled}
          onClick={() => onChange({ ...value, mode: "global" })}
        >{labels.global}</button>
        <button
          type="button"
          role="radio"
          aria-checked={custom}
          className={custom ? "is-active" : ""}
          disabled={disabled}
          onClick={() => onChange({ ...value, mode: "segments" })}
        >{labels.custom}</button>
      </div>
      {custom ? (
        <>
          <p className="footprints-chip-title">{labels.genders} <span>{labels.matchAny}</span></p>
          <div className="footprints-chips">
            {MEMBER_AUDIENCE_GENDERS.map((gender) => {
              const on = value.genders.includes(gender);
              return (
                <button
                  type="button"
                  className={`footprints-chip${on ? " is-on" : ""}`}
                  aria-pressed={on}
                  disabled={disabled}
                  key={gender}
                  onClick={() => onChange({ ...value, genders: toggle(value.genders, gender) })}
                >
                  <span aria-hidden="true">{on ? "✓" : "+"}</span>
                  {labels.gender[gender]}
                </button>
              );
            })}
          </div>
          <p className="footprints-chip-title">{labels.groups} <span>{labels.groupsRecorded}</span></p>
          <div className="footprints-group-grid">
            {selectableGroups.map((group) => {
              const on = value.groupIds.includes(group.id);
              return (
                <button
                  type="button"
                  className={`footprints-group-option${on ? " is-on" : ""}${group.active ? "" : " is-inactive"}`}
                  aria-pressed={on}
                  disabled={disabled || (!group.active && !on)}
                  key={group.id}
                  onClick={() => onChange({ ...value, groupIds: toggle(value.groupIds, group.id) })}
                >
                  <span className="footprints-group-check" aria-hidden="true">{on ? "✓" : ""}</span>
                  <span><strong>{localeText(group.labels, locale)}</strong>{!group.active ? <small>{labels.inactive}</small> : null}</span>
                </button>
              );
            })}
            {compatibilityOptions.map((option) => {
              const on = value.legacySegments.includes(option.key);
              return (
                <button
                  type="button"
                  className={`footprints-group-option is-legacy${on ? " is-on" : ""}`}
                  aria-pressed={on}
                  disabled={disabled}
                  key={`legacy:${option.key}`}
                  onClick={() => onChange({ ...value, legacySegments: toggle(value.legacySegments, option.key) })}
                >
                  <span className="footprints-group-check" aria-hidden="true">{on ? "✓" : ""}</span>
                  <span><strong>{localeText(option.labels, locale)}</strong><small>{labels.legacy}</small></span>
                </button>
              );
            })}
          </div>
          <p className={`footprints-audience-summary${invalid ? " is-error" : ""}`}>
            {invalid ? labels.required : summary.join(", ")}
          </p>
          {/*
            D-096 (T-637): every member is in ONE group, so the group and
            legacy-segment axes are stored and shown but no longer narrow —
            `UserAudiencePolicy::matches()` reads the gender axis alone. The
            note therefore appears whenever a group is selected at all, not
            only when both axes are, because a group-only selection is the
            case that now silently means "everyone".
          */}
          {value.groupIds.length > 0 || value.legacySegments.length > 0 ? (
            <p className="footprints-match-logic">{labels.groupsNotEnforced}</p>
          ) : null}
        </>
      ) : <p className="footprints-audience-summary">{labels.globalHint}</p>}
    </fieldset>
  );
}
