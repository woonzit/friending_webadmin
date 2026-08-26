"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import {
  containsDisclosureOnlyOrientation,
  isDisclosureOnlyOrientation,
} from "@/lib/orientationIntegrity";
import {
  CAST_GROUP_GENDERS,
  userCastGroupsPayload,
  type CastGroupRule,
  type CastGroupSegment,
  type UserCastGroup,
} from "@/lib/userCastGroups";

type OrientationChoice = { key: string; label: string };

type Draft = {
  id: string;
  key: string;
  labelEn: string;
  labelHu: string;
  labels: Record<string, string>;
  rules: CastGroupRule[];
  legacySegment: string;
  sortOrder: number;
  active: boolean;
  system: boolean;
  revision: number;
  isNew: boolean;
};

function draftFrom(group?: UserCastGroup, nextOrder = 1000): Draft {
  return {
    id: group?.id ?? "",
    key: group?.key ?? "",
    labelEn: group?.labels.en ?? "",
    labelHu: group?.labels.hu ?? "",
    labels: group?.labels ?? {},
    rules: group ? group.rules.map((rule) => ({
      genders: [...rule.genders],
      orientations: [...rule.orientations],
    })) : [{ genders: [], orientations: [] }],
    legacySegment: group?.legacy_segment ?? "",
    sortOrder: group?.sort_order ?? nextOrder,
    active: group?.active ?? true,
    system: group?.system ?? false,
    revision: group?.revision ?? 0,
    isNew: !group,
  };
}

function localeText(labels: Record<string, string>, locale: string): string {
  return labels[locale] || labels[locale.split("-")[0]] || labels.en || labels.hu || "";
}

/** Orientation vocabulary out of the signup-options catalog, fail-closed to []. */
function orientationChoices(raw: unknown, locale: string): OrientationChoice[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const groups = (raw as Record<string, unknown>).groups;
  if (!Array.isArray(groups)) return [];
  for (const value of groups) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const group = value as Record<string, unknown>;
    if (group.key !== "orientation" || !Array.isArray(group.options)) continue;
    const choices: OrientationChoice[] = [];
    for (const optionValue of group.options) {
      if (!optionValue || typeof optionValue !== "object" || Array.isArray(optionValue)) continue;
      const option = optionValue as Record<string, unknown>;
      if (
        typeof option.key !== "string"
        || option.active === false
        || isDisclosureOnlyOrientation(option.key)
      ) continue;
      const label = locale === "hu"
        ? String(option.name_hu ?? option.key)
        : String(option.name_en ?? option.key);
      choices.push({ key: option.key, label });
    }
    return choices;
  }
  return [];
}

function GroupDialog({
  draft,
  segments,
  orientations,
  busy,
  error,
  onChange,
  onClose,
  onSave,
}: {
  draft: Draft;
  segments: CastGroupSegment[];
  orientations: OrientationChoice[];
  busy: boolean;
  error: string;
  onChange: (next: Draft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const t = useTranslations("userGroups");
  const common = useTranslations("common");
  const locale = useLocale();
  const genderLabels: Record<string, string> = {
    male: t("genderMale"),
    female: t("genderFemale"),
    other: t("genderOther"),
  };

  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", keyDown);
    return () => document.removeEventListener("keydown", keyDown);
  }, [busy, onClose]);

  function updateRule(index: number, next: CastGroupRule) {
    onChange({ ...draft, rules: draft.rules.map((rule, at) => (at === index ? next : rule)) });
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="user-group-dialog-title">
        <div className="dialog-header">
          <div>
            <h2 id="user-group-dialog-title">{draft.isNew ? t("addTitle") : t("editTitle")}</h2>
            {draft.id ? <p><code>{draft.id}</code></p> : <p>{t("newGroupHint")}</p>}
          </div>
          <button className="dialog-close" onClick={onClose} disabled={busy} aria-label={common("close")}>×</button>
        </div>
        <div className="dialog-body form-grid">
          {draft.system && (
            <div className="system-option-notice field-full" role="note">
              <strong>{t("systemGroup")}</strong>
              <span>{t("systemGroupCopy")}</span>
            </div>
          )}
          <label className="field">
            <span>{t("key")}</span>
            <input
              value={draft.key}
              autoFocus={draft.isNew}
              disabled={draft.system || busy}
              maxLength={64}
              spellCheck={false}
              onChange={(event) => onChange({ ...draft, key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
            />
            <small className="field-hint">{t("keyHint")}</small>
          </label>
          <label className="field">
            <span>{t("order")}</span>
            <input
              type="number"
              min="0"
              max="100000"
              value={draft.sortOrder}
              disabled={busy}
              onChange={(event) => onChange({ ...draft, sortOrder: Math.max(0, Math.min(100000, Number(event.target.value) || 0)) })}
            />
          </label>
          <label className="field">
            <span>{t("nameEn")}</span>
            <input value={draft.labelEn} maxLength={80} disabled={busy} autoFocus={!draft.isNew} onChange={(event) => onChange({ ...draft, labelEn: event.target.value })} />
          </label>
          <label className="field">
            <span>{t("nameHu")}</span>
            <input value={draft.labelHu} maxLength={80} disabled={busy} onChange={(event) => onChange({ ...draft, labelHu: event.target.value })} />
          </label>
          <fieldset className="field field-full profile-audience-fieldset">
            <legend>{t("rules")}</legend>
            <p className="field-hint">{t("rulesHint")}</p>
            {draft.rules.map((rule, index) => (
              <div className="user-group-rule" key={index}>
                <div className="user-group-rule-head">
                  <strong>{t("ruleTitle", { number: index + 1 })}</strong>
                  {draft.rules.length > 1 && (
                    <button
                      type="button"
                      className="button button-danger button-small"
                      disabled={busy}
                      onClick={() => onChange({ ...draft, rules: draft.rules.filter((_, at) => at !== index) })}
                    >{t("removeRule")}</button>
                  )}
                </div>
                <div className="user-group-rule-axis">
                  <span>{t("genders")}</span>
                  <div className="profile-field-radio-row">
                    {CAST_GROUP_GENDERS.map((gender) => (
                      <label key={gender}>
                        <input
                          type="checkbox"
                          checked={rule.genders.includes(gender)}
                          disabled={busy}
                          onChange={(event) => updateRule(index, {
                            ...rule,
                            genders: event.target.checked
                              ? [...rule.genders, gender]
                              : rule.genders.filter((value) => value !== gender),
                          })}
                        />
                        <span>{genderLabels[gender]}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="user-group-rule-axis">
                  <span>{t("orientations")}</span>
                  <div className="profile-segment-grid">
                    {orientations.map((choice) => (
                      <label key={choice.key}>
                        <input
                          type="checkbox"
                          checked={rule.orientations.includes(choice.key)}
                          disabled={busy}
                          onChange={(event) => updateRule(index, {
                            ...rule,
                            orientations: event.target.checked
                              ? [...rule.orientations, choice.key]
                              : rule.orientations.filter((value) => value !== choice.key),
                          })}
                        />
                        <span>{choice.label}</span>
                        <code>{choice.key}</code>
                      </label>
                    ))}
                    {rule.orientations.filter((key) => !orientations.some((choice) => choice.key === key)).map((key) => (
                      <label key={key}>
                        <input
                          type="checkbox"
                          checked
                          disabled={busy}
                          onChange={() => updateRule(index, {
                            ...rule,
                            orientations: rule.orientations.filter((value) => value !== key),
                          })}
                        />
                        <span>{t("retiredOrientation")}</span>
                        <code>{key}</code>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="button button-secondary button-small"
              disabled={busy || draft.rules.length >= 20}
              onClick={() => onChange({ ...draft, rules: [...draft.rules, { genders: [], orientations: [] }] })}
            >{t("addRule")}</button>
          </fieldset>
          <label className="field">
            <span>{t("legacySegment")}</span>
            <select
              value={draft.legacySegment}
              disabled={draft.system || busy}
              onChange={(event) => onChange({ ...draft, legacySegment: event.target.value })}
            >
              <option value="">{t("legacySegmentNone")}</option>
              {segments.map((segment) => (
                <option key={segment.key} value={segment.key}>{localeText(segment.labels, locale)} ({segment.key})</option>
              ))}
            </select>
            <small className="field-hint">{t("legacySegmentHint")}</small>
          </label>
          <label className="checkbox-field user-group-active-field">
            <input
              type="checkbox"
              checked={draft.active}
              disabled={busy}
              onChange={(event) => onChange({ ...draft, active: event.target.checked })}
            />
            <span>{t("active")}</span>
          </label>
          {error && <div className="alert alert-error field-full" role="alert">{error}</div>}
        </div>
        <div className="dialog-actions">
          <button className="button button-secondary" onClick={onClose} disabled={busy}>{common("cancel")}</button>
          <button className="button button-primary" onClick={onSave} disabled={busy}>
            {busy ? common("saving") : common("save")}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function UserGroupsPage() {
  const t = useTranslations("userGroups");
  const common = useTranslations("common");
  const locale = useLocale();
  const [groups, setGroups] = useState<UserCastGroup[] | null>(null);
  const [segments, setSegments] = useState<CastGroupSegment[]>([]);
  const [orientations, setOrientations] = useState<OrientationChoice[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [archiving, setArchiving] = useState<UserCastGroup | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    if (!groups) setState("loading");
    const [groupsResponse, optionsResponse] = await Promise.all([
      adminCall("user_cast_groups"),
      adminCall("list_signup_options"),
    ]);
    const parsed = groupsResponse?.success ? userCastGroupsPayload(groupsResponse) : null;
    if (!parsed) {
      setState("error");
      return;
    }
    setGroups(parsed.groups);
    setSegments(parsed.segments);
    // The orientation vocabulary drives the rule editor; a failed catalog read
    // degrades the checkboxes but must not block the group list.
    setOrientations(optionsResponse?.success
      ? orientationChoices(optionsResponse.catalog, locale)
      : []);
    setState("ready");
  }, [groups, locale]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const sorted = useMemo(() => (groups ? [...groups].sort((left, right) => (
    left.sort_order - right.sort_order || left.key.localeCompare(right.key)
  )) : []), [groups]);

  function applyPayload(raw: unknown): boolean {
    const parsed = userCastGroupsPayload(raw);
    if (!parsed) return false;
    setGroups(parsed.groups);
    setSegments(parsed.segments);
    return true;
  }

  function saveFailureMessage(error: unknown): string {
    switch (String(error ?? "")) {
      case "cast-group-conflict": return t("conflict");
      case "cast-group-key-taken": return t("keyTaken");
      case "cast-group-system-protected": return t("systemProtected");
      case "cast-group-key-invalid": return t("keyInvalid");
      case "cast-group-labels-invalid": return t("namesRequired");
      case "cast-group-rules-invalid":
      case "cast-group-genders-invalid":
      case "cast-group-orientations-invalid": return t("rulesInvalid");
      case "cast-group-orientation-unknown": return t("orientationUnknown");
      case "cast-group-orientation-disclosure-forbidden": return t("orientationDisclosureForbidden");
      default: return t("saveError");
    }
  }

  async function save() {
    if (!draft) return;
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(draft.key)) {
      setFormError(t("keyInvalid"));
      return;
    }
    if (!draft.labelEn.trim() || !draft.labelHu.trim()) {
      setFormError(t("namesRequired"));
      return;
    }
    if (
      draft.rules.length === 0
      || draft.rules.some((rule) => rule.genders.length === 0 || rule.orientations.length === 0)
    ) {
      setFormError(t("rulesInvalid"));
      return;
    }
    if (draft.rules.some((rule) => containsDisclosureOnlyOrientation(rule.orientations))) {
      setFormError(t("orientationDisclosureForbidden"));
      return;
    }
    setBusy(true);
    setFormError("");
    const response = await adminCall("save_user_cast_group", {
      id: draft.id,
      group_key: draft.key,
      labels_json: JSON.stringify({ ...draft.labels, en: draft.labelEn.trim(), hu: draft.labelHu.trim() }),
      rules_json: JSON.stringify(draft.rules),
      legacy_segment: draft.legacySegment,
      sort_order: draft.sortOrder,
      active: draft.active,
      ...(draft.isNew ? {} : { expected_revision: draft.revision }),
    });
    setBusy(false);
    if (!response?.success || !applyPayload(response)) {
      // A 409 adopts the server copy and closes the editor: keeping the
      // dialog open would retry with the stale revision forever.
      if (response?.error === "cast-group-conflict") {
        setDraft(null);
        setToast(t("conflict"));
        void load();
        return;
      }
      setFormError(saveFailureMessage(response?.error));
      return;
    }
    setDraft(null);
    setToast(t("saved"));
  }

  async function archive() {
    if (!archiving) return;
    setBusy(true);
    const response = await adminCall("archive_user_cast_group", {
      id: archiving.id,
      expected_revision: archiving.revision,
    });
    setBusy(false);
    setArchiving(null);
    if (!response?.success || !applyPayload(response)) {
      setToast(response?.error === "cast-group-system-protected" ? t("systemProtected") : t("archiveError"));
      void load();
      return;
    }
    setToast(t("archived"));
  }

  if (state === "loading") return <LoadingPanel />;
  if (state === "error" || !groups) return <ErrorPanel message={t("loadError")} retry={load} />;

  const genderLabels: Record<string, string> = {
    male: t("genderMale"),
    female: t("genderFemale"),
    other: t("genderOther"),
  };
  const orientationLabel = (key: string) => orientations.find((item) => item.key === key)?.label || key;

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />
      {toast && <div className="alert alert-success page-alert" role="status">{toast}</div>}
      <section className="panel">
        <div className="panel-header signup-option-group-header">
          <div>
            <div className="signup-option-title-line"><h2>{t("listTitle")}</h2></div>
            <p>{t("listCopy")}</p>
          </div>
          <button
            className="button button-primary button-small"
            onClick={() => {
              const lastOrder = Math.max(0, ...sorted.map((group) => group.sort_order));
              setFormError("");
              setDraft(draftFrom(undefined, lastOrder + 100));
            }}
          >{t("add")}</button>
        </div>
        <div className="user-group-card-grid">
          {sorted.map((group) => (
            <article className={`user-group-card${group.active ? "" : " is-inactive"}`} key={group.id}>
              <header>
                <div>
                  <div className="user-group-card-title">
                    <h3>{localeText(group.labels, locale)}</h3>
                    {group.system ? <span className="badge badge-warning">{t("system")}</span> : null}
                    <span className={`badge ${group.active ? "badge-active" : "badge-inactive"}`}>{group.active ? t("active") : t("inactive")}</span>
                  </div>
                  <code>{group.key}</code>
                </div>
                <div className="row-actions">
                  <button className="button button-secondary button-small" onClick={() => { setFormError(""); setDraft(draftFrom(group)); }}>{common("edit")}</button>
                  {!group.system && group.active ? <button className="button button-danger button-small" onClick={() => setArchiving(group)}>{t("archive")}</button> : null}
                </div>
              </header>
              <div className="user-group-card-rules">
                {group.rules.map((rule, index) => (
                  <div className="user-group-card-rule" key={index}>
                    <span className="user-group-rule-number">{index + 1}</span>
                    <div>
                      <div className="user-group-rule-chips">{rule.genders.map((gender) => <span key={gender}>{genderLabels[gender] || gender}</span>)}</div>
                      <small>{t("ruleAnd")}</small>
                      <div className="user-group-rule-chips is-orientation">{rule.orientations.map((orientation) => <span key={orientation}>{orientationLabel(orientation)}</span>)}</div>
                    </div>
                    {index < group.rules.length - 1 ? <b>{t("ruleOr")}</b> : null}
                  </div>
                ))}
              </div>
              <details className="user-group-technical">
                <summary>{t("technicalDetails")}</summary>
                <dl>
                  <div><dt>{t("mongoId")}</dt><dd><code>{group.id}</code></dd></div>
                  <div><dt>{t("legacySegment")}</dt><dd>{group.legacy_segment ? <code>{group.legacy_segment}</code> : "—"}</dd></div>
                  <div><dt>{t("order")}</dt><dd>{group.sort_order}</dd></div>
                </dl>
              </details>
            </article>
          ))}
          {sorted.length === 0 ? <p className="signup-options-empty">{t("empty")}</p> : null}
        </div>
      </section>
      {draft && (
        <GroupDialog
          draft={draft}
          segments={segments}
          orientations={orientations}
          busy={busy}
          error={formError}
          onChange={setDraft}
          onClose={() => { if (!busy) setDraft(null); }}
          onSave={() => void save()}
        />
      )}
      {archiving && (
        <ConfirmDialog
          busyLabel={common("saving")}
          title={t("archiveTitle")}
          copy={t("archiveCopy", { name: localeText(archiving.labels, locale) })}
          confirmLabel={t("archive")}
          busy={busy}
          onCancel={() => { if (!busy) setArchiving(null); }}
          onConfirm={() => void archive()}
        />
      )}
    </>
  );
}
