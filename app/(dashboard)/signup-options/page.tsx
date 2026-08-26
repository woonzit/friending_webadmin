"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import MemberAudienceSelector, { type MemberAudienceValue } from "@/components/MemberAudienceSelector";
import PageHeader from "@/components/PageHeader";
import ProfileIconUploadField from "@/components/ProfileIconUploadField";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { isDisclosureOnlyOrientation } from "@/lib/orientationIntegrity";
import { migrateLegacyAudience } from "@/lib/memberAudience";
import {
  type CastGroupSegment,
  type UserCastGroup,
  userCastGroupsPayload,
} from "@/lib/userCastGroups";

type SignupOption = {
  key: string;
  name_en: string;
  name_hu: string;
  sort_order: number;
  active: boolean;
  is_custom: boolean;
  system_owned: boolean;
  audiences?: string[];
};

type SignupGroupAudience = {
  mode: "global" | "groups";
  genders: string[];
  group_ids: string[];
  segments: string[];
};

type SignupOptionGroup = {
  key: string;
  name_en: string;
  name_hu: string;
  system_owned: boolean;
  required: boolean;
  custom_allowed: boolean;
  extensible_system: boolean;
  profile_field: string;
  question_pack: string;
  revision: number;
  icon: { url: string; mime: string };
  audience: SignupGroupAudience;
  options: SignupOption[];
};

type SignupCatalog = {
  schema_version: number;
  cast_groups: UserCastGroup[];
  segments: CastGroupSegment[];
  groups: SignupOptionGroup[];
};

type OptionDraft = SignupOption & {
  group_key: string;
  is_new: boolean;
  audiences: string[];
};

type GroupDraft = {
  group_key: string;
  name_en: string;
  name_hu: string;
  icon_url: string;
  icon_mime: string;
  audience: MemberAudienceValue;
  expected_revision: number;
};

type GroupFilter = "all" | "system" | "optional" | "targeted";
const AUDIENCE_GENDERS = ["male", "female", "other"] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return null;
  return [...new Set(value as string[])];
}

function parseCatalog(raw: unknown): SignupCatalog | null {
  const catalog = record(raw);
  if (!catalog || !Array.isArray(catalog.groups)) return null;
  const castPayload = userCastGroupsPayload({
    groups: catalog.cast_groups,
    segments: catalog.segments,
  });
  if (!castPayload) return null;
  const groups: SignupOptionGroup[] = [];
  for (const value of catalog.groups) {
    const group = record(value);
    const icon = record(group?.icon);
    const audience = record(group?.audience);
    const genders = stringList(audience?.genders);
    const groupIds = stringList(audience?.group_ids);
    const segments = stringList(audience?.segments);
    if (
      !group
      || typeof group.key !== "string"
      || typeof group.name_en !== "string"
      || typeof group.name_hu !== "string"
      || typeof group.system_owned !== "boolean"
      || typeof group.required !== "boolean"
      || typeof group.custom_allowed !== "boolean"
      || typeof group.profile_field !== "string"
      || typeof group.question_pack !== "string"
      || !Number.isInteger(group.revision)
      || !icon
      || typeof icon.url !== "string"
      || typeof icon.mime !== "string"
      || !audience
      || (audience.mode !== "global" && audience.mode !== "groups")
      || !genders
      || !groupIds
      || !segments
      || !Array.isArray(group.options)
    ) return null;
    const options: SignupOption[] = [];
    for (const optionValue of group.options) {
      const option = record(optionValue);
      if (
        !option
        || typeof option.key !== "string"
        || typeof option.name_en !== "string"
        || typeof option.name_hu !== "string"
        || typeof option.sort_order !== "number"
        || typeof option.active !== "boolean"
        || typeof option.is_custom !== "boolean"
        || typeof option.system_owned !== "boolean"
        || (option.audiences !== undefined && !stringList(option.audiences))
        || (group.key === "orientation" && isDisclosureOnlyOrientation(option.key))
      ) return null;
      options.push({
        key: option.key,
        name_en: option.name_en,
        name_hu: option.name_hu,
        sort_order: option.sort_order,
        active: option.active,
        is_custom: option.is_custom,
        system_owned: option.system_owned,
        ...(option.audiences ? { audiences: option.audiences as string[] } : {}),
      });
    }
    groups.push({
      key: group.key,
      name_en: group.name_en,
      name_hu: group.name_hu,
      system_owned: group.system_owned,
      required: group.required,
      custom_allowed: group.custom_allowed,
      extensible_system: group.extensible_system === true,
      profile_field: group.profile_field,
      question_pack: group.question_pack,
      revision: Number(group.revision),
      icon: { url: icon.url, mime: icon.mime },
      audience: {
        mode: audience.mode,
        genders,
        group_ids: groupIds,
        segments,
      },
      options,
    });
  }
  return {
    schema_version: typeof catalog.schema_version === "number" ? catalog.schema_version : 1,
    cast_groups: castPayload.groups,
    segments: castPayload.segments,
    groups,
  };
}

function groupDraft(group: SignupOptionGroup, castGroups: UserCastGroup[]): GroupDraft {
  const migrated = migrateLegacyAudience(
    group.audience.group_ids,
    group.audience.segments,
    castGroups,
  );
  return {
    group_key: group.key,
    name_en: group.name_en,
    name_hu: group.name_hu,
    icon_url: group.icon.url,
    icon_mime: group.icon.mime,
    audience: {
      mode: group.audience.mode === "groups" ? "segments" : "global",
      genders: group.audience.genders,
      groupIds: migrated.groupIds,
      legacySegments: migrated.legacySegments,
    },
    expected_revision: group.revision,
  };
}

function OptionDialog({
  draft,
  group,
  busy,
  error,
  onChange,
  onClose,
  onSave,
}: {
  draft: OptionDraft;
  group: SignupOptionGroup;
  busy: boolean;
  error: string;
  onChange: (next: OptionDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const t = useTranslations("signupOptions");
  const common = useTranslations("common");
  const lockedMetadata = group.system_owned && !draft.is_custom;
  const showAudiences = group.extensible_system && draft.is_custom;

  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", keyDown);
    return () => document.removeEventListener("keydown", keyDown);
  }, [busy, onClose]);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="signup-option-dialog-title">
        <div className="dialog-header">
          <div><h2 id="signup-option-dialog-title">{draft.is_new ? t("addTitle") : t("editTitle")}</h2><p>{group.name_en} · {group.name_hu}</p></div>
          <button className="dialog-close" type="button" onClick={onClose} disabled={busy} aria-label={common("close")}>×</button>
        </div>
        <div className="dialog-body form-grid">
          {lockedMetadata && <div className="system-option-notice field-full" role="note"><strong>{t("systemAnswer")}</strong><span>{t("systemAnswerCopy")}</span></div>}
          {group.key === "orientation" && <div className="system-option-notice field-full" role="note"><strong>{t("matchingOrientationTitle")}</strong><span>{t("matchingOrientationCopy")}</span></div>}
          <label className="field field-full">
            <span>{t("key")}</span>
            <input value={draft.key} autoFocus={draft.is_new} disabled={!draft.is_new || lockedMetadata || busy} maxLength={64} spellCheck={false} onChange={(event) => onChange({ ...draft, key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} />
            <small className="field-hint">{t("keyHint")}</small>
          </label>
          <label className="field"><span>{t("nameEn")}</span><input value={draft.name_en} maxLength={80} disabled={busy} autoFocus={!draft.is_new} onChange={(event) => onChange({ ...draft, name_en: event.target.value })} /></label>
          <label className="field"><span>{t("nameHu")}</span><input value={draft.name_hu} maxLength={80} disabled={busy} onChange={(event) => onChange({ ...draft, name_hu: event.target.value })} /></label>
          <label className="field"><span>{t("sortOrder")}</span><input type="number" min="0" max="100000" value={draft.sort_order} disabled={lockedMetadata || busy} onChange={(event) => onChange({ ...draft, sort_order: Math.max(0, Math.min(100000, Number(event.target.value) || 0)) })} /></label>
          <label className="checkbox-field signup-option-active-field"><input type="checkbox" checked={draft.active} disabled={lockedMetadata || busy} onChange={(event) => onChange({ ...draft, active: event.target.checked })} /><span>{t("active")}</span></label>
          {showAudiences && (
            <fieldset className="field field-full profile-audience-fieldset">
              <legend>{t("audiences")}</legend><p className="field-hint">{t("audiencesHint")}</p>
              <div className="profile-field-radio-row">
                {AUDIENCE_GENDERS.map((gender) => <label key={gender}><input type="checkbox" checked={draft.audiences.includes(gender)} disabled={busy} onChange={(event) => onChange({ ...draft, audiences: event.target.checked ? [...draft.audiences, gender] : draft.audiences.filter((value) => value !== gender) })} /><span>{gender === "male" ? t("genderMale") : gender === "female" ? t("genderFemale") : t("genderOther")}</span></label>)}
              </div>
            </fieldset>
          )}
          {error && <div className="alert alert-error field-full" role="alert">{error}</div>}
        </div>
        <div className="dialog-actions"><button className="button button-secondary" type="button" onClick={onClose} disabled={busy}>{common("cancel")}</button><button className="button button-primary" type="button" onClick={onSave} disabled={busy}>{busy ? common("saving") : common("save")}</button></div>
      </section>
    </div>
  );
}

function GroupDialog({
  draft,
  group,
  catalog,
  busy,
  error,
  onChange,
  onClose,
  onSave,
}: {
  draft: GroupDraft;
  group: SignupOptionGroup;
  catalog: SignupCatalog;
  busy: boolean;
  error: string;
  onChange: (next: GroupDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const t = useTranslations("signupOptions");
  const common = useTranslations("common");
  const locale = useLocale();
  const [uploading, setUploading] = useState(false);
  const blocked = busy || uploading;

  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !blocked) onClose();
    }
    document.addEventListener("keydown", keyDown);
    return () => document.removeEventListener("keydown", keyDown);
  }, [blocked, onClose]);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !blocked) onClose();
    }}>
      <section className="dialog signup-group-dialog" role="dialog" aria-modal="true" aria-labelledby="signup-group-dialog-title">
        <div className="dialog-header">
          <div><h2 id="signup-group-dialog-title">{t("groupEditTitle")}</h2><p><code>{group.key}</code> · {t("pack")}: {group.question_pack}</p></div>
          <button className="dialog-close" type="button" onClick={onClose} disabled={blocked} aria-label={common("close")}>×</button>
        </div>
        <div className="dialog-body form-grid signup-group-form">
          <label className="field"><span>{t("groupNameEn")}</span><input autoFocus value={draft.name_en} maxLength={80} disabled={blocked} onChange={(event) => onChange({ ...draft, name_en: event.target.value })} /></label>
          <label className="field"><span>{t("groupNameHu")}</span><input value={draft.name_hu} maxLength={80} disabled={blocked} onChange={(event) => onChange({ ...draft, name_hu: event.target.value })} /></label>
          <div className="field-full">
            <ProfileIconUploadField label={t("groupIcon")} hint={t("groupIconHint")} chooseLabel={t("iconChoose")} removeLabel={t("iconRemove")} uploadingLabel={t("iconUploading")} errorLabel={t("iconError")} value={draft.icon_url} disabled={busy} onBusyChange={setUploading} onChange={(icon) => onChange({ ...draft, icon_url: icon.url, icon_mime: icon.mime })} />
          </div>
          {group.system_owned ? (
            <div className="system-option-notice field-full" role="note">
              <strong>{group.required ? t("requiredSystemQuestion") : t("systemQuestion")}</strong>
              <span>{group.required ? t("requiredSystemQuestionCopy") : t("systemQuestionCopy")}</span>
            </div>
          ) : (
            <MemberAudienceSelector
              value={draft.audience}
              groups={catalog.cast_groups}
              legacyOptions={catalog.segments}
              locale={locale}
              disabled={blocked}
              labels={{
                legend: t("groupAudience"), help: t("groupAudienceHelp"), global: t("audienceGlobal"), custom: t("audienceSpecific"),
                globalHint: t("audienceGlobalHint"), genders: t("audienceGendersTitle"), groups: t("audienceGroupsTitle"),
                matchAny: t("audienceMatchAny"), matchBoth: t("audienceMatchBoth"), required: t("audienceRequired"),
                inactive: t("audienceInactive"), legacy: t("audienceLegacy"),
                gender: { male: t("genderMen"), female: t("genderWomen"), other: t("genderNonbinary") },
              }}
              onChange={(audience) => onChange({ ...draft, audience })}
            />
          )}
          {error && <div className="alert alert-error field-full" role="alert">{error}</div>}
        </div>
        <div className="dialog-actions"><button className="button button-secondary" type="button" onClick={onClose} disabled={blocked}>{common("cancel")}</button><button className="button button-primary" type="button" onClick={onSave} disabled={blocked}>{busy ? common("saving") : common("save")}</button></div>
      </section>
    </div>
  );
}

export default function SignupOptionsPage() {
  const t = useTranslations("signupOptions");
  const common = useTranslations("common");
  const [catalog, setCatalog] = useState<SignupCatalog | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<GroupFilter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [optionDraft, setOptionDraft] = useState<OptionDraft | null>(null);
  const [editingGroup, setEditingGroup] = useState<GroupDraft | null>(null);
  const [deleting, setDeleting] = useState<{ group: SignupOptionGroup; option: SignupOption } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setState((current) => current === "ready" ? current : "loading");
    const response = await adminCall("list_signup_options");
    const parsed = response?.success ? parseCatalog(response.catalog) : null;
    if (!parsed) { setState("error"); return; }
    setCatalog(parsed);
    setState("ready");
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const groups = useMemo(() => {
    if (!catalog) return [];
    const needle = query.trim().toLocaleLowerCase();
    return catalog.groups.filter((group) => {
      if (filter === "system" && !group.system_owned) return false;
      if (filter === "optional" && group.system_owned) return false;
      if (filter === "targeted" && group.audience.mode !== "groups") return false;
      if (!needle) return true;
      return [group.key, group.name_en, group.name_hu, ...group.options.flatMap((option) => [option.key, option.name_en, option.name_hu])]
        .some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [catalog, filter, query]);

  function applyCatalog(raw: unknown): boolean {
    const parsed = parseCatalog(raw);
    if (!parsed) return false;
    setCatalog(parsed);
    return true;
  }

  async function saveOption() {
    if (!optionDraft || !catalog) return;
    const key = optionDraft.key.trim();
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) { setFormError(t("keyInvalid")); return; }
    if (!optionDraft.name_en.trim() || !optionDraft.name_hu.trim()) { setFormError(t("namesRequired")); return; }
    if (optionDraft.group_key === "orientation" && isDisclosureOnlyOrientation(key)) {
      setFormError(t("orientationDisclosureForbidden"));
      return;
    }
    const group = catalog.groups.find((row) => row.key === optionDraft.group_key);
    if (group?.extensible_system && optionDraft.is_custom && optionDraft.audiences.length === 0) { setFormError(t("audiencesRequired")); return; }
    setBusy(true); setFormError("");
    const response = await adminCall("save_signup_option", {
      group_key: optionDraft.group_key, option_key: key, name_en: optionDraft.name_en.trim(), name_hu: optionDraft.name_hu.trim(), sort_order: optionDraft.sort_order, active: optionDraft.active,
      ...(group?.extensible_system && optionDraft.is_custom ? { audiences_json: JSON.stringify(optionDraft.audiences) } : {}),
    });
    setBusy(false);
    if (!response?.success || !applyCatalog(response.catalog)) {
      setFormError(
        response?.error === "signup-option-system-protected"
          ? t("systemProtected")
          : response?.error === "signup-option-orientation-disclosure-forbidden"
            ? t("orientationDisclosureForbidden")
            : t("saveError"),
      );
      return;
    }
    setOptionDraft(null); setToast(t("saved"));
  }

  async function saveGroup() {
    if (!editingGroup) return;
    if (!editingGroup.name_en.trim() || !editingGroup.name_hu.trim()) { setFormError(t("namesRequired")); return; }
    if (editingGroup.audience.mode === "segments" && editingGroup.audience.genders.length === 0 && editingGroup.audience.groupIds.length === 0 && editingGroup.audience.legacySegments.length === 0) { setFormError(t("audienceRequired")); return; }
    setBusy(true); setFormError("");
    const response = await adminCall("save_signup_option_group", {
      group_key: editingGroup.group_key,
      name_en: editingGroup.name_en.trim(),
      name_hu: editingGroup.name_hu.trim(),
      icon_url: editingGroup.icon_url,
      icon_mime: editingGroup.icon_mime,
      audience_mode: editingGroup.audience.mode === "segments" ? "groups" : "global",
      genders_json: JSON.stringify(editingGroup.audience.genders),
      group_ids_json: JSON.stringify(editingGroup.audience.groupIds),
      segments_json: JSON.stringify(editingGroup.audience.legacySegments),
      expected_revision: editingGroup.expected_revision,
    });
    setBusy(false);
    if (!response?.success || !applyCatalog(response.catalog)) {
      if (response?.error === "signup-option-group-conflict") void load();
      setFormError(response?.error === "signup-option-group-conflict" ? t("groupConflict") : t("groupSaveError"));
      return;
    }
    setEditingGroup(null); setToast(t("groupSaved"));
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    const response = await adminCall("delete_signup_option", { group_key: deleting.group.key, option_key: deleting.option.key });
    setBusy(false);
    if (!response?.success || !applyCatalog(response.catalog)) { setDeleting(null); setToast(t("deleteError")); return; }
    setDeleting(null); setToast(t("deleted"));
  }

  function toggleGroup(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  if (state === "loading") return <LoadingPanel />;
  if (state === "error" || !catalog) return <ErrorPanel message={t("loadError")} retry={load} />;
  const activeOptions = catalog.groups.reduce((total, group) => total + group.options.filter((option) => option.active).length, 0);
  const selectedOptionGroup = optionDraft ? catalog.groups.find((group) => group.key === optionDraft.group_key) ?? null : null;
  const selectedGroup = editingGroup ? catalog.groups.find((group) => group.key === editingGroup.group_key) ?? null : null;

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />
      {toast && <div className="alert alert-success page-alert" role="status">{toast}</div>}
      <section className="signup-options-overview" aria-label={t("overviewLabel")}>
        <div><strong>{catalog.groups.length}</strong><span>{t("questionGroups")}</span></div>
        <div><strong>{catalog.groups.filter((group) => group.required).length}</strong><span>{t("requiredQuestions")}</span></div>
        <div><strong>{catalog.groups.filter((group) => group.audience.mode === "groups").length}</strong><span>{t("targetedQuestions")}</span></div>
        <div><strong>{activeOptions}</strong><span>{t("activeAnswers")}</span></div>
      </section>
      <section className="panel signup-options-intro">
        <div className="panel-body signup-options-toolbar">
          <label className="field"><span>{t("search")}</span><input type="search" value={query} placeholder={t("searchPlaceholder")} onChange={(event) => setQuery(event.target.value)} /></label>
          <label className="field"><span>{t("groupFilter")}</span><select value={filter} onChange={(event) => setFilter(event.target.value as GroupFilter)}><option value="all">{t("filterAll")}</option><option value="system">{t("filterSystem")}</option><option value="optional">{t("filterOptional")}</option><option value="targeted">{t("filterTargeted")}</option></select></label>
          <div className="system-option-notice"><strong>{t("systemAnswersTitle")}</strong><span>{t("systemAnswersIntro")}</span></div>
          <div className="system-option-notice"><strong>{t("matchingOrientationTitle")}</strong><span>{t("matchingOrientationCopy")}</span></div>
        </div>
      </section>
      <div className="signup-option-groups">
        {groups.map((group) => {
          const open = query.trim() !== "" || expanded.has(group.key);
          const enabled = group.options.filter((option) => option.active).length;
          return (
            <section className={`panel signup-option-group${open ? " is-open" : ""}`} key={group.key}>
              <div className="signup-option-card-header">
                <button className="signup-option-card-toggle" type="button" aria-expanded={open} onClick={() => toggleGroup(group.key)}>
                  <span className="signup-option-group-icon" aria-hidden="true">{group.icon.url ? <img src={group.icon.url} alt="" /> : <b>{group.name_en.slice(0, 1).toUpperCase()}</b>}</span>
                  <span className="signup-option-card-copy"><span className="signup-option-title-line"><strong>{group.name_en}</strong><small>{group.name_hu}</small></span><span><code>{group.key}</code> · {t("answerCount", { active: enabled, total: group.options.length })}</span></span>
                  <span className="signup-option-card-badges">
                    {group.system_owned && <span className="badge badge-warning">{t("system")}</span>}
                    <span className={`badge ${group.required ? "badge-active" : "badge-inactive"}`}>{group.required ? t("required") : t("optional")}</span>
                    <span className={`badge ${group.audience.mode === "groups" ? "badge-info" : "badge-inactive"}`}>{group.audience.mode === "groups" ? t("targeted") : t("everyone")}</span>
                    <span className="signup-option-chevron" aria-hidden="true">⌄</span>
                  </span>
                </button>
                <div className="signup-option-card-actions">
                  <button className="button button-secondary button-small" type="button" onClick={() => { setFormError(""); setEditingGroup(groupDraft(group, catalog.cast_groups)); }}>{t("groupSettings")}</button>
                  {(group.custom_allowed || group.extensible_system) && <button className="button button-primary button-small" type="button" onClick={() => { const lastOrder = Math.max(0, ...group.options.map((option) => option.sort_order)); setFormError(""); setOptionDraft({ group_key: group.key, key: "", name_en: "", name_hu: "", sort_order: lastOrder + 10, active: true, is_custom: true, system_owned: false, is_new: true, audiences: [...AUDIENCE_GENDERS] }); }}>{t("add")}</button>}
                </div>
              </div>
              {open && (
                <div className="table-wrap signup-options-table-wrap">
                  <table className="data-table signup-options-table">
                    <thead><tr><th>{t("key")}</th><th>{t("nameEn")}</th><th>{t("nameHu")}</th><th>{t("order")}</th><th>{t("status")}</th><th><span className="sr-only">{common("actions")}</span></th></tr></thead>
                    <tbody>
                      {group.options.map((option) => <tr key={option.key} className={!option.active ? "signup-option-inactive" : ""}><td><code>{option.key}</code></td><td>{option.name_en}</td><td>{option.name_hu}</td><td>{group.system_owned && !option.is_custom ? "—" : option.sort_order}</td><td><span className={`badge ${option.active ? "badge-active" : "badge-inactive"}`}>{option.active ? t("active") : t("inactive")}</span></td><td><div className="row-actions"><button className="button button-secondary button-small" type="button" onClick={() => { setFormError(""); setOptionDraft({ ...option, group_key: group.key, is_new: false, audiences: option.audiences ?? [...AUDIENCE_GENDERS] }); }}>{group.system_owned && !option.is_custom ? t("rename") : common("edit")}</button>{(!group.system_owned || (group.extensible_system && option.is_custom)) && option.active && <button className="button button-danger button-small" type="button" onClick={() => setDeleting({ group, option })}>{common("delete")}</button>}</div></td></tr>)}
                      {group.options.length === 0 && <tr><td colSpan={6} className="signup-options-empty">{t("noAnswers")}</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>
      {groups.length === 0 && <div className="panel"><div className="empty-state"><p>{t("noMatches")}</p></div></div>}
      {optionDraft && selectedOptionGroup && <OptionDialog draft={optionDraft} group={selectedOptionGroup} busy={busy} error={formError} onChange={setOptionDraft} onClose={() => { if (!busy) setOptionDraft(null); }} onSave={() => void saveOption()} />}
      {editingGroup && selectedGroup && <GroupDialog draft={editingGroup} group={selectedGroup} catalog={catalog} busy={busy} error={formError} onChange={setEditingGroup} onClose={() => { if (!busy) setEditingGroup(null); }} onSave={() => void saveGroup()} />}
      {deleting && <ConfirmDialog busyLabel={common("deleting")} title={t("deleteTitle")} copy={t("deleteCopy", { name: deleting.option.name_en })} confirmLabel={common("delete")} busy={busy} onCancel={() => { if (!busy) setDeleting(null); }} onConfirm={() => void remove()} />}
    </>
  );
}
