"use client";

import React, { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { adminCall } from "@/lib/adminClient";
import {
  userProfileFields,
  type IdentityOptionGroup,
  type ProfileField,
  type UserProfileFields,
} from "@/lib/profileFields";

function localized(labels: Record<string, string>, locale: string): string {
  return labels[locale] || labels[locale.split("-")[0]] || labels.en || labels.hu || "";
}

function answerState(data: UserProfileFields): Record<string, string[]> {
  return Object.fromEntries(
    data.fields
      .filter((field) => field.eligible !== false)
      .map((field) => [field.key, field.values ?? []]),
  );
}

/**
 * `save_user_profile_fields` is a whole-document replacement: Core keeps exactly
 * the answers this payload carries and deletes every other answer the member
 * had. The editor renders only active fields, so building the payload from the
 * rendered set alone silently destroys a member's answers to a field an
 * administrator archived. Those values are loaded but never shown, so they are
 * echoed back untouched.
 *
 * Answers to fields the member is no longer eligible for are deliberately not
 * echoed back — Core prunes those by design when the derived segment changes.
 */
export function profileAnswersPayload(
  fields: ProfileField[],
  answers: Record<string, string[]>,
): Record<string, string[]> {
  const payload: Record<string, string[]> = {};
  for (const field of fields) {
    if (field.eligible === false) continue;
    const values = answers[field.key] ?? field.values ?? [];
    if (field.active || values.length > 0) payload[field.key] = values;
  }
  return payload;
}

export default function UserProfileDataEditor({
  uid,
  data,
  identityGroups,
  onChange,
}: {
  uid: number;
  data: UserProfileFields;
  identityGroups: IdentityOptionGroup[];
  onChange: (data: UserProfileFields) => void;
}) {
  const t = useTranslations("userProfileEditor");
  const common = useTranslations("common");
  const locale = useLocale();
  const [answers, setAnswers] = useState<Record<string, string[]>>(() => answerState(data));
  const [heightCm, setHeightCm] = useState<number | null>(data.height?.value ?? null);
  const [fieldBusy, setFieldBusy] = useState(false);
  const [fieldNotice, setFieldNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    setAnswers(answerState(data));
    setHeightCm(data.height?.value ?? null);
  }, [data]);

  const groups = useMemo(
    () => Object.fromEntries(identityGroups.map((group) => [group.key, group])),
    [identityGroups],
  );
  const fieldsByKey = useMemo(
    () => new Map(data.fields.map((field) => [field.key, field])),
    [data.fields],
  );
  const assignedFieldKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const section of data.sections) {
      for (const item of section.items) {
        if (item.kind === "field") keys.add(item.key);
      }
    }
    return keys;
  }, [data.sections]);
  const unassignedFields = data.fields.filter(
    (field) => field.active && !assignedFieldKeys.has(field.key),
  );
  const eligibleFields = data.fields.filter((field) => field.active && field.eligible !== false);
  const fieldViolations = eligibleFields.filter((field) => {
    const count = (answers[field.key] ?? []).length;
    return count < field.selection.min_selected || count > field.selection.max_selected;
  }).map((field) => field.key);

  /**
   * Read-only label for a stored identity value. It looks through the WHOLE
   * option list rather than the audience-filtered, active-only lists the
   * editable selects use: a value already on the member must stay readable
   * even when the catalogue row was archived, or when the option's declared
   * audiences no longer include the member's canonical gender. An unknown key
   * falls back to itself rather than rendering as blank.
   */
  function identityLabel(value: string): string {
    if (!value) return "";
    const option = (groups.gender?.options ?? []).find((row) => row.key === value);
    return option ? localized(option.labels, locale) || value : value;
  }

  function toggle(field: ProfileField, optionKey: string, checked: boolean) {
    const current = answers[field.key] ?? [];
    if (field.selection.mode === "single") {
      setAnswers({ ...answers, [field.key]: checked ? [optionKey] : [] });
      return;
    }
    const next = checked
      ? [...new Set([...current, optionKey])]
      : current.filter((key) => key !== optionKey);
    if (next.length <= field.selection.max_selected) {
      setAnswers({ ...answers, [field.key]: next });
    }
  }

  async function saveFields() {
    if (fieldViolations.length > 0) {
      setFieldNotice({ kind: "error", text: t("selectionError") });
      return;
    }
    setFieldBusy(true);
    setFieldNotice(null);
    const payload = profileAnswersPayload(data.fields, answers);
    const response = await adminCall("save_user_profile_fields", {
      uid,
      schema_version: data.schema_version,
      expected_revision: data.revision,
      answers_json: JSON.stringify(payload),
      // Only an editable height builtin has a value to post; once Core stops
      // serving it (T-632) the body is `{}`, which Core accepts as "no builtin
      // change" (T-634 refuses a stray `height_cm` key).
      builtin_values_json: JSON.stringify(data.height ? { height_cm: heightCm } : {}),
      lang: locale,
    });
    setFieldBusy(false);
    const parsed = userProfileFields(response?.data);
    if (!response?.success || !parsed) {
      setFieldNotice({
        kind: "error",
        text: response?.error === "profile-attributes-conflict" ? t("conflict") : t("saveError"),
      });
      return;
    }
    onChange(parsed);
    setFieldNotice({ kind: "success", text: t("saved") });
  }

  function renderHeightEditor(height: NonNullable<UserProfileFields["height"]>) {
    return (
      <fieldset className="user-attribute-field user-admin-height" key="builtin-height_cm">
        <legend><span className="user-attribute-icon"><b>↕</b></span><span><strong>{t("height")}</strong><small>{heightCm === null ? t("notProvided") : t("heightValue", { value: heightCm, unit: height.unit })}</small><code>height_cm</code></span></legend>
        {heightCm === null ? (
          <button className="button button-secondary button-small" type="button" disabled={fieldBusy} onClick={() => setHeightCm(Math.max(height.minimum, Math.min(height.maximum, 175)))}>{t("heightAdd")}</button>
        ) : (
          <div className="user-admin-height-control">
            <input type="range" min={height.minimum} max={height.maximum} step={height.step} value={heightCm} disabled={fieldBusy} aria-label={t("height")} onChange={(event) => setHeightCm(Number(event.target.value))} />
            <output>{heightCm} {height.unit}</output>
            <button className="text-button" type="button" disabled={fieldBusy} onClick={() => setHeightCm(null)}>{t("heightClear")}</button>
          </div>
        )}
      </fieldset>
    );
  }

  function renderFieldEditor(field: ProfileField) {
    const ineligible = field.eligible === false;
    const values = ineligible ? field.values ?? [] : answers[field.key] ?? [];
    return (
      <fieldset
        className={`user-attribute-field${fieldViolations.includes(field.key) ? " is-invalid" : ""}${ineligible ? " is-ineligible" : ""}`}
        key={field.key}
        aria-invalid={fieldViolations.includes(field.key)}
      >
        <legend>
          <span className="user-attribute-icon">{/* eslint-disable-next-line @next/next/no-img-element */}{field.icon.url ? <img src={field.icon.url} alt="" /> : <b>{field.label?.slice(0, 1) || "•"}</b>}</span>
          <span><strong>{field.label || field.key}</strong>{field.description ? <small>{field.description}</small> : null}<code>{field.key}</code></span>
        </legend>
        <div className="user-attribute-options">
          {field.options.filter((option) => option.active || values.includes(option.key)).map((option) => {
            const checked = values.includes(option.key);
            return <label className={checked ? "is-selected" : ""} key={option.key}><input type={field.selection.mode === "single" ? "radio" : "checkbox"} name={`profile-field-${field.key}`} checked={checked} disabled={fieldBusy || ineligible || (!checked && field.selection.mode === "multi" && values.length >= field.selection.max_selected)} onChange={(event) => toggle(field, option.key, event.target.checked)} /><span>{option.label || localized(option.labels, locale)}</span></label>;
          })}
          {!ineligible && values.length > 0 && field.selection.min_selected === 0 ? <button type="button" className="text-button" disabled={fieldBusy} onClick={() => setAnswers({ ...answers, [field.key]: [] })}>{t("clear")}</button> : null}
        </div>
        <small className="user-attribute-limit">{ineligible ? t("ineligibleField") : field.selection.mode === "single" ? (field.selection.min_selected > 0 ? t("singleRequiredHint") : t("singleHint")) : t("multiHint", { min: field.selection.min_selected, max: field.selection.max_selected })}</small>
      </fieldset>
    );
  }

  function renderBuiltinFact(item: { key: string; label: string; display_value: string }) {
    // Read-only facts render as one slim row instead of an empty editor box:
    // label + value + a lock marker, the wire key demoted to a hover title.
    return (
      <div className="user-builtin-row" key={`builtin-${item.key}`} title={item.key}>
        <span className="user-attribute-icon is-small"><b>{(item.label || item.key).slice(0, 1)}</b></span>
        <span className="user-builtin-label">{item.label || item.key}</span>
        <span className={`user-builtin-value${item.display_value ? "" : " is-empty"}`}>
          {item.display_value || t("notProvided")}
        </span>
        <span className="user-builtin-lock" aria-label={t("builtinReadOnly")} title={t("builtinReadOnly")}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
            <rect x="3.5" y="7" width="9" height="6" rx="1.6" />
            <path d="M5.5 7V5.4a2.5 2.5 0 0 1 5 0V7" />
          </svg>
        </span>
      </div>
    );
  }

  const sectionBlocks = data.sections.map((section) => {
    const rows: ReactNode[] = [];
    for (const item of section.items) {
      if (item.kind === "builtin") {
        // The height editor exists only while Core serves the editable height
        // builtin with its constraints; any other builtin is a read-only fact.
        rows.push(item.key === "height_cm" && data.height ? renderHeightEditor(data.height) : renderBuiltinFact(item));
        continue;
      }
      const field = fieldsByKey.get(item.key);
      if (!field || !field.active) continue;
      rows.push(renderFieldEditor(field));
    }
    const visibility = section.visibility;
    return (
      <div className="user-profile-section" key={section.key}>
        <div className="user-profile-section-header">
          <h3>{section.title}</h3>
          {section.subtitle ? <p>{section.subtitle}</p> : null}
          {visibility?.hidden ? <span className="badge badge-warning">{t("sectionHidden")}</span> : null}
          {visibility && !visibility.share_enabled ? <span className="badge badge-warning">{t("sectionShareOff")}</span> : null}
          <code>{section.key}</code>
        </div>
        {visibility?.audience_note ? (
          <p className="page-subtitle">{t("sectionAudience", { audience: visibility.audience_note })}</p>
        ) : null}
        {rows.length > 0 ? rows : <p className="page-subtitle">{t("sectionEmpty")}</p>}
      </div>
    );
  });

  return (
    <div className="user-profile-editor-grid">
      <section className="panel user-identity-editor">
        <div className="panel-header">
          <div><h2>{t("identityTitle")}</h2><p>{t("identityCopy")}</p></div>
          <span className="badge badge-warning">{data.segment.label}</span>
        </div>
        <div className="panel-body form-grid">
          {/*
            T-669 (D-103 §6.4): `save_user_profile_identity` answers 410
            `feature-retired` unconditionally, so this panel has no write left
            and the identity block is a read-only fact. Canonical gender is
            edited in the T-653 audience-visibility panel above, which carries
            the two revisions Core guards. The detailed gender is retired
            outright and is not shown at all.
          */}
          <div className="system-option-notice field-full" role="note">
            <strong>{t("identityReadOnlyTitle")}</strong>
            <span>{t("identityReadOnlyCopy")}</span>
          </div>
          {renderBuiltinFact({ key: "gender", label: t("gender"), display_value: identityLabel(data.identity.gender) })}
          <div className="field-full user-cast-summary">
            <span><b>{t("derivedGroup")}</b>{data.segment.label}<code>{data.segment.key}</code></span>
            {data.identity_editable ? (
              <>
                <span><b>{t("channels")}</b>{data.identity.channels.join(", ") || "—"}</span>
                <span><b>{t("questionPacks")}</b>{data.identity.question_packs.join(", ") || "—"}</span>
              </>
            ) : null}
          </div>
        </div>
      </section>

      <section className="panel user-attributes-editor">
        <div className="panel-header"><div><h2>{t("fieldsTitle")}</h2><p>{t("fieldsCopy", { count: eligibleFields.length })}</p></div><span className="badge">v{data.schema_version}</span></div>
        <div className="panel-body user-attribute-list">
          {sectionBlocks}
          {unassignedFields.length > 0 ? (
            <div className="user-profile-section user-profile-section-unassigned">
              <div className="user-profile-section-header">
                <h3>{t("unassignedTitle")}</h3>
                <p>{t("unassignedCopy")}</p>
              </div>
              {unassignedFields.map((field) => renderFieldEditor(field))}
            </div>
          ) : null}
          {data.sections.length === 0 && unassignedFields.length === 0 ? <p className="page-subtitle">{t("noFields")}</p> : null}
          {fieldNotice ? <div className={`alert alert-${fieldNotice.kind}`} role="status">{fieldNotice.text}</div> : null}
          <div className="editor-actions"><button className="button button-primary" type="button" disabled={fieldBusy || fieldViolations.length > 0} onClick={() => void saveFields()}>{fieldBusy ? common("saving") : t("saveFields")}</button></div>
        </div>
      </section>
    </div>
  );
}
