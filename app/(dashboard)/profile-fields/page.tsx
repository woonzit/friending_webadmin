"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import MemberAudienceSelector, { type MemberAudienceValue } from "@/components/MemberAudienceSelector";
import PageHeader from "@/components/PageHeader";
import ProfileIconUploadField from "@/components/ProfileIconUploadField";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { migrateLegacyAudience } from "@/lib/memberAudience";
import {
  profileFieldCatalog,
  profileSectionLayout,
  type ProfileField,
  type ProfileFieldCatalog,
  type ProfileFieldOption,
  type ProfileSectionItem,
  type ProfileSectionLayout,
} from "@/lib/profileFields";

type FieldDraft = {
  originalKey: string;
  key: string;
  labels: Record<string, string>;
  descriptions: Record<string, string>;
  labelEn: string;
  labelHu: string;
  descriptionEn: string;
  descriptionHu: string;
  selectionMode: "single" | "multi";
  minSelected: number;
  maxSelected: number;
  audienceMode: "global" | "segments";
  genders: string[];
  segments: string[];
  groupIds: string[];
  iconUrl: string;
  iconMime: string;
  sortOrder: number;
  active: boolean;
  revision: number;
};

type OptionDraft = {
  fieldKey: string;
  originalKey: string;
  key: string;
  labels: Record<string, string>;
  labelEn: string;
  labelHu: string;
  sortOrder: number;
  active: boolean;
  revision: number;
};

function localeText(labels: Record<string, string>, locale: string): string {
  return labels[locale] || labels[locale.split("-")[0]] || labels.en || labels.hu || "";
}

function fieldDraft(field?: ProfileField, nextOrder = 10, castGroups: ProfileFieldCatalog["cast_groups"] = []): FieldDraft {
  const migratedAudience = migrateLegacyAudience(
    field?.audience.group_ids ?? [],
    field?.audience.segments ?? [],
    castGroups,
  );
  return {
    originalKey: field?.key ?? "",
    key: field?.key ?? "",
    labels: field?.labels ?? {},
    descriptions: field?.descriptions ?? {},
    labelEn: field?.labels.en ?? "",
    labelHu: field?.labels.hu ?? "",
    descriptionEn: field?.descriptions.en ?? "",
    descriptionHu: field?.descriptions.hu ?? "",
    selectionMode: field?.selection.mode ?? "single",
    minSelected: field?.selection.min_selected ?? 0,
    maxSelected: field?.selection.max_selected ?? 1,
    audienceMode: field?.audience.mode ?? "global",
    genders: field?.audience.genders ?? [],
    segments: migratedAudience.legacySegments,
    groupIds: migratedAudience.groupIds,
    iconUrl: field?.icon.url ?? "",
    iconMime: field?.icon.mime ?? "",
    sortOrder: field?.sort_order ?? nextOrder,
    active: field?.active ?? true,
    revision: field?.revision ?? 0,
  };
}

function optionDraft(field: ProfileField, option?: ProfileFieldOption): OptionDraft {
  return {
    fieldKey: field.key,
    originalKey: option?.key ?? "",
    key: option?.key ?? "",
    labels: option?.labels ?? {},
    labelEn: option?.labels.en ?? "",
    labelHu: option?.labels.hu ?? "",
    sortOrder: option?.sort_order
      ?? Math.max(0, ...field.options.map((row) => row.sort_order)) + 10,
    active: option?.active ?? true,
    revision: option?.revision ?? 0,
  };
}

function useProfileDialog(onClose: () => void, busy: boolean) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusableSelector = [
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[href]",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
    });
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)]
        .filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);
  return dialogRef;
}

function FieldDialog({
  draft,
  catalog,
  busy,
  error,
  onChange,
  onClose,
  onSave,
}: {
  draft: FieldDraft;
  catalog: ProfileFieldCatalog;
  busy: boolean;
  error: string;
  onChange: (draft: FieldDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const t = useTranslations("profileFields");
  const common = useTranslations("common");
  const locale = useLocale();
  const isNew = draft.originalKey === "";
  const dialogRef = useProfileDialog(onClose, busy);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !busy) onClose();
    }}>
      <section ref={dialogRef} tabIndex={-1} className="dialog profile-field-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-field-dialog-title">
        <div className="dialog-header">
          <div><h2 id="profile-field-dialog-title">{isNew ? t("fieldAddTitle") : t("fieldEditTitle")}</h2><p>{t("fieldDialogCopy")}</p></div>
          <button className="dialog-close" type="button" onClick={onClose} disabled={busy} aria-label={common("close")}>×</button>
        </div>
        <div className="dialog-body form-grid profile-field-form">
          <label className="field field-full">
            <span>{t("key")}</span>
            <input
              value={draft.key}
              disabled={!isNew || busy}
              maxLength={64}
              spellCheck={false}
              onChange={(event) => onChange({ ...draft, key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
            />
            <small className="field-hint">{t("keyHint")}</small>
          </label>
          <label className="field"><span>{t("labelEn")}</span><input value={draft.labelEn} maxLength={80} disabled={busy} onChange={(event) => onChange({ ...draft, labelEn: event.target.value })} /></label>
          <label className="field"><span>{t("labelHu")}</span><input value={draft.labelHu} maxLength={80} disabled={busy} onChange={(event) => onChange({ ...draft, labelHu: event.target.value })} /></label>
          <label className="field"><span>{t("descriptionEn")}</span><textarea value={draft.descriptionEn} maxLength={240} disabled={busy} onChange={(event) => onChange({ ...draft, descriptionEn: event.target.value })} /></label>
          <label className="field"><span>{t("descriptionHu")}</span><textarea value={draft.descriptionHu} maxLength={240} disabled={busy} onChange={(event) => onChange({ ...draft, descriptionHu: event.target.value })} /></label>
          <label className="field">
            <span>{t("selectionMode")}</span>
            <select value={draft.selectionMode} disabled={busy} onChange={(event) => {
              const mode = event.target.value as "single" | "multi";
              onChange({
                ...draft,
                selectionMode: mode,
                minSelected: mode === "single" ? Math.min(1, draft.minSelected) : draft.minSelected,
                maxSelected: mode === "single" ? 1 : Math.max(2, draft.maxSelected),
              });
            }}><option value="single">{t("single")}</option><option value="multi">{t("multi")}</option></select>
          </label>
          <label className="field"><span>{t("minimum")}</span><input type="number" min="0" max={draft.selectionMode === "single" ? 1 : 20} value={draft.minSelected} disabled={busy} onChange={(event) => onChange({ ...draft, minSelected: Math.max(0, Math.min(draft.maxSelected, Number(event.target.value) || 0)) })} /></label>
          <label className="field"><span>{t("maximum")}</span><input type="number" min="1" max="20" value={draft.maxSelected} disabled={busy || draft.selectionMode === "single"} onChange={(event) => {
            const maximum = Math.max(1, Math.min(20, Number(event.target.value) || 1));
            onChange({ ...draft, maxSelected: maximum, minSelected: Math.min(draft.minSelected, maximum) });
          }} /></label>
          <label className="field"><span>{t("order")}</span><input type="number" min="0" max="100000" value={draft.sortOrder} disabled={busy} onChange={(event) => onChange({ ...draft, sortOrder: Math.max(0, Math.min(100000, Number(event.target.value) || 0)) })} /></label>
          <MemberAudienceSelector
            value={{ mode: draft.audienceMode, genders: draft.genders, groupIds: draft.groupIds, legacySegments: draft.segments }}
            groups={catalog.cast_groups}
            legacyOptions={catalog.segments}
            locale={locale}
            disabled={busy}
            labels={{
              legend: t("audience"), help: t("audienceHelp"), global: t("global"), custom: t("castSpecific"),
              globalHint: t("audienceGlobalHint"), genders: t("audienceGendersTitle"), groups: t("audienceGroupsTitle"),
              matchAny: t("audienceMatchAny"), groupsRecorded: t("audienceGroupsRecorded"), groupsNotEnforced: t("audienceGroupsNotEnforced"), required: t("audienceRequired"),
              inactive: t("audienceGroupInactive"), legacy: t("audienceLegacy"),
              gender: { male: t("genderMale"), female: t("genderFemale"), other: t("genderOther") },
            }}
            onChange={(audience: MemberAudienceValue) => onChange({
              ...draft,
              audienceMode: audience.mode,
              genders: audience.genders,
              groupIds: audience.groupIds,
              segments: audience.legacySegments,
            })}
          />
          <ProfileIconUploadField
            label={t("icon")}
            hint={t("iconHint")}
            chooseLabel={t("iconChoose")}
            removeLabel={t("iconRemove")}
            uploadingLabel={t("iconUploading")}
            errorLabel={t("iconError")}
            value={draft.iconUrl}
            disabled={busy}
            onChange={({ url, mime }) => onChange({ ...draft, iconUrl: url, iconMime: mime })}
          />
          <label className="checkbox-field profile-field-active"><input type="checkbox" checked={draft.active} disabled={busy} onChange={(event) => onChange({ ...draft, active: event.target.checked })} /><span>{t("active")}</span></label>
          {error ? <div className="alert alert-error field-full" role="alert">{error}</div> : null}
        </div>
        <div className="dialog-actions"><button className="button button-secondary" type="button" onClick={onClose} disabled={busy}>{common("cancel")}</button><button className="button button-primary" type="button" onClick={onSave} disabled={busy}>{busy ? common("saving") : common("save")}</button></div>
      </section>
    </div>
  );
}

function OptionDialog({
  draft,
  busy,
  error,
  onChange,
  onClose,
  onSave,
}: {
  draft: OptionDraft;
  busy: boolean;
  error: string;
  onChange: (draft: OptionDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const t = useTranslations("profileFields");
  const common = useTranslations("common");
  const isNew = draft.originalKey === "";
  const dialogRef = useProfileDialog(onClose, busy);
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !busy) onClose();
    }}>
      <section ref={dialogRef} tabIndex={-1} className="dialog" role="dialog" aria-modal="true" aria-labelledby="profile-option-dialog-title">
        <div className="dialog-header"><div><h2 id="profile-option-dialog-title">{isNew ? t("optionAddTitle") : t("optionEditTitle")}</h2><p><code>{draft.fieldKey}</code></p></div><button className="dialog-close" type="button" onClick={onClose} disabled={busy} aria-label={common("close")}>×</button></div>
        <div className="dialog-body form-grid">
          <label className="field field-full"><span>{t("key")}</span><input value={draft.key} disabled={!isNew || busy} maxLength={64} onChange={(event) => onChange({ ...draft, key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} /></label>
          <label className="field"><span>{t("labelEn")}</span><input value={draft.labelEn} maxLength={80} disabled={busy} onChange={(event) => onChange({ ...draft, labelEn: event.target.value })} /></label>
          <label className="field"><span>{t("labelHu")}</span><input value={draft.labelHu} maxLength={80} disabled={busy} onChange={(event) => onChange({ ...draft, labelHu: event.target.value })} /></label>
          <label className="field"><span>{t("order")}</span><input type="number" min="0" max="100000" value={draft.sortOrder} disabled={busy} onChange={(event) => onChange({ ...draft, sortOrder: Math.max(0, Math.min(100000, Number(event.target.value) || 0)) })} /></label>
          <label className="checkbox-field"><input type="checkbox" checked={draft.active} disabled={busy} onChange={(event) => onChange({ ...draft, active: event.target.checked })} /><span>{t("active")}</span></label>
          {error ? <div className="alert alert-error field-full" role="alert">{error}</div> : null}
        </div>
        <div className="dialog-actions"><button className="button button-secondary" type="button" onClick={onClose} disabled={busy}>{common("cancel")}</button><button className="button button-primary" type="button" onClick={onSave} disabled={busy}>{busy ? common("saving") : common("save")}</button></div>
      </section>
    </div>
  );
}

function ProfileSectionLayoutEditor({
  layout,
  catalog,
  busy,
  error,
  dirty,
  onChange,
  onSave,
  onReset,
}: {
  layout: ProfileSectionLayout;
  catalog: ProfileFieldCatalog;
  busy: boolean;
  error: string;
  dirty: boolean;
  onChange: (layout: ProfileSectionLayout) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const t = useTranslations("profileFields");
  const locale = useLocale();
  const assigned = new Set(layout.sections.flatMap((section) => (
    section.items.map((item) => `${item.kind}:${item.key}`)
  )));
  const choices = [
    ...layout.builtin_items.map((item) => ({
      kind: "builtin" as const,
      key: item.key,
      label: localeText(item.labels, locale),
      detail: t("layoutBuiltin"),
    })),
    ...catalog.fields.map((field) => ({
      kind: "field" as const,
      key: field.key,
      label: localeText(field.labels, locale),
      detail: t("layoutSelectable"),
    })),
  ];
  const choiceMap = new Map(choices.map((item) => [`${item.kind}:${item.key}`, item]));
  const unassigned = choices.filter((item) => !assigned.has(`${item.kind}:${item.key}`));

  function updateSection(index: number, patch: Partial<ProfileSectionLayout["sections"][number]>) {
    onChange({
      ...layout,
      sections: layout.sections.map((section, sectionIndex) => (
        sectionIndex === index ? { ...section, ...patch } : section
      )),
    });
  }

  function moveItem(sectionIndex: number, itemIndex: number, direction: -1 | 1) {
    const items = [...layout.sections[sectionIndex].items];
    const target = itemIndex + direction;
    if (target < 0 || target >= items.length) return;
    [items[itemIndex], items[target]] = [items[target], items[itemIndex]];
    updateSection(sectionIndex, { items });
  }

  function removeItem(sectionIndex: number, itemIndex: number) {
    updateSection(sectionIndex, {
      items: layout.sections[sectionIndex].items.filter((_, index) => index !== itemIndex),
    });
  }

  function addItem(sectionIndex: number, identity: string) {
    const choice = choiceMap.get(identity);
    if (!choice) return;
    const item: ProfileSectionItem = { kind: choice.kind, key: choice.key };
    updateSection(sectionIndex, { items: [...layout.sections[sectionIndex].items, item] });
  }

  return (
    <section className="panel profile-layout-panel">
      <div className="panel-header profile-layout-header">
        <div><h2>{t("layoutTitle")}</h2><p>{t("layoutCopy")}</p></div>
        <div className="row-actions">
          <button className="button button-secondary" type="button" disabled={!dirty || busy} onClick={onReset}>{t("layoutReset")}</button>
          <button className="button button-primary" type="button" disabled={!dirty || busy} onClick={onSave}>{busy ? t("layoutSaving") : t("layoutSave")}</button>
        </div>
      </div>
      {error ? <div className="alert alert-error profile-layout-alert" role="alert">{error}</div> : null}
      <div className="profile-layout-sections">
        {layout.sections.map((section, sectionIndex) => (
          <article className="profile-layout-section" key={section.key}>
            <div className="profile-layout-section-key"><code>{section.key}</code><span>{t("layoutItems", { count: section.items.length })}</span></div>
            <div className="form-grid profile-layout-copy-fields">
              <label className="field"><span>{t("layoutTitleEn")}</span><input maxLength={80} disabled={busy} value={section.labels.en ?? ""} onChange={(event) => updateSection(sectionIndex, { labels: { ...section.labels, en: event.target.value } })} /></label>
              <label className="field"><span>{t("layoutTitleHu")}</span><input maxLength={80} disabled={busy} value={section.labels.hu ?? ""} onChange={(event) => updateSection(sectionIndex, { labels: { ...section.labels, hu: event.target.value } })} /></label>
              <label className="field"><span>{t("layoutSubtitleEn")}</span><input maxLength={240} disabled={busy} value={section.subtitles.en ?? ""} onChange={(event) => updateSection(sectionIndex, { subtitles: { ...section.subtitles, en: event.target.value } })} /></label>
              <label className="field"><span>{t("layoutSubtitleHu")}</span><input maxLength={240} disabled={busy} value={section.subtitles.hu ?? ""} onChange={(event) => updateSection(sectionIndex, { subtitles: { ...section.subtitles, hu: event.target.value } })} /></label>
              <label className="field field-full"><span>{t("layoutSectionOrder")}</span><input type="number" min="0" max="10000" disabled={busy} value={section.sort_order} onChange={(event) => updateSection(sectionIndex, { sort_order: Math.max(0, Math.min(10000, Number(event.target.value) || 0)) })} /></label>
              <label className="checkbox-field field-full">
                <input
                  type="checkbox"
                  checked={section.hidden}
                  disabled={busy || section.key === "more_about_you"}
                  onChange={(event) => updateSection(sectionIndex, { hidden: event.target.checked })}
                />
                <span>{t("layoutHide")}{section.key === "more_about_you" ? ` — ${t("layoutHideLocked")}` : ""}</span>
              </label>
            </div>
            <ol className="profile-layout-items">
              {section.items.map((item, itemIndex) => {
                const choice = choiceMap.get(`${item.kind}:${item.key}`);
                return (
                  <li key={`${item.kind}:${item.key}`}>
                    <span><strong>{choice?.label || item.key}</strong><small>{choice?.detail} · <code>{item.key}</code></small></span>
                    <div className="row-actions">
                      <button type="button" className="button button-secondary button-small" disabled={busy || itemIndex === 0} onClick={() => moveItem(sectionIndex, itemIndex, -1)} aria-label={t("layoutMoveUp", { name: choice?.label || item.key })}>↑</button>
                      <button type="button" className="button button-secondary button-small" disabled={busy || itemIndex === section.items.length - 1} onClick={() => moveItem(sectionIndex, itemIndex, 1)} aria-label={t("layoutMoveDown", { name: choice?.label || item.key })}>↓</button>
                      <button type="button" className="button button-danger button-small" disabled={busy} onClick={() => removeItem(sectionIndex, itemIndex)}>{t("layoutRemove")}</button>
                    </div>
                  </li>
                );
              })}
            </ol>
            <label className="field profile-layout-add"><span>{t("layoutAdd")}</span><select disabled={busy || unassigned.length === 0} value="" onChange={(event) => { addItem(sectionIndex, event.target.value); event.target.value = ""; }}><option value="">{unassigned.length === 0 ? t("layoutAllAssigned") : t("layoutChoose")}</option>{unassigned.map((item) => <option key={`${item.kind}:${item.key}`} value={`${item.kind}:${item.key}`}>{item.label} · {item.detail}</option>)}</select></label>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function ProfileFieldsPage() {
  const t = useTranslations("profileFields");
  const common = useTranslations("common");
  const locale = useLocale();
  const [catalog, setCatalog] = useState<ProfileFieldCatalog | null>(null);
  const [layout, setLayout] = useState<ProfileSectionLayout | null>(null);
  const [layoutDraft, setLayoutDraft] = useState<ProfileSectionLayout | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");
  const [fieldEditor, setFieldEditor] = useState<FieldDraft | null>(null);
  const [optionEditor, setOptionEditor] = useState<OptionDraft | null>(null);
  const [archive, setArchive] = useState<{ type: "field"; field: ProfileField } | { type: "option"; field: ProfileField; option: ProfileFieldOption } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [layoutError, setLayoutError] = useState("");
  const [expandedFields, setExpandedFields] = useState<Set<string>>(() => new Set());
  const applyCatalog = useCallback((raw: unknown): boolean => {
    const parsed = profileFieldCatalog(raw);
    if (!parsed) return false;
    setCatalog(parsed);
    return true;
  }, []);
  const load = useCallback(async () => {
    const response = await adminCall("list_profile_fields");
    const parsedLayout = profileSectionLayout(response?.layout);
    const catalogSource = response?.catalog && typeof response.catalog === "object" && !Array.isArray(response.catalog)
      && Array.isArray(response.cast_groups)
      ? { ...response.catalog as Record<string, unknown>, cast_groups: response.cast_groups }
      : response?.catalog;
    if (!response?.success || !applyCatalog(catalogSource) || !parsedLayout) {
      setStatus("error");
      return;
    }
    setLayout(parsedLayout);
    setLayoutDraft(parsedLayout);
    setLayoutError("");
    setStatus("ready");
  }, [applyCatalog]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const fields = useMemo(() => {
    if (!catalog) return [];
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return catalog.fields;
    return catalog.fields.filter((field) => [
      field.key,
      ...Object.values(field.labels),
      ...field.options.flatMap((option) => [option.key, ...Object.values(option.labels)]),
    ].some((value) => value.toLocaleLowerCase().includes(needle)));
  }, [catalog, query]);

  const layoutDirty = useMemo(() => (
    Boolean(layout && layoutDraft && JSON.stringify(layout.sections) !== JSON.stringify(layoutDraft.sections))
  ), [layout, layoutDraft]);

  function saveErrorMessage(code: unknown): string {
    if (code === "profile-field-conflict") return t("conflict");
    // Core refuses any of the retired T-632/D-019 catalogue keys before it
    // normalizes anything (`ProfileFieldCatalog::saveField()`), so an operator
    // typing `body_type` into the new-field dialog gets a specific reason
    // instead of the generic "could not be saved".
    if (code === "profile-field-key-retired") return t("keyRetired");
    if (code === "profile-field-minimum-unavailable") return t("minimumUnavailable");
    if (code === "profile-field-icon-unmanaged") return t("iconUnmanaged");
    return t("saveError");
  }

  async function saveLayout() {
    if (!layout || !layoutDraft) return;
    if (layoutDraft.sections.some((section) => !section.labels.en.trim() || !section.labels.hu.trim())) {
      setLayoutError(t("layoutValidationError"));
      return;
    }
    setLayoutBusy(true);
    setLayoutError("");
    const sections = layoutDraft.sections.map((section) => ({
      ...section,
      labels: { ...section.labels, en: section.labels.en.trim(), hu: section.labels.hu.trim() },
      subtitles: Object.fromEntries(Object.entries(section.subtitles).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()])),
    }));
    const response = await adminCall("save_profile_section_layout", {
      sections_json: JSON.stringify(sections),
      expected_revision: layout.revision,
    });
    setLayoutBusy(false);
    const parsed = profileSectionLayout(response?.layout);
    if (!response?.success || !parsed) {
      const code = response?.error;
      setLayoutError(
        code === "profile-section-conflict" ? t("layoutConflict")
          : code === "profile-section-not-hideable" ? t("layoutHideError")
            : t("layoutSaveError"),
      );
      return;
    }
    setLayout(parsed);
    setLayoutDraft(parsed);
    setToast(t("layoutSaved"));
  }

  async function saveField() {
    if (!fieldEditor) return;
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(fieldEditor.key) || !fieldEditor.labelEn.trim() || !fieldEditor.labelHu.trim()) {
      setError(t("validationError"));
      return;
    }
    if (
      fieldEditor.audienceMode === "segments"
      && fieldEditor.genders.length === 0
      && fieldEditor.segments.length === 0
      && fieldEditor.groupIds.length === 0
    ) {
      setError(t("audienceRequired"));
      return;
    }
    setBusy(true);
    setError("");
    const labels: Record<string, string> = {
      ...fieldEditor.labels,
      en: fieldEditor.labelEn.trim(),
      hu: fieldEditor.labelHu.trim(),
    };
    const descriptions: Record<string, string> = { ...fieldEditor.descriptions };
    if (fieldEditor.descriptionEn.trim()) descriptions.en = fieldEditor.descriptionEn.trim();
    else delete descriptions.en;
    if (fieldEditor.descriptionHu.trim()) descriptions.hu = fieldEditor.descriptionHu.trim();
    else delete descriptions.hu;
    const response = await adminCall("save_profile_field", {
      field_key: fieldEditor.key,
      labels_json: JSON.stringify(labels),
      descriptions_json: JSON.stringify(descriptions),
      selection_mode: fieldEditor.selectionMode,
      min_selected: fieldEditor.minSelected,
      max_selected: fieldEditor.selectionMode === "single" ? 1 : fieldEditor.maxSelected,
      audience_mode: fieldEditor.audienceMode,
      segments_json: JSON.stringify(fieldEditor.audienceMode === "segments" ? fieldEditor.segments : []),
      genders_json: JSON.stringify(fieldEditor.audienceMode === "segments" ? fieldEditor.genders : []),
      group_ids_json: JSON.stringify(fieldEditor.audienceMode === "segments" ? fieldEditor.groupIds : []),
      icon_url: fieldEditor.iconUrl,
      icon_mime: fieldEditor.iconMime,
      sort_order: fieldEditor.sortOrder,
      active: fieldEditor.active,
      expected_revision: fieldEditor.revision,
    });
    setBusy(false);
    if (!response?.success || !applyCatalog(response.catalog)) {
      setError(saveErrorMessage(response?.error));
      return;
    }
    setFieldEditor(null);
    setToast(t("saved"));
  }

  async function saveOption() {
    if (!optionEditor) return;
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(optionEditor.key) || !optionEditor.labelEn.trim() || !optionEditor.labelHu.trim()) {
      setError(t("validationError"));
      return;
    }
    setBusy(true);
    setError("");
    const labels: Record<string, string> = {
      ...optionEditor.labels,
      en: optionEditor.labelEn.trim(),
      hu: optionEditor.labelHu.trim(),
    };
    const response = await adminCall("save_profile_field_option", {
      field_key: optionEditor.fieldKey,
      option_key: optionEditor.key,
      labels_json: JSON.stringify(labels),
      sort_order: optionEditor.sortOrder,
      active: optionEditor.active,
      expected_revision: optionEditor.revision,
    });
    setBusy(false);
    if (!response?.success || !applyCatalog(response.catalog)) {
      setError(saveErrorMessage(response?.error));
      return;
    }
    setOptionEditor(null);
    setToast(t("saved"));
  }

  async function confirmArchive() {
    if (!archive) return;
    setBusy(true);
    const response = archive.type === "field"
      ? await adminCall("archive_profile_field", { field_key: archive.field.key, expected_revision: archive.field.revision })
      : await adminCall("archive_profile_field_option", { field_key: archive.field.key, option_key: archive.option.key, expected_revision: archive.option.revision });
    setBusy(false);
    if (!response?.success || !applyCatalog(response.catalog)) {
      setToast(response?.error === "profile-field-minimum-unavailable"
        ? t("minimumUnavailable")
        : t("archiveError"));
      setArchive(null);
      return;
    }
    setArchive(null);
    setToast(t("archived"));
  }

  if (status === "loading") return <LoadingPanel />;
  if (status === "error" || !catalog || !layout || !layoutDraft) return <ErrorPanel message={t("loadError")} retry={load} />;

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />
      {toast ? <div className="alert alert-success page-alert" role="status">{toast}</div> : null}
      <ProfileSectionLayoutEditor layout={layoutDraft} catalog={catalog} busy={layoutBusy} error={layoutError} dirty={layoutDirty} onChange={setLayoutDraft} onSave={() => void saveLayout()} onReset={() => { setLayoutDraft(layout); setLayoutError(""); }} />
      <section className="panel"><div className="panel-body profile-fields-toolbar"><label className="field"><span>{t("search")}</span><input type="search" value={query} placeholder={t("searchPlaceholder")} onChange={(event) => setQuery(event.target.value)} /></label><div><p>{t("toolbarCopy")}</p><button className="button button-primary" type="button" onClick={() => { setError(""); setFieldEditor(fieldDraft(undefined, Math.max(0, ...catalog.fields.map((field) => field.sort_order)) + 10, catalog.cast_groups)); }}>{t("addField")}</button></div></div></section>
      <div className="profile-field-list">
        {fields.map((field) => (
          <section className={`panel profile-field-card${field.active ? "" : " is-inactive"}`} key={field.key}>
            <div className="panel-header profile-field-card-header">
              <div className="profile-field-heading">
                <span className="profile-field-card-icon">{/* eslint-disable-next-line @next/next/no-img-element */}{field.icon.url ? <img src={field.icon.url} alt="" /> : <b>{localeText(field.labels, locale).slice(0, 1)}</b>}</span>
                <div><div><h2>{localeText(field.labels, locale)}</h2><code>{field.key}</code>{field.system_owned ? <span className="badge badge-warning">{t("system")}</span> : <span className="badge">{t("custom")}</span>}{!field.active ? <span className="badge badge-inactive">{t("inactive")}</span> : null}</div><p>{field.audience.mode === "global" ? t("global") : t("castCount", { count: field.audience.genders.length + field.audience.segments.length + field.audience.group_ids.length })} · {field.selection.mode === "single" ? t("single") : t("multiRange", { min: field.selection.min_selected, max: field.selection.max_selected })}</p></div>
              </div>
              <div className="row-actions"><button className="button button-secondary button-small" type="button" onClick={() => { setError(""); setFieldEditor(fieldDraft(field, 10, catalog.cast_groups)); }}>{common("edit")}</button>{field.active ? <button className="button button-danger button-small" type="button" onClick={() => setArchive({ type: "field", field })}>{t("archive")}</button> : null}</div>
            </div>
            <div className="profile-field-option-toolbar"><button className="button button-secondary button-small" type="button" aria-expanded={expandedFields.has(field.key)} onClick={() => setExpandedFields((current) => { const next = new Set(current); if (next.has(field.key)) next.delete(field.key); else next.add(field.key); return next; })}>{expandedFields.has(field.key) ? t("hideAnswers") : t("showAnswers", { count: field.options.length })}</button><button className="button button-secondary button-small" type="button" onClick={() => { setError(""); setOptionEditor(optionDraft(field)); }}>{t("addOption")}</button></div>
            {expandedFields.has(field.key) ? <div className="table-wrap"><table className="data-table profile-field-options"><thead><tr><th>{t("id")}</th><th>{t("key")}</th><th>{t("labelEn")}</th><th>{t("labelHu")}</th><th>{t("order")}</th><th>{t("status")}</th><th><span className="sr-only">{common("actions")}</span></th></tr></thead><tbody>
              {field.options.map((option) => <tr key={option.key} className={option.active ? "" : "is-inactive"}><td><code>{option.option_id}</code></td><td><code>{option.key}</code></td><td>{option.labels.en}</td><td>{option.labels.hu}</td><td>{option.sort_order}</td><td><span className={`badge ${option.active ? "badge-active" : "badge-inactive"}`}>{option.active ? t("active") : t("inactive")}</span></td><td><div className="row-actions"><button className="button button-secondary button-small" type="button" onClick={() => { setError(""); setOptionEditor(optionDraft(field, option)); }}>{common("edit")}</button>{option.active ? <button className="button button-danger button-small" type="button" onClick={() => setArchive({ type: "option", field, option })}>{t("archive")}</button> : null}</div></td></tr>)}
              {field.options.length === 0 ? <tr><td colSpan={7} className="signup-options-empty">{t("noOptions")}</td></tr> : null}
            </tbody></table></div> : null}
          </section>
        ))}
      </div>
      {fields.length === 0 ? <section className="panel"><div className="empty-state"><p>{t("noMatches")}</p></div></section> : null}
      {fieldEditor ? <FieldDialog draft={fieldEditor} catalog={catalog} busy={busy} error={error} onChange={setFieldEditor} onClose={() => { if (!busy) setFieldEditor(null); }} onSave={() => void saveField()} /> : null}
      {optionEditor ? <OptionDialog draft={optionEditor} busy={busy} error={error} onChange={setOptionEditor} onClose={() => { if (!busy) setOptionEditor(null); }} onSave={() => void saveOption()} /> : null}
      {archive ? <ConfirmDialog title={t("archiveTitle")} copy={archive.type === "field" ? t("archiveFieldCopy", { name: localeText(archive.field.labels, locale) }) : t("archiveOptionCopy", { name: localeText(archive.option.labels, locale) })} confirmLabel={t("archive")} busy={busy} onCancel={() => { if (!busy) setArchive(null); }} onConfirm={() => void confirmArchive()} /> : null}
    </>
  );
}
