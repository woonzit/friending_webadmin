"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import PageHeader from "@/components/PageHeader";
import ProfileIconUploadField from "@/components/ProfileIconUploadField";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import {
  TAG_GENDERS,
  TAG_SEGMENTS,
  catalogImpact,
  isTagModerationLocked,
  moveTagGroup,
  moveTagItem,
  normalizeManagedIcon,
  parseProfileTagCatalogPayload,
  parseProfileTagPreview,
  parseTagCatalogSaveResult,
  serializeTagCatalog,
  type ProfileTagCatalog,
  type ProfileTagGroup,
  type ProfileTagItem,
  type ProfileTagPreview,
  type ProfileTagWarning,
  type TagAudience,
} from "@/lib/profilePresentation";

type CatalogKey = ProfileTagCatalog["key"];
type CatalogMap = Record<CatalogKey, ProfileTagCatalog>;
type GroupEditor = { originalKey: string; group: ProfileTagGroup };
type ItemEditor = { originalKey: string; sourceGroupKey: string; targetGroupKey: string; item: ProfileTagItem };

const CATALOG_KEYS: CatalogKey[] = ["what_im_into", "my_story", "interests"];

function localeText(labels: Record<string, string>, locale: string): string {
  return labels[locale] || labels[locale.split("-")[0]] || labels.en || labels.hu || "";
}

function catalogMap(catalogs: ProfileTagCatalog[]): CatalogMap {
  return Object.fromEntries(catalogs.map((catalog) => [catalog.key, structuredClone(catalog)])) as CatalogMap;
}

function catalogsEqual(left: ProfileTagCatalog, right: ProfileTagCatalog): boolean {
  return JSON.stringify(serializeTagCatalog(left)) === JSON.stringify(serializeTagCatalog(right));
}

function emptyAudience(): TagAudience {
  return { genders: [], segments: [] };
}

function newGroup(order: number): ProfileTagGroup {
  return { key: "", labels: { en: "", hu: "" }, sort_order: order, active: true, audience: emptyAudience(), revision: 0, items: [] };
}

function newItem(order: number): ProfileTagItem {
  // A brand-new administrator row states nothing: Core reads an absent
  // moderation state as "keep what is stored", and a key nobody has ever
  // moderated is stored approved. Sending "approved" here would be the console
  // asserting a moderation decision it did not make.
  return { key: "", labels: { en: "", hu: "" }, sort_order: order, active: true, audience: emptyAudience(), icon: { url: "", mime: "" }, emoji: "", revision: 0, selected_member_count: 0, moderation_state: null };
}

/** The badge class for one row's moderation state; an unstated row shows nothing. */
function moderationBadgeClass(item: ProfileTagItem): string {
  switch (item.moderation_state) {
    case "pending": return "status-badge status-pending";
    case "rejected": return "status-badge status-denied";
    case "merged": return "status-badge status-merged";
    default: return "status-badge status-accepted";
  }
}

function AudienceEditor({ audience, disabled, onChange }: { audience: TagAudience; disabled: boolean; onChange: (audience: TagAudience) => void }) {
  const t = useTranslations("profileTags");
  const global = audience.genders.length === 0 && audience.segments.length === 0;
  function toggle<T extends string>(values: T[], value: T): T[] {
    return values.includes(value) ? values.filter((row) => row !== value) : [...values, value];
  }
  return (
    <fieldset className="tag-audience-fieldset" disabled={disabled}>
      <legend>{t("audience")}</legend>
      <label className="checkbox-row"><input type="checkbox" checked={global} onChange={() => onChange(emptyAudience())} /><span>{t("globalAudience")}</span></label>
      <div className="tag-audience-columns">
        <div><strong>{t("gendersTitle")}</strong>{TAG_GENDERS.map((gender) => <label className="checkbox-row" key={gender}><input type="checkbox" checked={audience.genders.includes(gender)} onChange={() => onChange({ ...audience, genders: toggle(audience.genders, gender) })} /><span>{t(`genders.${gender}`)}</span></label>)}</div>
        <div><strong>{t("segmentsTitle")}</strong>{TAG_SEGMENTS.map((segment) => <label className="checkbox-row" key={segment}><input type="checkbox" checked={audience.segments.includes(segment)} onChange={() => onChange({ ...audience, segments: toggle(audience.segments, segment) })} /><span>{t(`segments.${segment}`)}</span></label>)}</div>
      </div>
      <small className="field-hint">{t("audienceHint")}</small>
    </fieldset>
  );
}

function GroupDialog({ editor, busy, error, onChange, onClose, onSave }: { editor: GroupEditor; busy: boolean; error: string; onChange: (editor: GroupEditor) => void; onClose: () => void; onSave: () => void }) {
  const t = useTranslations("profileTags");
  const common = useTranslations("common");
  const isNew = editor.originalKey === "";
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose(); }}>
      <section className="dialog profile-tag-dialog" role="dialog" aria-modal="true" aria-labelledby="tag-group-dialog-title">
        <div className="dialog-header"><div><h2 id="tag-group-dialog-title">{t(isNew ? "addGroupTitle" : "editGroupTitle")}</h2><p>{t("groupDialogCopy")}</p></div><button className="dialog-close" type="button" onClick={onClose} disabled={busy} aria-label={common("close")}>×</button></div>
        <div className="dialog-body form-grid">
          <label className="field field-full"><span>{t("stableKey")}</span><input maxLength={64} spellCheck={false} disabled={!isNew || busy} value={editor.group.key} onChange={(event) => onChange({ ...editor, group: { ...editor.group, key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") } })} /><small className="field-hint">{t("groupKeyHint")}</small></label>
          <label className="field"><span>{t("labelEn")}</span><input maxLength={100} disabled={busy} value={editor.group.labels.en ?? ""} onChange={(event) => onChange({ ...editor, group: { ...editor.group, labels: { ...editor.group.labels, en: event.target.value } } })} /></label>
          <label className="field"><span>{t("labelHu")}</span><input maxLength={100} disabled={busy} value={editor.group.labels.hu ?? ""} onChange={(event) => onChange({ ...editor, group: { ...editor.group, labels: { ...editor.group.labels, hu: event.target.value } } })} /></label>
          <label className="checkbox-row field-full"><input type="checkbox" disabled={busy} checked={editor.group.active} onChange={(event) => onChange({ ...editor, group: { ...editor.group, active: event.target.checked } })} /><span>{t("groupActive")}</span></label>
          <div className="field-full"><AudienceEditor audience={editor.group.audience} disabled={busy} onChange={(audience) => onChange({ ...editor, group: { ...editor.group, audience } })} /></div>
          {editor.group.items.some((item) => item.selected_member_count > 0) ? <div className="alert alert-warning field-full">{t("groupSelectedWarning", { count: editor.group.items.reduce((sum, item) => sum + item.selected_member_count, 0) })}</div> : null}
          {error ? <div className="alert alert-error field-full" role="alert">{error}</div> : null}
        </div>
        <div className="dialog-actions"><button className="button button-secondary" type="button" disabled={busy} onClick={onClose}>{common("cancel")}</button><button className="button button-primary" type="button" disabled={busy} onClick={onSave}>{common("save")}</button></div>
      </section>
    </div>
  );
}

function ItemDialog({ editor, groups, busy, error, onChange, onClose, onSave }: { editor: ItemEditor; groups: ProfileTagGroup[]; busy: boolean; error: string; onChange: (editor: ItemEditor) => void; onClose: () => void; onSave: () => void }) {
  const t = useTranslations("profileTags");
  const common = useTranslations("common");
  const isNew = editor.originalKey === "";
  // A rejected row is a permanent ban and a merged row is an alias for another
  // key. Core refuses a save that would activate either, so the console must
  // not offer the checkbox that produces that refusal.
  const locked = isTagModerationLocked(editor.item.moderation_state);
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose(); }}>
      <section className="dialog profile-tag-dialog profile-tag-item-dialog" role="dialog" aria-modal="true" aria-labelledby="tag-item-dialog-title">
        <div className="dialog-header"><div><h2 id="tag-item-dialog-title">{t(isNew ? "addItemTitle" : "editItemTitle")}</h2><p>{t("itemDialogCopy")}</p></div><button className="dialog-close" type="button" onClick={onClose} disabled={busy} aria-label={common("close")}>×</button></div>
        <div className="dialog-body form-grid">
          <label className="field field-full"><span>{t("stableKey")}</span><input maxLength={64} spellCheck={false} disabled={!isNew || busy} value={editor.item.key} onChange={(event) => onChange({ ...editor, item: { ...editor.item, key: event.target.value.toLowerCase().replace(/[^a-z0-9_+\-]/g, "") } })} /><small className="field-hint">{t("itemKeyHint")}</small></label>
          <label className="field"><span>{t("labelEn")}</span><input maxLength={100} disabled={busy} value={editor.item.labels.en ?? ""} onChange={(event) => onChange({ ...editor, item: { ...editor.item, labels: { ...editor.item.labels, en: event.target.value } } })} /></label>
          <label className="field"><span>{t("labelHu")}</span><input maxLength={100} disabled={busy} value={editor.item.labels.hu ?? ""} onChange={(event) => onChange({ ...editor, item: { ...editor.item, labels: { ...editor.item.labels, hu: event.target.value } } })} /></label>
          <label className="field"><span>{t("group")}</span><select value={editor.targetGroupKey} disabled={busy} onChange={(event) => onChange({ ...editor, targetGroupKey: event.target.value })}>{groups.map((group) => <option value={group.key} key={group.key}>{group.labels.en} · {group.key}</option>)}</select></label>
          <label className="field"><span>{t("emoji")}</span><input maxLength={16} disabled={busy} value={editor.item.emoji} placeholder="✨" onChange={(event) => onChange({ ...editor, item: { ...editor.item, emoji: event.target.value } })} /><small className="field-hint">{t("emojiHint")}</small></label>
          <div className="field field-full profile-tag-moderation-field"><span>{t("moderationState")}</span><span className={moderationBadgeClass(editor.item)}>{t(`moderationStates.${editor.item.moderation_state ?? "unstated"}`)}</span><small className="field-hint">{locked ? t("moderationLockedHint") : t("moderationStateHint")}</small></div>
          <label className="checkbox-row field-full"><input type="checkbox" disabled={busy || locked} checked={editor.item.active && !locked} onChange={(event) => onChange({ ...editor, item: { ...editor.item, active: event.target.checked } })} /><span>{t("itemActive")}</span></label>
          <div className="field-full"><ProfileIconUploadField label={t("icon")} hint={t("iconHint")} chooseLabel={t("chooseIcon")} removeLabel={t("removeIcon")} uploadingLabel={t("uploadingIcon")} errorLabel={t("iconError")} value={editor.item.icon.url} disabled={busy} onChange={(icon) => { const normalized = normalizeManagedIcon(icon); if (normalized) onChange({ ...editor, item: { ...editor.item, icon: normalized } }); }} /></div>
          <div className="field-full"><AudienceEditor audience={editor.item.audience} disabled={busy} onChange={(audience) => onChange({ ...editor, item: { ...editor.item, audience } })} /></div>
          {editor.item.selected_member_count > 0 ? <div className="alert alert-warning field-full">{t("itemSelectedWarning", { count: editor.item.selected_member_count })}</div> : null}
          {error ? <div className="alert alert-error field-full" role="alert">{error}</div> : null}
        </div>
        <div className="dialog-actions"><button className="button button-secondary" type="button" disabled={busy} onClick={onClose}>{common("cancel")}</button><button className="button button-primary" type="button" disabled={busy} onClick={onSave}>{common("save")}</button></div>
      </section>
    </div>
  );
}

export default function ProfileTagsPage() {
  const t = useTranslations("profileTags");
  const common = useTranslations("common");
  const locale = useLocale();
  const [baseline, setBaseline] = useState<CatalogMap | null>(null);
  const [drafts, setDrafts] = useState<CatalogMap | null>(null);
  const [currentKey, setCurrentKey] = useState<CatalogKey>("what_im_into");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [warnings, setWarnings] = useState<ProfileTagWarning[]>([]);
  const [groupEditor, setGroupEditor] = useState<GroupEditor | null>(null);
  const [itemEditor, setItemEditor] = useState<ItemEditor | null>(null);
  const [editorError, setEditorError] = useState("");
  const [dragGroup, setDragGroup] = useState("");
  const [dragItem, setDragItem] = useState<{ groupKey: string; itemKey: string } | null>(null);
  const [previewLanguage, setPreviewLanguage] = useState("en");
  const [previewGender, setPreviewGender] = useState<TagAudience["genders"][number]>("female");
  const [previewSegment, setPreviewSegment] = useState("female_lesbian");
  const [preview, setPreview] = useState<ProfileTagPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const load = useCallback(async () => {
    setStatus("loading");
    const response = await adminCall("profile_tag_catalogs");
    const parsed = response?.success ? parseProfileTagCatalogPayload(response.data) : null;
    if (!parsed) {
      setStatus("error");
      return;
    }
    setBaseline(catalogMap(parsed.catalogs));
    setDrafts(catalogMap(parsed.catalogs));
    setError("");
    setWarnings([]);
    setPreview(null);
    setStatus("ready");
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const draft = drafts?.[currentKey] ?? null;
  const original = baseline?.[currentKey] ?? null;
  const dirty = Boolean(draft && original && !catalogsEqual(draft, original));
  const itemCount = draft?.groups.reduce((sum, group) => sum + group.items.length, 0) ?? 0;
  const selectedCount = draft?.groups.reduce((sum, group) => sum + group.items.reduce((itemSum, item) => itemSum + item.selected_member_count, 0), 0) ?? 0;

  function updateDraft(next: ProfileTagCatalog) {
    if (!drafts) return;
    setDrafts({ ...drafts, [currentKey]: next });
    setError("");
    setWarnings([]);
  }

  function changeTab(key: CatalogKey) {
    setCurrentKey(key);
    setError("");
    setWarnings([]);
    setPreview(null);
    setPreviewError("");
  }

  function saveGroupEditor() {
    if (!groupEditor || !draft) return;
    const group = groupEditor.group;
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(group.key) || !group.labels.en?.trim() || !group.labels.hu?.trim()) {
      setEditorError(t("groupValidation"));
      return;
    }
    if (draft.groups.some((row) => row.key === group.key && row.key !== groupEditor.originalKey)) {
      setEditorError(t("duplicateKey"));
      return;
    }
    const normalized = { ...group, labels: { ...group.labels, en: group.labels.en.trim(), hu: group.labels.hu.trim() } };
    const groups = groupEditor.originalKey
      ? draft.groups.map((row) => row.key === groupEditor.originalKey ? normalized : row)
      : [...draft.groups, normalized];
    updateDraft({ ...draft, groups });
    setGroupEditor(null);
  }

  function saveItemEditor() {
    if (!itemEditor || !draft) return;
    const item = itemEditor.item;
    if (!/^[a-z0-9][a-z0-9_+\-]{0,63}$/.test(item.key) || !item.labels.en?.trim() || !item.labels.hu?.trim() || !draft.groups.some((group) => group.key === itemEditor.targetGroupKey)) {
      setEditorError(t("itemValidation"));
      return;
    }
    const allItems = draft.groups.flatMap((group) => group.items);
    if (allItems.some((row) => row.key === item.key && row.key !== itemEditor.originalKey)) {
      setEditorError(t("duplicateKey"));
      return;
    }
    const normalized = { ...item, labels: { ...item.labels, en: item.labels.en.trim(), hu: item.labels.hu.trim() }, emoji: item.emoji.trim() };
    let insertionIndex = -1;
    const groups = draft.groups.map((group) => {
      const index = group.items.findIndex((row) => row.key === itemEditor.originalKey);
      if (group.key === itemEditor.targetGroupKey && index >= 0) insertionIndex = index;
      return { ...group, items: group.items.filter((row) => row.key !== itemEditor.originalKey) };
    });
    const target = groups.find((group) => group.key === itemEditor.targetGroupKey)!;
    target.items.splice(insertionIndex >= 0 ? insertionIndex : target.items.length, 0, normalized);
    updateDraft({ ...draft, groups });
    setItemEditor(null);
  }

  async function saveCatalog() {
    if (!draft || !original) return;
    if (!draft.labels.en?.trim() || !draft.labels.hu?.trim() || draft.minimum_selected > draft.maximum_selected) {
      setError(t("catalogValidation"));
      return;
    }
    const impact = catalogImpact(original, draft);
    if ((impact.selectedReferences > 0 || impact.limitLowered) && !window.confirm(t("impactConfirm", { count: impact.selectedReferences }))) return;
    setBusy(true);
    setError("");
    const response = await adminCall("save_profile_tag_catalog", { catalog: serializeTagCatalog(draft) });
    setBusy(false);
    if (!response?.success) {
      // D-107 R11. Core refuses a save that would activate or re-state a
      // rejected/merged row. The generic save error would read as "try again",
      // which is exactly wrong: the fix is to leave the banned row alone.
      setError(response?.error === "profile-tag-catalog-conflict"
        ? t("conflict")
        : response?.error === "profile-tag-item-moderation-locked"
          ? t("moderationLocked")
          : t("saveError"));
      return;
    }
    const parsed = parseTagCatalogSaveResult(response.data);
    if (!parsed || parsed.catalog.key !== currentKey || !baseline || !drafts) {
      setError(t("invalidResponse"));
      return;
    }
    setBaseline({ ...baseline, [currentKey]: structuredClone(parsed.catalog) });
    setDrafts({ ...drafts, [currentKey]: structuredClone(parsed.catalog) });
    setWarnings(parsed.warnings);
    setPreview(null);
    setToast(t("saved"));
  }

  async function loadPreview() {
    if (!draft) return;
    setPreviewBusy(true);
    setPreviewError("");
    const response = await adminCall("profile_tag_catalog_preview", { catalog_key: draft.key, lang: previewLanguage, gender: previewGender, segment: previewSegment });
    setPreviewBusy(false);
    const parsed = response?.success ? parseProfileTagPreview(response.data) : null;
    if (!parsed) {
      setPreviewError(t("previewError"));
      setPreview(null);
      return;
    }
    setPreview(parsed);
  }

  if (status === "loading") return <LoadingPanel />;
  if (status === "error" || !baseline || !drafts || !draft || !original) return <ErrorPanel message={t("loadError")} retry={load} />;

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />
      {toast ? <div className="alert alert-success page-alert" role="status">{toast}</div> : null}
      <nav className="profile-tag-tabs" aria-label={t("catalogTabs")}>{CATALOG_KEYS.map((key) => <button type="button" key={key} className={currentKey === key ? "active" : ""} aria-current={currentKey === key ? "page" : undefined} onClick={() => changeTab(key)}>{t(`catalogs.${key}`)}{!catalogsEqual(drafts[key], baseline[key]) ? <span aria-label={t("unsaved")}>•</span> : null}</button>)}</nav>

      <section className="panel profile-tag-catalog-settings">
        <div className="panel-header"><div><h2>{localeText(draft.labels, locale)}</h2><p><code>{draft.key}</code> · {t("legacyField", { field: draft.legacy_field })} · {t("revision", { revision: draft.revision })}</p></div><div className="row-actions"><button className="button button-secondary" type="button" disabled={!dirty || busy} onClick={() => { updateDraft(structuredClone(original)); setError(""); }}>{t("reset")}</button><button className="button button-primary" type="button" disabled={!dirty || busy} onClick={() => void saveCatalog()}>{busy ? common("saving") : common("save")}</button></div></div>
        <div className="panel-body form-grid">
          <label className="field"><span>{t("titleEn")}</span><input maxLength={100} disabled={busy} value={draft.labels.en ?? ""} onChange={(event) => updateDraft({ ...draft, labels: { ...draft.labels, en: event.target.value } })} /></label>
          <label className="field"><span>{t("titleHu")}</span><input maxLength={100} disabled={busy} value={draft.labels.hu ?? ""} onChange={(event) => updateDraft({ ...draft, labels: { ...draft.labels, hu: event.target.value } })} /></label>
          <label className="field"><span>{t("subtitleEn")}</span><textarea maxLength={280} disabled={busy} value={draft.subtitles.en ?? ""} onChange={(event) => updateDraft({ ...draft, subtitles: { ...draft.subtitles, en: event.target.value } })} /></label>
          <label className="field"><span>{t("subtitleHu")}</span><textarea maxLength={280} disabled={busy} value={draft.subtitles.hu ?? ""} onChange={(event) => updateDraft({ ...draft, subtitles: { ...draft.subtitles, hu: event.target.value } })} /></label>
          <label className="field"><span>{t("minimum")}</span><input type="number" min="0" max="20" disabled={busy} value={draft.minimum_selected} onChange={(event) => updateDraft({ ...draft, minimum_selected: Math.max(0, Math.min(20, Number(event.target.value) || 0)) })} /></label>
          <label className="field"><span>{t("maximum")}</span><input type="number" min="1" max="20" disabled={busy} value={draft.maximum_selected} onChange={(event) => updateDraft({ ...draft, maximum_selected: Math.max(1, Math.min(20, Number(event.target.value) || 1)) })} /></label>
          <label className="checkbox-row field-full"><input type="checkbox" disabled={busy} checked={draft.active} onChange={(event) => updateDraft({ ...draft, active: event.target.checked })} /><span>{t("catalogActive")}</span></label>
          <div className="profile-tag-catalog-metrics field-full"><span>{t("groupCount", { count: draft.groups.length })}</span><span>{t("itemCount", { count: itemCount })}</span><span>{t("selectedReferences", { count: selectedCount })}</span></div>
          {error ? <div className="alert alert-error field-full profile-tag-save-error" role="alert"><span>{error}</span>{error === t("conflict") ? <button className="button button-secondary button-small" type="button" onClick={() => void load()}>{t("reload")}</button> : null}</div> : null}
          {warnings.length > 0 ? <div className="alert alert-warning field-full"><strong>{t("warningsTitle")}</strong><ul>{warnings.map((warning, index) => <li key={`${warning.type}:${warning.key}:${index}`}>{t(`warnings.${warning.type}`, { key: warning.key, count: warning.selected_member_count })}</li>)}</ul></div> : null}
        </div>
      </section>

      <section className="panel profile-tag-groups-panel">
        <div className="panel-header"><div><h2>{t("groupsTitle")}</h2><p>{t("groupsCopy")}</p></div><button className="button button-primary" type="button" disabled={busy || draft.groups.length >= 60} onClick={() => { setEditorError(""); setGroupEditor({ originalKey: "", group: newGroup((draft.groups.length + 1) * 10) }); }}>{t("addGroup")}</button></div>
        <div className="profile-tag-groups">
          {draft.groups.map((group, groupIndex) => {
            const groupSelected = group.items.reduce((sum, item) => sum + item.selected_member_count, 0);
            return (
              <details className={`profile-tag-group${group.active ? "" : " is-inactive"}`} key={group.key} draggable onDragStart={(event) => { event.stopPropagation(); setDragGroup(group.key); }} onDragEnd={() => setDragGroup("")} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (dragItem) updateDraft(moveTagItem(draft, dragItem.groupKey, dragItem.itemKey, group.key));
                else if (dragGroup) updateDraft(moveTagGroup(draft, draft.groups.findIndex((row) => row.key === dragGroup), groupIndex));
                setDragGroup(""); setDragItem(null);
              }}>
                <summary><span className="drag-handle" aria-hidden="true">⋮⋮</span><span><strong>{localeText(group.labels, locale)}</strong><small><code>{group.key}</code> · {t("itemCount", { count: group.items.length })} · {t("selectedReferences", { count: groupSelected })}</small></span><span className={`badge ${group.active ? "badge-active" : "badge-inactive"}`}>{group.active ? t("active") : t("archived")}</span></summary>
                <div className="profile-tag-group-toolbar"><div className="row-actions"><button className="icon-action" type="button" disabled={busy || groupIndex === 0} onClick={() => updateDraft(moveTagGroup(draft, groupIndex, groupIndex - 1))} aria-label={t("moveGroupUp", { name: localeText(group.labels, locale) })}>↑</button><button className="icon-action" type="button" disabled={busy || groupIndex === draft.groups.length - 1} onClick={() => updateDraft(moveTagGroup(draft, groupIndex, groupIndex + 1))} aria-label={t("moveGroupDown", { name: localeText(group.labels, locale) })}>↓</button><button className="button button-secondary button-small" type="button" onClick={() => { setEditorError(""); setGroupEditor({ originalKey: group.key, group: structuredClone(group) }); }}>{common("edit")}</button></div><button className="button button-secondary button-small" type="button" disabled={busy || itemCount >= 1_000} onClick={() => { setEditorError(""); setItemEditor({ originalKey: "", sourceGroupKey: group.key, targetGroupKey: group.key, item: newItem((group.items.length + 1) * 10) }); }}>{t("addItem")}</button></div>
                {group.items.length === 0 ? <p className="profile-tag-empty-group">{t("emptyGroup")}</p> : <div className="table-wrap"><table className="data-table profile-tag-items"><thead><tr><th>{t("item")}</th><th>{t("audience")}</th><th>{t("selected")}</th><th>{t("status")}</th><th><span className="sr-only">{common("actions")}</span></th></tr></thead><tbody>{group.items.map((item, itemIndex) => <tr key={item.key} className={item.active ? "" : "is-inactive"} draggable onDragStart={(event) => { event.stopPropagation(); setDragItem({ groupKey: group.key, itemKey: item.key }); }} onDragEnd={() => setDragItem(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); if (dragItem) updateDraft(moveTagItem(draft, dragItem.groupKey, dragItem.itemKey, group.key, itemIndex)); setDragItem(null); }}><td><span className="tag-item-identity"><span className="presentation-source-icon">{/* eslint-disable-next-line @next/next/no-img-element */}{item.icon.url ? <img src={item.icon.url} alt="" /> : <b>{item.emoji || localeText(item.labels, locale).slice(0, 1)}</b>}</span><span><strong>{localeText(item.labels, locale)}</strong><small><code>{item.key}</code></small></span></span></td><td>{item.audience.genders.length === 0 && item.audience.segments.length === 0 ? t("globalAudience") : t("restrictedAudience", { genders: item.audience.genders.length, segments: item.audience.segments.length })}</td><td>{item.selected_member_count}</td><td><div className="cell-stack"><span className={`badge ${item.active ? "badge-active" : "badge-inactive"}`}>{item.active ? t("active") : t("archived")}</span><span className={moderationBadgeClass(item)}>{t(`moderationStates.${item.moderation_state ?? "unstated"}`)}</span></div></td><td><div className="row-actions"><button className="icon-action" type="button" disabled={busy || itemIndex === 0} onClick={() => updateDraft(moveTagItem(draft, group.key, item.key, group.key, itemIndex - 1))} aria-label={t("moveItemUp", { name: localeText(item.labels, locale) })}>↑</button><button className="icon-action" type="button" disabled={busy || itemIndex === group.items.length - 1} onClick={() => updateDraft(moveTagItem(draft, group.key, item.key, group.key, itemIndex + 1))} aria-label={t("moveItemDown", { name: localeText(item.labels, locale) })}>↓</button><button className="button button-secondary button-small" type="button" onClick={() => { setEditorError(""); setItemEditor({ originalKey: item.key, sourceGroupKey: group.key, targetGroupKey: group.key, item: structuredClone(item) }); }}>{common("edit")}</button></div></td></tr>)}</tbody></table></div>}
              </details>
            );
          })}
        </div>
      </section>

      <section className="panel profile-tag-preview-panel">
        <div className="panel-header"><div><h2>{t("previewTitle")}</h2><p>{t("previewCopy")}</p></div></div>
        <div className="panel-body">
          {dirty ? <div className="alert alert-warning">{t("previewUnsaved")}</div> : null}
          <div className="profile-tag-preview-controls"><label className="field"><span>{t("language")}</span><select value={previewLanguage} onChange={(event) => setPreviewLanguage(event.target.value)}><option value="en">English</option><option value="hu">Magyar</option></select></label><label className="field"><span>{t("gender")}</span><select value={previewGender} onChange={(event) => setPreviewGender(event.target.value as typeof previewGender)}>{TAG_GENDERS.map((gender) => <option value={gender} key={gender}>{t(`genders.${gender}`)}</option>)}</select></label><label className="field"><span>{t("segment")}</span><select value={previewSegment} onChange={(event) => setPreviewSegment(event.target.value)}>{TAG_SEGMENTS.map((segment) => <option value={segment} key={segment}>{t(`segments.${segment}`)}</option>)}</select></label><button className="button button-secondary" type="button" disabled={previewBusy} onClick={() => void loadPreview()}>{previewBusy ? t("previewing") : t("preview")}</button></div>
          {previewError ? <div className="alert alert-error" role="alert">{previewError}</div> : null}
          {preview ? <div className="profile-tag-preview"><header><h3>{preview.title}</h3><p>{preview.subtitle}</p><small>{t("previewLimit", { min: preview.minimum_selected, max: preview.maximum_selected })}</small></header>{preview.groups.length === 0 ? <p>{t("previewEmpty")}</p> : preview.groups.map((group) => <section key={group.key}><h4>{group.label}</h4><div className="profile-tag-preview-chips">{group.items.map((item) => <span key={item.key}>{/* eslint-disable-next-line @next/next/no-img-element */}{item.icon.url ? <img src={item.icon.url} alt="" /> : item.emoji ? <b>{item.emoji}</b> : null}{item.label}</span>)}</div></section>)}</div> : null}
        </div>
      </section>

      {groupEditor ? <GroupDialog editor={groupEditor} busy={busy} error={editorError} onChange={setGroupEditor} onClose={() => setGroupEditor(null)} onSave={saveGroupEditor} /> : null}
      {itemEditor ? <ItemDialog editor={itemEditor} groups={draft.groups} busy={busy} error={editorError} onChange={setItemEditor} onClose={() => setItemEditor(null)} onSave={saveItemEditor} /> : null}
    </>
  );
}
