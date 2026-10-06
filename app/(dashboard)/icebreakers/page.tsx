"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import MemberAudienceSelector, { type MemberAudienceValue } from "@/components/MemberAudienceSelector";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { icebreakerCatalog, type IcebreakerCatalog, type IcebreakerPrompt } from "@/lib/icebreakers";
import { migrateLegacyAudience } from "@/lib/memberAudience";

type Draft = {
  originalKey: string;
  key: string;
  labels: Record<string, string>;
  labelEn: string;
  labelHu: string;
  audienceMode: "global" | "segments";
  genders: string[];
  groupIds: string[];
  segments: string[];
  sortOrder: number;
  active: boolean;
  revision: number;
};

function localeText(labels: Record<string, string>, locale: string): string {
  return labels[locale] || labels[locale.split("-")[0]] || labels.en || labels.hu || "";
}

function boundedQuestion(value: string): string {
  return Array.from(value).slice(0, 180).join("");
}

function draft(prompt: IcebreakerPrompt | undefined, nextOrder: number, castGroups: IcebreakerCatalog["cast_groups"]): Draft {
  const migratedAudience = migrateLegacyAudience(
    prompt?.audience.group_ids ?? [],
    prompt?.audience.segments ?? [],
    castGroups,
  );
  return {
    originalKey: prompt?.key ?? "",
    key: prompt?.key ?? "",
    labels: prompt?.labels ?? {},
    labelEn: prompt?.labels.en ?? "",
    labelHu: prompt?.labels.hu ?? "",
    audienceMode: prompt?.audience.mode ?? "global",
    genders: prompt?.audience.genders ?? [],
    groupIds: migratedAudience.groupIds,
    segments: migratedAudience.legacySegments,
    sortOrder: prompt?.sort_order ?? nextOrder,
    active: prompt?.active ?? true,
    revision: prompt?.revision ?? 0,
  };
}

function useDialog(onClose: () => void, busy: boolean) {
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  const locked = useRef(busy);
  close.current = onClose;
  locked.current = busy;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const selector = "button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";
    const frame = window.requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(selector)?.focus());
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape" && !locked.current) {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab" || !ref.current) return;
      const nodes = [...ref.current.querySelectorAll<HTMLElement>(selector)].filter((node) => node.getClientRects().length > 0);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return ref;
}

function PromptDialog({
  value,
  catalog,
  busy,
  error,
  onChange,
  onClose,
  onSave,
}: {
  value: Draft;
  catalog: IcebreakerCatalog;
  busy: boolean;
  error: string;
  onChange: (value: Draft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const t = useTranslations("icebreakers");
  const common = useTranslations("common");
  const locale = useLocale();
  const ref = useDialog(onClose, busy);
  const isNew = value.originalKey === "";
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !busy) onClose();
    }}>
      <section ref={ref} tabIndex={-1} className="dialog profile-field-dialog icebreaker-dialog" role="dialog" aria-modal="true" aria-labelledby="icebreaker-dialog-title">
        <div className="dialog-header"><div><h2 id="icebreaker-dialog-title">{isNew ? t("addTitle") : t("editTitle")}</h2><p>{t("dialogCopy")}</p></div><button className="dialog-close" type="button" onClick={onClose} disabled={busy} aria-label={common("close")}>×</button></div>
        <div className="dialog-body form-grid profile-field-form">
          <label className="field field-full"><span>{t("key")}</span><input value={value.key} disabled={!isNew || busy} maxLength={64} spellCheck={false} onChange={(event) => onChange({ ...value, key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} /><small className="field-hint">{t("keyHint")}</small></label>
          <label className="field"><span>{t("questionEn")}</span><textarea value={value.labelEn} disabled={busy} onChange={(event) => onChange({ ...value, labelEn: boundedQuestion(event.target.value) })} /></label>
          <label className="field"><span>{t("questionHu")}</span><textarea value={value.labelHu} disabled={busy} onChange={(event) => onChange({ ...value, labelHu: boundedQuestion(event.target.value) })} /></label>
          <label className="field"><span>{t("order")}</span><input type="number" min="0" max="100000" value={value.sortOrder} disabled={busy} onChange={(event) => onChange({ ...value, sortOrder: Math.max(0, Math.min(100000, Number(event.target.value) || 0)) })} /></label>
          <MemberAudienceSelector
            value={{ mode: value.audienceMode, genders: value.genders, groupIds: value.groupIds, legacySegments: value.segments }}
            groups={catalog.cast_groups}
            legacyOptions={catalog.segments}
            locale={locale}
            disabled={busy}
            labels={{
              legend: t("audience"), help: t("audienceHelp"), global: t("global"), custom: t("castSpecific"),
              globalHint: t("audienceGlobalHint"), genders: t("audienceGenders"), groups: t("audienceGroups"),
              matchAny: t("audienceMatchAny"), groupsRecorded: t("audienceGroupsRecorded"), groupsNotEnforced: t("audienceGroupsNotEnforced"), required: t("audienceRequired"),
              inactive: t("audienceGroupInactive"), legacy: t("audienceLegacy"),
              gender: { male: t("genderMale"), female: t("genderFemale"), other: t("genderOther") },
            }}
            onChange={(audience: MemberAudienceValue) => onChange({
              ...value,
              audienceMode: audience.mode,
              genders: audience.genders,
              groupIds: audience.groupIds,
              segments: audience.legacySegments,
            })}
          />
          <label className="switch-row field-full"><span><strong>{t("active")}</strong><small>{t("activeHint")}</small></span><input type="checkbox" checked={value.active} disabled={busy} onChange={(event) => onChange({ ...value, active: event.target.checked })} /></label>
          {error ? <div className="alert alert-error field-full" role="alert">{error}</div> : null}
        </div>
        <div className="dialog-actions"><button className="button button-secondary" type="button" disabled={busy} onClick={onClose}>{common("cancel")}</button><button className="button button-primary" type="button" disabled={busy} onClick={onSave}>{busy ? common("saving") : common("save")}</button></div>
      </section>
    </div>
  );
}

export default function IcebreakersPage() {
  const t = useTranslations("icebreakers");
  const common = useTranslations("common");
  const locale = useLocale();
  const [catalog, setCatalog] = useState<IcebreakerCatalog | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<Draft | null>(null);
  const [archive, setArchive] = useState<IcebreakerPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const applyCatalog = useCallback((raw: unknown): boolean => {
    const parsed = icebreakerCatalog(raw);
    if (!parsed) return false;
    setCatalog(parsed);
    return true;
  }, []);
  const load = useCallback(async () => {
    const response = await adminCall("list_icebreakers");
    setStatus(response?.success && applyCatalog(response.catalog) ? "ready" : "error");
  }, [applyCatalog]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const prompts = useMemo(() => {
    if (!catalog) return [];
    const needle = query.trim().toLocaleLowerCase();
    return needle === "" ? catalog.prompts : catalog.prompts.filter((prompt) => [prompt.key, ...Object.values(prompt.labels)].some((text) => text.toLocaleLowerCase().includes(needle)));
  }, [catalog, query]);

  async function save() {
    if (!editor) return;
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(editor.key) || !editor.labelEn.trim() || !editor.labelHu.trim() || (editor.audienceMode === "segments" && editor.genders.length === 0 && editor.groupIds.length === 0 && editor.segments.length === 0)) {
      setError(t("validationError")); return;
    }
    setBusy(true); setError("");
    const response = await adminCall("save_icebreaker_prompt", {
      prompt_key: editor.key,
      labels_json: JSON.stringify({ ...editor.labels, en: editor.labelEn.trim(), hu: editor.labelHu.trim() }),
      // T-630 (D-094): every Icebreaker is a friends card; there is no group to choose.
      groups_json: JSON.stringify(["friends"]),
      member_sex: editor.genders.length === 1 && editor.genders[0] === "male" ? "male" : editor.genders.length === 1 && editor.genders[0] === "female" ? "female" : "both",
      audience_mode: editor.audienceMode,
      segments_json: JSON.stringify(editor.audienceMode === "segments" ? editor.segments : []),
      genders_json: JSON.stringify(editor.audienceMode === "segments" ? editor.genders : []),
      group_ids_json: JSON.stringify(editor.audienceMode === "segments" ? editor.groupIds : []),
      sort_order: editor.sortOrder,
      active: editor.active,
      expected_revision: editor.revision,
    });
    setBusy(false);
    if (!response?.success || !applyCatalog(response.catalog)) {
      setError(response?.error === "icebreaker-prompt-conflict" ? t("conflict") : t("saveError")); return;
    }
    setEditor(null); setToast(t("saved"));
  }

  async function confirmArchive() {
    if (!archive) return;
    setBusy(true);
    const response = await adminCall("archive_icebreaker_prompt", { prompt_key: archive.key, expected_revision: archive.revision });
    setBusy(false);
    if (!response?.success || !applyCatalog(response.catalog)) {
      setToast(t("archiveError")); setArchive(null); return;
    }
    setArchive(null); setToast(t("archived"));
  }

  if (status === "loading") return <LoadingPanel />;
  if (status === "error" || !catalog) return <ErrorPanel message={t("loadError")} retry={load} />;

  return <>
    <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />
    {toast ? <div className="alert alert-success page-alert" role="status">{toast}</div> : null}
    <section className="panel"><div className="panel-body profile-fields-toolbar"><label className="field"><span>{t("search")}</span><input type="search" value={query} placeholder={t("searchPlaceholder")} onChange={(event) => setQuery(event.target.value)} /></label><div><p>{t("toolbarCopy", { count: catalog.prompts.length })}</p><button className="button button-primary" type="button" onClick={() => { setError(""); setEditor(draft(undefined, Math.max(0, ...catalog.prompts.map((prompt) => prompt.sort_order)) + 10, catalog.cast_groups)); }}>{t("add")}</button></div></div></section>
    <section className="panel"><div className="table-wrap"><table className="data-table icebreaker-table"><thead><tr><th>{t("question")}</th><th>{t("audience")}</th><th>{t("order")}</th><th>{t("status")}</th><th><span className="sr-only">{common("actions")}</span></th></tr></thead><tbody>{prompts.map((prompt) => <tr key={prompt.key} className={prompt.active ? "" : "is-inactive"}><td><strong>{localeText(prompt.labels, locale)}</strong><code>{prompt.key}</code></td><td>{prompt.audience.mode === "global" ? t("global") : t("castCount", { count: prompt.audience.genders.length + prompt.audience.group_ids.length + prompt.audience.segments.length })}</td><td>{prompt.sort_order}</td><td><span className={`badge ${prompt.active ? "badge-active" : "badge-inactive"}`}>{prompt.active ? t("active") : t("inactive")}</span></td><td><div className="row-actions"><button className="button button-secondary button-small" type="button" onClick={() => { setError(""); setEditor(draft(prompt, 10, catalog.cast_groups)); }}>{common("edit")}</button>{prompt.active ? <button className="button button-danger button-small" type="button" onClick={() => setArchive(prompt)}>{t("archive")}</button> : null}</div></td></tr>)}{prompts.length === 0 ? <tr><td colSpan={5} className="signup-options-empty">{t("noMatches")}</td></tr> : null}</tbody></table></div></section>
    {editor ? <PromptDialog value={editor} catalog={catalog} busy={busy} error={error} onChange={setEditor} onClose={() => { if (!busy) setEditor(null); }} onSave={() => void save()} /> : null}
    {archive ? <ConfirmDialog title={t("archiveTitle")} copy={t("archiveCopy", { question: localeText(archive.labels, locale) })} confirmLabel={t("archive")} busy={busy} onCancel={() => { if (!busy) setArchive(null); }} onConfirm={() => void confirmArchive()} /> : null}
  </>;
}
