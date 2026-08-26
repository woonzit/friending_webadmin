"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { hasCatalogCapability, normalizeCatalogPrincipal, type CatalogPrincipal } from "@/lib/catalogAdmin";
import {
  LAYER1_GROUPS,
  LAYER2_SELECTION_LIMIT_CHOICES,
  layer2Catalog,
  emptyReciprocalSets,
  selectionLimitIsWritable,
  selectionLimitOutOfRange,
  type Layer1Group,
  type Layer2Catalog,
  type Layer2Intent,
} from "@/lib/layer2Intents";

type Draft = Layer2Intent;

const MIN_REASON = 3;
const MAX_REASON = 1000;

function localeText(map: Record<string, string>, locale: string): string {
  return map[locale] ?? map.en ?? Object.values(map)[0] ?? "";
}

function ItemDialog({ value, busy, error, reason, onReason, onChange, onClose, onSave }: {
  value: Draft;
  busy: boolean;
  error: string;
  reason: string;
  onReason: (next: string) => void;
  onChange: (next: Draft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const t = useTranslations("layer2");
  const common = useTranslations("common");
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="layer2-item-title">
        <div className="dialog-header">
          <h2 id="layer2-item-title">{t("editTitle", { id: value.id })}</h2>
          <button className="dialog-close" onClick={onClose} disabled={busy} aria-label={common("close")}>×</button>
        </div>
        <div className="dialog-body form-grid">
          <label className="field"><span>{t("labelEn")}</span><input value={value.labels.en ?? ""} disabled={busy} onChange={(e) => onChange({ ...value, labels: { ...value.labels, en: e.target.value } })} /></label>
          <label className="field"><span>{t("labelHu")}</span><input value={value.labels.hu ?? ""} disabled={busy} onChange={(e) => onChange({ ...value, labels: { ...value.labels, hu: e.target.value } })} /></label>
          <label className="field field-full"><span>{t("glossaryEn")}</span><textarea rows={3} value={value.glossary.en ?? ""} disabled={busy} onChange={(e) => onChange({ ...value, glossary: { ...value.glossary, en: e.target.value } })} /></label>
          <label className="field field-full"><span>{t("glossaryHu")}</span><textarea rows={3} value={value.glossary.hu ?? ""} disabled={busy} onChange={(e) => onChange({ ...value, glossary: { ...value.glossary, hu: e.target.value } })} /></label>
          <p className="field-hint field-full">{t("glossaryHint")}</p>
          <fieldset className="field field-full profile-audience-fieldset">
            <legend>{t("layer1")}</legend>
            <div className="profile-segment-grid">
              {LAYER1_GROUPS.map((group) => (
                <label className="checkbox-row" key={group}>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={value.layer1.includes(group)}
                    onChange={(e) => onChange({
                      ...value,
                      layer1: e.target.checked
                        ? [...value.layer1, group]
                        : value.layer1.filter((entry) => entry !== group) as Layer1Group[],
                    })}
                  />
                  <span>{t(`groups.${group}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {/*
            DEC-011: there is no mode to choose any more, so the set id is an ordinary required
            field rather than one gated behind a radio. It is shown and not edited, because Core's
            `Layer2CatalogPolicy::transitionRefusal()` answers `layer2-reciprocal-set-immutable` for
            any change of set on a reciprocal item — and every item is reciprocal now. Offering an
            editable control whose only possible outcome is a refusal teaches operators that saving
            fails at random; the copy names the archive-and-replace path instead.
          */}
          <label className="field"><span>{t("set")}</span>
            <input value={value.reciprocal_set_id} readOnly aria-readonly="true" />
          </label>
          <p className="field-hint field-full">{t("setHint")}</p>
          <label className="field"><span>{t("order")}</span><input type="number" min={0} value={value.order} disabled={busy} onChange={(e) => onChange({ ...value, order: Math.max(0, Number(e.target.value) || 0) })} /></label>
          <label className="field field-full"><span>{t("reason")}</span>
            <textarea rows={2} required maxLength={1000} value={reason} disabled={busy} onChange={(e) => onReason(e.target.value)} />
          </label>
          <p className="field-hint field-full">{t("reasonHint")}</p>
        </div>
        {error ? <p className="alert alert-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button className="button button-secondary" onClick={onClose} disabled={busy}>{common("cancel")}</button>
          <button className="button button-primary" onClick={onSave} disabled={busy}>{busy ? common("saving") : common("save")}</button>
        </div>
      </section>
    </div>
  );
}

export default function Layer2IntentsPage() {
  const t = useTranslations("layer2");
  const common = useTranslations("common");
  const locale = useLocale();
  const [catalog, setCatalog] = useState<Layer2Catalog | null>(null);
  const [principal, setPrincipal] = useState<CatalogPrincipal | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "forbidden">("loading");
  /**
   * The id of an item Core still stores as `public`, when that is why the parse failed.
   *
   * DEC-011 retires the mode, so such a document is stale rather than broken and the operator's
   * next step is a Core migration, not an edit. A generic "could not be loaded" would send them to
   * debug the console.
   */
  const [stalePublicId, setStalePublicId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [archiving, setArchiving] = useState<{ item: Layer2Intent; archived: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  /**
   * The selection limit has its own draft, reason and error, kept apart from the item dialog's.
   *
   * Sharing `reason` would carry the justification for one change into a different one, and the
   * reason is what the audit row records — an operator who typed "trimming the kink set" and then
   * changed the limit would file that sentence against the limit change.
   */
  const [limitDraft, setLimitDraft] = useState<number | null>(null);
  const [limitReason, setLimitReason] = useState("");
  const [limitError, setLimitError] = useState("");
  const [limitBusy, setLimitBusy] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    const [catalogResponse, meResponse] = await Promise.all([
      adminCall("layer2_catalog", {}),
      adminCall("admin_me", {}),
    ]);
    // A capability refusal is not a load failure, and telling an operator "could not be loaded"
    // when the real answer is "your account has no catalogue role" sends them to debug the wrong
    // thing. Core refuses with a typed error; surface it as itself.
    if (catalogResponse?.error === "catalog-admin-capability-required"
      || catalogResponse?.error === "catalog-admin-revoked") {
      setPrincipal(normalizeCatalogPrincipal(meResponse));
      setState("forbidden");
      return;
    }
    const parsed = catalogResponse?.success ? layer2Catalog(catalogResponse.data ?? catalogResponse) : null;
    if (!parsed?.ok) {
      const failure = parsed && !parsed.ok ? parsed : null;
      setStalePublicId(failure?.error === "visibility-mode-public" ? (failure.item_id ?? "") : null);
      setState("error");
      return;
    }
    setStalePublicId(null);
    setCatalog(parsed.catalog);
    setPrincipal(normalizeCatalogPrincipal(meResponse));
    setState("ready");
  }, []);

  useEffect(() => { void load(); }, [load]);
  /**
   * Adopt the authoritative limit whenever it actually changes — including after a 409, where the
   * whole point is that the server copy wins and the draft is dropped.
   *
   * Keyed on the value rather than on the catalogue object, so an unrelated reload (an item save,
   * a refresh) does not silently throw away a limit the operator is part-way through choosing.
   * `catalog.selection_limit` is the clamped one, so an out-of-range Core pre-fills the control
   * with a value that can actually be saved.
   */
  useEffect(() => {
    setLimitDraft(catalog?.selection_limit ?? null);
    setLimitReason("");
    setLimitError("");
  }, [catalog?.selection_limit]);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const canEdit = hasCatalogCapability(principal, "catalog_layer2_edit");

  const blockersById = useMemo(() => {
    const map = new Map<string, { error: string; locale: string | null }>();
    for (const blocker of catalog?.blockers ?? []) {
      map.set(blocker.id, { error: blocker.error, locale: blocker.locale });
    }
    return map;
  }, [catalog]);

  const emptySets = useMemo(() => (catalog ? emptyReciprocalSets(catalog) : []), [catalog]);

  /**
   * A 409 carries the whole authoritative catalogue. The draft is discarded and the fresh state is
   * shown, never merged — WA-02 and spec §15: a silent merge could widen an audience without the
   * operator knowing, which is the failure this whole feature exists to prevent.
   */
  function handleConflict(response: Record<string, unknown> | null): boolean {
    const body = response?.data as Record<string, unknown> | undefined;
    const authoritative = body?.authoritative ?? body?.document ?? body;
    const fresh = authoritative ? layer2Catalog(authoritative) : null;
    if (fresh?.ok) setCatalog(fresh.catalog);
    setDraft(null);
    setArchiving(null);
    setReason("");
    // The selection limit is discarded on the same terms as an item draft. Set explicitly rather
    // than left to the adopt effect: if the conflicting write changed something else, the limit is
    // unchanged, the effect never fires, and a stale local choice would survive a conflict.
    if (fresh?.ok) setLimitDraft(fresh.catalog.selection_limit);
    setLimitReason("");
    setLimitError("");
    setToast({ tone: "error", text: t("conflict") });
    return true;
  }

  async function save() {
    if (!draft || !catalog) return;
    if (reason.trim().length < MIN_REASON) { setFormError(t("reasonRequired")); return; }
    setBusy(true);
    setFormError("");
    // `visibility_mode` is still sent, and is always `reciprocal`. Core's `normalizeEntry()`
    // requires the field and refuses an entry without a recognised mode; DEC-011 narrows the
    // vocabulary rather than dropping the field, so omitting it here would make every save a 422.
    const response = await adminCall("save_layer2_item", {
      id: draft.id,
      labels_json: JSON.stringify(draft.labels),
      glossary_json: JSON.stringify(draft.glossary),
      layer1_json: JSON.stringify(draft.layer1),
      visibility_mode: draft.visibility_mode,
      reciprocal_set_id: draft.reciprocal_set_id,
      order: draft.order,
      reason: reason.trim().slice(0, MAX_REASON),
      expected_intents_revision: catalog.catalog_revision,
    });
    setBusy(false);
    if (response?.error === "layer2-intents-conflict" || response?.error === "intents-revision-conflict") {
      handleConflict(response);
      return;
    }
    if (!response?.success) { setFormError(t("saveError")); return; }
    setDraft(null);
    setReason("");
    setToast({ tone: "success", text: t("saved") });
    await load();
  }

  /**
   * Write the selection limit.
   *
   * Its own Core action rather than a field on the item save, because it is a catalogue-wide
   * parameter: an operator must be able to change it without also editing an item, and the audit
   * row must not name an item for a change that was not about that item. Everything else is the
   * item write's contract unchanged — the same `catalog_layer2_edit` capability, the same
   * `expected_intents_revision` guard against the one revision the singleton document carries, the
   * same mandatory reason, and the same 409 handling.
   *
   * The bound is checked here as well as by Core. Not because Core is untrusted, but because an
   * out-of-bound *stored* value reaches this state through the clamp: the control cannot express a
   * 6, yet a 6 Core already holds is sitting one state variable away. Sending it back would be the
   * console re-writing the document it is asking the operator to correct.
   */
  async function saveSelectionLimit() {
    if (!catalog || limitDraft === null) return;
    if (!selectionLimitIsWritable(limitDraft)) { setLimitError(t("selectionLimitCeiling")); return; }
    if (limitReason.trim().length < MIN_REASON) { setLimitError(t("reasonRequired")); return; }
    setLimitBusy(true);
    setLimitError("");
    const response = await adminCall("set_layer2_selection_limit", {
      selection_limit: limitDraft,
      reason: limitReason.trim().slice(0, MAX_REASON),
      expected_intents_revision: catalog.catalog_revision,
    });
    setLimitBusy(false);
    if (response?.error === "layer2-intents-conflict" || response?.error === "intents-revision-conflict") {
      handleConflict(response);
      return;
    }
    // Core's two typed refusals for this field. The control cannot produce either, so reaching one
    // means the console and Core disagree about the bound — which is precisely the case the generic
    // "could not be saved" would hide behind a retry that can never succeed.
    if (response?.error === "layer2-selection-limit-invalid"
      || response?.error === "layer2-selection-limit-out-of-range") {
      setLimitError(t("selectionLimitCeiling"));
      return;
    }
    // Core refuses a limit on a catalogue that does not exist yet: there is nothing to select from,
    // and writing one would leave an item-less singleton the seeding script then declines to fill.
    if (response?.error === "layer2-catalog-missing") { setLimitError(t("selectionLimitNoCatalog")); return; }
    if (!response?.success) { setLimitError(t("saveError")); return; }
    setLimitReason("");
    // Core answers `changed: false` for a re-save of the value already stored and deliberately does
    // NOT bump the revision, so in-flight member drafts are not invalidated for nothing. Reported
    // as its own outcome rather than as a save, so an operator does not read a confirmation as
    // evidence that their intended change landed.
    setToast({
      tone: "success",
      text: response.changed === false ? t("selectionLimitUnchangedResult") : t("selectionLimitSaved"),
    });
    await load();
  }

  async function applyArchive() {
    if (!archiving || !catalog) return;
    if (reason.trim().length < MIN_REASON) { setFormError(t("reasonRequired")); return; }
    setBusy(true);
    const response = await adminCall("archive_layer2_item", {
      id: archiving.item.id,
      archived: archiving.archived,
      reason: reason.trim().slice(0, MAX_REASON),
      expected_intents_revision: catalog.catalog_revision,
    });
    setBusy(false);
    if (response?.error === "layer2-intents-conflict" || response?.error === "intents-revision-conflict") {
      handleConflict(response);
      return;
    }
    if (!response?.success) {
      setToast({ tone: "error", text: t("saveError") });
      setArchiving(null);
      return;
    }
    setArchiving(null);
    setReason("");
    setToast({ tone: "success", text: archiving.archived ? t("archived") : t("restored") });
    await load();
  }

  if (state === "loading") return <LoadingPanel />;
  if (state === "forbidden") {
    return (
      <>
        {/*
          No catalogue was loaded here, so there is no limit to state. This used to render a
          hard-coded 5, which was already only accidentally true and is now a claim the console has
          no basis for: the number is an administrator parameter that an operator without the
          catalogue role cannot see.
        */}
        <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitleUnknownLimit")} />
        <section className="panel">
          <div className="panel-body">
            <p className="alert alert-error" role="alert">{t("noCatalogRole")}</p>
            <p className="page-subtitle">{t("noCatalogRoleHint")}</p>
          </div>
        </section>
      </>
    );
  }
  if (state === "error" || !catalog) {
    return (
      <ErrorPanel
        message={stalePublicId === null ? t("loadError") : t("stalePublicItem", { id: stalePublicId })}
        retry={load}
      />
    );
  }

  const publishable = new Set(catalog.publishable_ids);
  const items = [...catalog.items].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={t("subtitle", { limit: catalog.selection_limit })}
        actions={<button className="button button-secondary" onClick={() => void load()}>{common("refresh")}</button>}
      />

      <section className="panel">
        <div className="panel-header"><div><h2>{t("readiness")}</h2><p>{t("readinessCopy")}</p></div></div>
        <div className="panel-body">
          <p className="alert alert-info">{t("disclosureRule")}</p>
          <p>{t("publishableCount", { ready: publishable.size, total: catalog.items.length })}</p>
          {emptySets.length > 0 ? <p className="alert alert-warning" role="status">{t("emptySets", { sets: emptySets.join(", ") })}</p> : null}
          {!canEdit ? <p className="page-subtitle">{t("readOnly")}</p> : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>{t("selectionLimit")}</h2><p>{t("selectionLimitCopy")}</p></div></div>
        <div className="panel-body form-grid">
          {/*
            Storage outside the bound. Reported with BOTH numbers, because the control below is
            pre-filled with the clamped one and would otherwise look perfectly correct while the
            document is not. Deliberately not called an outage: Core clamps the same value on its
            member wire, so members are served the effective number and signup works. What it does
            mean is that something other than this console wrote the field, since Core refuses an
            out-of-range write.
          */}
          {selectionLimitOutOfRange(catalog)
            ? (
              <p className="alert alert-warning field-full" role="alert">
                {t("selectionLimitOutOfRange", {
                  stored: catalog.selection_limit_stored,
                  effective: catalog.selection_limit,
                })}
              </p>
            )
            : null}
          <label className="field"><span>{t("selectionLimitLabel")}</span>
            {/*
              A bounded selector, never a number input. 1..5 is not a validation preference: a
              value outside it fails the released-client guard and takes the whole catalogue with
              it, so the control must not be able to express one in the first place. `min`/`max` on
              a number field would not do — they are advisory, and absent from a programmatic change.
            */}
            <select
              value={String(limitDraft ?? catalog.selection_limit)}
              disabled={!canEdit || limitBusy}
              onChange={(event) => { setLimitError(""); setLimitDraft(Number(event.target.value)); }}
            >
              {LAYER2_SELECTION_LIMIT_CHOICES.map((choice) => (
                <option key={choice} value={String(choice)}>{choice}</option>
              ))}
            </select>
          </label>
          <p className="field-hint field-full">{t("selectionLimitCeiling")}</p>
          {limitDraft !== null && limitDraft !== catalog.selection_limit
            ? <p className="alert alert-info field-full" role="status">{t("selectionLimitUnsaved", { current: catalog.selection_limit })}</p>
            : null}
          <label className="field field-full"><span>{t("reason")}</span>
            <textarea rows={2} required maxLength={MAX_REASON} value={limitReason} disabled={!canEdit || limitBusy} onChange={(event) => setLimitReason(event.target.value)} />
          </label>
          <p className="field-hint field-full">{t("reasonHint")}</p>
          {limitError ? <p className="alert alert-error field-full" role="alert">{limitError}</p> : null}
          {/* `row-actions`, not `dialog-actions`: the latter carries a dialog's top border and
              its own 17/24 padding, which inside an already-padded panel body draws a stray rule
              at the wrong inset. */}
          <div className="row-actions field-full">
            <button
              className="button button-primary"
              disabled={!canEdit || limitBusy || limitDraft === null || (limitDraft === catalog.selection_limit && !selectionLimitOutOfRange(catalog))}
              onClick={() => void saveSelectionLimit()}
            >{limitBusy ? common("saving") : t("selectionLimitSave")}</button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("item")}</th>
                <th>{t("layer1")}</th>
                <th>{t("set")}</th>
                <th>{t("order")}</th>
                <th>{t("status")}</th>
                <th><span className="sr-only">{common("actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const blocker = blockersById.get(item.id);
                return (
                  <tr key={item.id} className={item.archived ? "is-inactive" : ""}>
                    <td><strong>{localeText(item.labels, locale)}</strong><small><code>{item.id}</code></small></td>
                    <td><div className="icebreaker-badges">{item.layer1.map((group) => <span className="badge" key={group}>{t(`groups.${group}`)}</span>)}</div></td>
                    {/*
                      Every item is reciprocal, so a "Reciprocal" badge on every row would carry no
                      information. The set is what differs between rows, and it is the boundary the
                      answer is disclosed inside.
                    */}
                    <td><code>{item.reciprocal_set_id}</code></td>
                    <td>{item.order}</td>
                    <td>
                      <div className="cell-stack">
                        <span className={`badge ${item.archived ? "badge-inactive" : "badge-active"}`}>{item.archived ? t("archivedState") : t("liveState")}</span>
                        {publishable.has(item.id)
                          ? null
                          : <small className="table-subline">{blocker?.locale ? t("blockedBy", { locales: blocker.locale.toUpperCase() }) : t("notServable")}</small>}
                      </div>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="button button-secondary button-small" disabled={!canEdit} onClick={() => { setFormError(""); setReason(""); setDraft(structuredClone(item)); }}>{common("edit")}</button>
                        <button
                          className={`button button-small ${item.archived ? "button-secondary" : "button-danger"}`}
                          disabled={!canEdit}
                          onClick={() => { setFormError(""); setReason(""); setArchiving({ item, archived: !item.archived }); }}
                        >{item.archived ? t("restore") : t("archive")}</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {draft ? (
        <ItemDialog
          value={draft}
          busy={busy}
          error={formError}
          reason={reason}
          onReason={setReason}
          onChange={setDraft}
          onClose={() => { if (!busy) { setDraft(null); setReason(""); } }}
          onSave={() => void save()}
        />
      ) : null}

      {archiving ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) { setArchiving(null); setReason(""); } }}>
          <section className="dialog dialog-small" role="alertdialog" aria-modal="true" aria-labelledby="layer2-archive-title">
            <div className="dialog-header">
              <h2 id="layer2-archive-title">{archiving.archived ? t("archiveTitle") : t("restoreTitle")}</h2>
              <button className="dialog-close" onClick={() => { setArchiving(null); setReason(""); }} disabled={busy} aria-label={common("close")}>×</button>
            </div>
            <div className="dialog-body">
              <p className="page-subtitle">{archiving.archived
                ? t("archiveCopy", { name: localeText(archiving.item.labels, locale) })
                : t("restoreCopy", { name: localeText(archiving.item.labels, locale) })}</p>
              <label className="field field-full"><span>{t("reason")}</span>
                <textarea rows={2} required maxLength={MAX_REASON} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} />
              </label>
              {formError ? <p className="alert alert-error" role="alert">{formError}</p> : null}
            </div>
            <div className="dialog-actions">
              <button className="button button-secondary" onClick={() => { setArchiving(null); setReason(""); }} disabled={busy}>{common("cancel")}</button>
              <button className={`button ${archiving.archived ? "button-danger" : "button-primary"}`} disabled={busy} onClick={() => void applyArchive()}>
                {busy ? common("working") : archiving.archived ? t("archive") : t("restore")}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {toast && <div className={`toast${toast.tone === "error" ? " toast-error" : ""}`} role={toast.tone === "error" ? "alert" : "status"}>{toast.text}</div>}
    </>
  );
}
