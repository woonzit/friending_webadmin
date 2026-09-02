"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import PageHeader from "@/components/PageHeader";
import ProfileIconUploadField from "@/components/ProfileIconUploadField";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import {
  movePresentationSource,
  normalizeManagedIcon,
  parsePresentationAdminPayload,
  parsePresentationRefusal,
  serializePresentationLayout,
  sourceIdentity,
  type PresentationAdminPayload,
  type PresentationBuiltinSource,
  type PresentationLayout,
  type PresentationSource,
  type PresentationSourceIssue,
  type PresentationSourceRef,
} from "@/lib/profilePresentation";

type Destination = "highlight_cloud" | "more_about_me" | "unused";

function localeText(labels: Record<string, string>, locale: string): string {
  return labels[locale] || labels[locale.split("-")[0]] || labels.en || labels.hu || "";
}

function sourceSample(source: PresentationSource, locale: string): string {
  if (source.kind === "field") {
    return localeText(source.sample_values, locale) || localeText(source.labels, locale);
  }
  return localeText(source.labels, locale);
}

function sameLayout(left: PresentationLayout, right: PresentationLayout): boolean {
  return JSON.stringify({ h: left.highlight_cloud, m: left.more_about_me })
    === JSON.stringify({ h: right.highlight_cloud, m: right.more_about_me });
}

function BuiltinSourceDialog({
  source,
  busy,
  error,
  onChange,
  onClose,
  onSave,
}: {
  source: PresentationBuiltinSource;
  busy: boolean;
  error: string;
  onChange: (source: PresentationBuiltinSource) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const t = useTranslations("profilePresentation");
  const common = useTranslations("common");
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !busy) onClose();
    }}>
      <section className="dialog profile-presentation-source-dialog" role="dialog" aria-modal="true" aria-labelledby="presentation-source-title">
        <div className="dialog-header">
          <div><h2 id="presentation-source-title">{t("sourceEditorTitle")}</h2><p>{t("sourceEditorCopy")}</p></div>
          <button className="dialog-close" type="button" onClick={onClose} disabled={busy} aria-label={common("close")}>×</button>
        </div>
        <div className="dialog-body form-grid">
          <label className="field field-full"><span>{t("stableKey")}</span><input value={source.key} disabled /></label>
          <label className="field"><span>{t("labelEn")}</span><input maxLength={100} disabled={busy} value={source.labels.en ?? ""} onChange={(event) => onChange({ ...source, labels: { ...source.labels, en: event.target.value } })} /></label>
          <label className="field"><span>{t("labelHu")}</span><input maxLength={100} disabled={busy} value={source.labels.hu ?? ""} onChange={(event) => onChange({ ...source, labels: { ...source.labels, hu: event.target.value } })} /></label>
          <div className="field-full">
            <ProfileIconUploadField
              label={t("icon")}
              hint={t("iconHint")}
              chooseLabel={t("chooseIcon")}
              removeLabel={t("removeIcon")}
              uploadingLabel={t("uploadingIcon")}
              errorLabel={t("iconError")}
              value={source.icon.url}
              disabled={busy}
              onChange={(icon) => {
                const normalized = normalizeManagedIcon(icon);
                if (normalized) onChange({ ...source, icon: normalized });
              }}
            />
          </div>
          {error ? <div className="alert alert-error field-full" role="alert">{error}</div> : null}
        </div>
        <div className="dialog-actions"><button className="button button-secondary" type="button" disabled={busy} onClick={onClose}>{common("cancel")}</button><button className="button button-primary" type="button" disabled={busy} onClick={onSave}>{busy ? common("saving") : common("save")}</button></div>
      </section>
    </div>
  );
}

export default function ProfilePresentationPage() {
  const t = useTranslations("profilePresentation");
  const common = useTranslations("common");
  const locale = useLocale();
  const [payload, setPayload] = useState<PresentationAdminPayload | null>(null);
  const [baseline, setBaseline] = useState<PresentationLayout | null>(null);
  const [draft, setDraft] = useState<PresentationLayout | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Two different lists, never merged: what the server healed away, and what it
  // refused. A single banner for both is what T-663 replaced.
  const [dropped, setDropped] = useState<PresentationSourceIssue[]>([]);
  const [refused, setRefused] = useState<PresentationSourceIssue[]>([]);
  const [toast, setToast] = useState("");
  const [dragged, setDragged] = useState<PresentationSourceRef | null>(null);
  const [accent, setAccent] = useState<"male" | "female" | "neutral">("neutral");
  const [sourceEditor, setSourceEditor] = useState<PresentationBuiltinSource | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [sourceError, setSourceError] = useState("");

  const applyPayload = useCallback((raw: unknown, preserveDraft = false): boolean => {
    const parsed = parsePresentationAdminPayload(raw);
    if (!parsed) return false;
    setPayload(parsed);
    setBaseline(parsed.layout);
    if (!preserveDraft) {
      setDraft(parsed.layout);
      setDropped(parsed.layout.dropped_sources);
    }
    return true;
  }, []);

  const load = useCallback(async () => {
    setStatus("loading");
    const response = await adminCall("profile_presentation");
    if (!response?.success || !applyPayload(response.data)) {
      setStatus("error");
      return;
    }
    setError("");
    setRefused([]);
    setStatus("ready");
  }, [applyPayload]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const allSources = useMemo<PresentationSource[]>(() => payload
    ? [...payload.sources.fields, ...payload.sources.builtins]
    : [], [payload]);
  const sourceMap = useMemo(() => new Map(allSources.map((source) => [sourceIdentity(source), source])), [allSources]);
  const placed = useMemo(() => new Set(draft
    ? [...draft.highlight_cloud, ...draft.more_about_me].map(sourceIdentity)
    : []), [draft]);
  const unused = useMemo(() => allSources.filter((source) => !placed.has(sourceIdentity(source))), [allSources, placed]);
  const dirty = Boolean(baseline && draft && !sameLayout(baseline, draft));

  function isAssignable(source: PresentationSource): boolean {
    if (!payload) return false;
    if (source.kind === "builtin") return source.layout_allowed && !payload.reserved.builtins.includes(source.key);
    return source.layout_allowed && !payload.reserved.fields.includes(source.key);
  }

  function move(source: PresentationSourceRef, destination: Destination, index?: number) {
    if (!draft) return;
    const definition = sourceMap.get(sourceIdentity(source));
    if (!definition || (destination !== "unused" && !isAssignable(definition))) return;
    setDraft(movePresentationSource(draft, source, destination, index));
    setError("");
    setRefused([]);
  }

  /**
   * Core's machine reason, in the operator's language. An unknown one is shown
   * verbatim rather than hidden behind a generic sentence — the point of the
   * per-item list is that the operator can act on it.
   */
  function issueReason(reason: string): string {
    const known: Record<string, string> = {
      "profile-presentation-source-not-found": t("reasons.notFound"),
      "profile-presentation-source-private": t("reasons.private"),
      "profile-presentation-source-reserved": t("reasons.reserved"),
      "profile-presentation-source-duplicate": t("reasons.duplicate"),
      "profile-presentation-source-invalid": t("reasons.invalid"),
    };
    return known[reason] ?? reason;
  }

  function drop(destination: Destination, index?: number) {
    if (dragged) move(dragged, destination, index);
    setDragged(null);
  }

  function placementCard(sourceRef: PresentationSourceRef, destination: Exclude<Destination, "unused">, index: number, count: number) {
    const source = sourceMap.get(sourceIdentity(sourceRef));
    if (!source) return null;
    return (
      <li
        className="presentation-source-card"
        key={sourceIdentity(source)}
        draggable
        onDragStart={() => setDragged(source)}
        onDragEnd={() => setDragged(null)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); event.stopPropagation(); drop(destination, index); }}
      >
        <span className="drag-handle" aria-hidden="true">⋮⋮</span>
        <span className="presentation-source-icon">{/* eslint-disable-next-line @next/next/no-img-element */}{source.icon.url ? <img src={source.icon.url} alt="" /> : <b>{localeText(source.labels, locale).slice(0, 1)}</b>}</span>
        <span className="presentation-source-copy"><strong>{localeText(source.labels, locale)}</strong><small><code>{source.kind}:{source.key}</code> · {sourceSample(source, locale)}</small></span>
        <span className="presentation-source-actions">
          <button className="icon-action" type="button" disabled={busy || index === 0} onClick={() => move(source, destination, index - 1)} aria-label={t("moveUp", { name: localeText(source.labels, locale) })}>↑</button>
          <button className="icon-action" type="button" disabled={busy || index === count - 1} onClick={() => move(source, destination, index + 1)} aria-label={t("moveDown", { name: localeText(source.labels, locale) })}>↓</button>
          <button className="text-button danger-text" type="button" disabled={busy} onClick={() => move(source, "unused")}>{t("remove")}</button>
        </span>
      </li>
    );
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError("");
    setRefused([]);
    const response = await adminCall("save_profile_presentation", serializePresentationLayout(draft));
    setBusy(false);
    if (!response?.success) {
      // A refusal now names the offending rows. The draft is kept either way,
      // so the operator fixes the named row instead of losing the layout.
      const items = parsePresentationRefusal(response);
      setRefused(items);
      setError(response?.error === "profile-presentation-conflict"
        ? t("conflict")
        : items.length > 0 ? t("refusedIntro") : t("saveError"));
      return;
    }
    if (!applyPayload(response.data)) {
      setError(t("invalidResponse"));
      return;
    }
    setToast(t("saved"));
  }

  async function saveSource() {
    if (!sourceEditor) return;
    if (!sourceEditor.labels.en?.trim() || !sourceEditor.labels.hu?.trim()) {
      setSourceError(t("sourceValidation"));
      return;
    }
    setSourceBusy(true);
    setSourceError("");
    const response = await adminCall("save_profile_presentation_source", {
      source_key: sourceEditor.key,
      expected_revision: sourceEditor.revision,
      labels: { ...sourceEditor.labels, en: sourceEditor.labels.en.trim(), hu: sourceEditor.labels.hu.trim() },
      icon_url: sourceEditor.icon.url,
      icon_mime: sourceEditor.icon.mime,
    });
    setSourceBusy(false);
    if (!response?.success) {
      setSourceError(response?.error === "profile-presentation-source-conflict" ? t("sourceConflict") : t("sourceSaveError"));
      return;
    }
    if (!applyPayload(response.data, true)) {
      setSourceError(t("invalidResponse"));
      return;
    }
    setSourceEditor(null);
    setToast(t("sourceSaved"));
  }

  if (status === "loading") return <LoadingPanel />;
  if (status === "error" || !payload || !draft || !baseline) return <ErrorPanel message={t("loadError")} retry={load} />;

  const previewChip = draft.highlight_cloud[0] ? sourceMap.get(sourceIdentity(draft.highlight_cloud[0])) : undefined;
  const previewRow = draft.more_about_me[0] ? sourceMap.get(sourceIdentity(draft.more_about_me[0])) : undefined;

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />
      {toast ? <div className="alert alert-success page-alert" role="status">{toast}</div> : null}
      <section className="panel presentation-toolbar-panel">
        <div className="panel-body presentation-toolbar">
          <div><strong>{t("revision", { revision: baseline.revision })}</strong><p>{t("toolbarCopy")}</p></div>
          <div className="row-actions"><button className="button button-secondary" type="button" disabled={!dirty || busy} onClick={() => { setDraft(baseline); setError(""); setRefused([]); }}>{t("reset")}</button><button className="button button-primary" type="button" disabled={!dirty || busy} onClick={() => void save()}>{busy ? common("saving") : common("save")}</button></div>
        </div>
        {error ? (
          <div className={`alert alert-error presentation-page-alert${refused.length > 0 ? " presentation-page-alert-stacked" : ""}`} role="alert">
            <span>{error}</span>
            {refused.length > 0 ? (
              <ul className="presentation-issue-list">
                {refused.map((item) => (
                  <li key={`${item.placement}:${item.kind}:${item.key}`}>
                    <code>{item.kind ? `${item.kind}:${item.key}` : t("unreadableSource")}</code>
                    {" · "}
                    {t(`placements.${item.placement}`)}
                    {" · "}
                    {issueReason(item.reason)}
                  </li>
                ))}
              </ul>
            ) : null}
            {error === t("conflict") ? <button className="button button-secondary button-small" type="button" onClick={() => void load()}>{t("reload")}</button> : null}
          </div>
        ) : null}
        {dropped.length > 0 ? (
          <div className="alert alert-warning presentation-page-alert presentation-page-alert-stacked" role="status">
            <span>{t("droppedIntro", { count: dropped.length })}</span>
            <ul className="presentation-issue-list">
              {dropped.map((item) => (
                <li key={`${item.placement}:${item.kind}:${item.key}`}>
                  <code>{item.kind ? `${item.kind}:${item.key}` : t("unreadableSource")}</code>
                  {" · "}
                  {t(`placements.${item.placement}`)}
                  {" · "}
                  {issueReason(item.reason)}
                </li>
              ))}
            </ul>
            <button className="button button-secondary button-small" type="button" onClick={() => setDropped([])}>{t("droppedDismiss")}</button>
          </div>
        ) : null}
      </section>

      <div className="presentation-layout-grid">
        {(["highlight_cloud", "more_about_me"] as const).map((destination) => {
          const rows = draft[destination];
          return (
            <section className={`panel presentation-drop-zone presentation-drop-${destination}`} key={destination} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); drop(destination); }}>
              <div className="panel-header"><div><h2>{t(destination === "highlight_cloud" ? "highlightTitle" : "moreTitle")}</h2><p>{t(destination === "highlight_cloud" ? "highlightCopy" : "moreCopy")}</p></div><span className="badge">{rows.length}</span></div>
              <ol className="presentation-placement-list">{rows.map((row, index) => placementCard(row, destination, index, rows.length))}</ol>
              {rows.length === 0 ? <div className="presentation-empty-drop">{t("dropHere")}</div> : null}
            </section>
          );
        })}
      </div>

      <section className="panel presentation-unused-panel" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); drop("unused"); }}>
        <div className="panel-header"><div><h2>{t("unusedTitle")}</h2><p>{t("unusedCopy")}</p></div><span className="badge">{unused.length}</span></div>
        <div className="presentation-source-inventory">
          {unused.map((source) => {
            const assignable = isAssignable(source);
            return <article className={`presentation-inventory-card${assignable ? "" : " is-reserved"}`} draggable={assignable} onDragStart={() => setDragged(source)} onDragEnd={() => setDragged(null)} key={sourceIdentity(source)}>
              <span className="presentation-source-icon">{/* eslint-disable-next-line @next/next/no-img-element */}{source.icon.url ? <img src={source.icon.url} alt="" /> : <b>{localeText(source.labels, locale).slice(0, 1)}</b>}</span>
              <span className="presentation-source-copy"><strong>{localeText(source.labels, locale)}</strong><small><code>{source.kind}:{source.key}</code>{source.dedicated_section ? ` · ${t("dedicated", { section: source.dedicated_section })}` : ""}{source.kind === "field" && !source.active ? ` · ${t("inactive")}` : ""}</small><em>{sourceSample(source, locale)}</em></span>
              <div className="presentation-inventory-actions">
                {assignable ? <><button className="button button-secondary button-small" type="button" onClick={() => move(source, "highlight_cloud")}>{t("toHighlights")}</button><button className="button button-secondary button-small" type="button" onClick={() => move(source, "more_about_me")}>{t("toMore")}</button></> : <span className="badge badge-inactive">{t("reserved")}</span>}
                {source.kind === "builtin" ? <button className="text-button" type="button" onClick={() => { setSourceError(""); setSourceEditor(structuredClone(source)); }}>{t("editDefinition")}</button> : null}
              </div>
            </article>;
          })}
        </div>
      </section>

      <section className="panel presentation-preview-panel">
        <div className="panel-header"><div><h2>{t("previewTitle")}</h2><p>{t("previewCopy")}</p></div><div className="segmented-control" role="group" aria-label={t("accentRole")}>{payload.accent_roles.map((role) => <button type="button" className={accent === role ? "active" : ""} aria-pressed={accent === role} onClick={() => setAccent(role)} key={role}>{t(`accents.${role}`)}</button>)}</div></div>
        <div className={`presentation-phone-preview accent-${accent}`}>
          <div className="presentation-preview-hero" />
          <div className="presentation-preview-chips"><span>{previewChip ? localeText(previewChip.labels, locale) : t("previewChip")}</span><span>{t("previewChipSecond")}</span></div>
          <p>{t("previewBiography")}</p>
          <div className="presentation-preview-spacer" />
          <div className="presentation-preview-fact"><span className="presentation-source-icon">{previewRow ? localeText(previewRow.labels, locale).slice(0, 1) : "i"}</span><span><small>{previewRow ? localeText(previewRow.labels, locale) : t("previewRow")}</small><strong>{previewRow ? sourceSample(previewRow, locale) : t("previewValue")}</strong></span></div>
        </div>
        <details className="presentation-section-order"><summary>{t("sectionOrder")}</summary><ol>{payload.section_order.map((section) => <li key={section}><code>{section}</code></li>)}</ol></details>
      </section>

      {sourceEditor ? <BuiltinSourceDialog source={sourceEditor} busy={sourceBusy} error={sourceError} onChange={setSourceEditor} onClose={() => { if (!sourceBusy) setSourceEditor(null); }} onSave={() => void saveSource()} /> : null}
    </>
  );
}
