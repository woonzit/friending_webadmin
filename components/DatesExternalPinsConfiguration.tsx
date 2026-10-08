"use client";

// The default import keeps the component renderable where JSX compiles to React.createElement (the test runner).
import React, { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { EventIconPin, PinArtRow, PinColorField, PinHexInputs, PinMapPreview, uploadPinImage, usePinColorDraft, type PinSwatch } from "@/components/DatesPinControls";
import { adminCall } from "@/lib/adminClient";
import { createAdminIdempotencyKey, humanizeMachineKey } from "@/lib/datesAdmin";
import type { EventIconField } from "@/lib/datesEventIconEditor";
import { EVENT_ICON_NAME_MAX, EVENT_ICON_ORDER_MAX, EVENT_ICON_REASON_MAX, EVENT_ICON_REASON_MIN } from "@/lib/datesEventIcons";
import {
  EXTERNAL_PIN_EDITOR_INITIAL, externalPinDirty, externalPinEditorReducer, externalPinHold, externalPinProblems, externalPinSaveBlock, externalPinSaveCommand,
  type ExternalPinEditorState,
} from "@/lib/datesExternalPinEditor";
import { DEFAULT_EXTERNAL_PIN_COLOR, externalPinCatalog, type DatesExternalPin, type DatesExternalPinFields } from "@/lib/datesExternalPins";

/** The quick colours. The first one stands for "no colour of its own": the catalogue's default, not a stored colour. */
const SWATCHES = [
  { name: "default", color: null },
  { name: "blue", color: "#3B82D6" },
  { name: "teal", color: "#2B9D8F" },
  { name: "magenta", color: "#C2409A" },
  { name: "green", color: "#4C9A52" },
] as const;
/** The target name of the catalogue colour's HEX field (a pin's field is named by its type). */
const CATALOG_COLOR = "catalog";

/**
 * The pins of the eleven third-party event types (AreYouIn -> Configuration).
 * The list is fixed: a type's look is edited, and one colour for every type
 * that has none of its own. Loading, the save with its reason, a stale
 * refusal, an unknown outcome and the reload are the member icon editor's
 * (components/DatesEventIconsConfiguration.tsx); the state is
 * lib/datesExternalPinEditor.ts.
 */
export default function DatesExternalPinsConfiguration({ canManage, onHoldChange, initialState = EXTERNAL_PIN_EDITOR_INITIAL }: {
  canManage: boolean;
  /** Told whenever the editor starts or stops holding unsaved edits or a save in doubt, so that the page does not unmount it. */
  onHoldChange?: (hold: boolean) => void;
  /** The state the editor starts in. Only a server render (a test, a preview) gives one; the page starts empty and reads. */
  initialState?: ExternalPinEditorState;
}) {
  // The field labels, the colour and preview wording and the save messages are the member icon editor's own.
  const t = useTranslations("datesAdmin.externalPins"), shared = useTranslations("datesAdmin.eventIcons");
  const categories = useTranslations("datesAdmin.external.form.categories"), common = useTranslations("common"), locale = useLocale();
  const [state, dispatch] = useReducer(externalPinEditorReducer, initialState);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // One save at a time, also between two clicks that the same render answered.
  const saveInFlight = useRef(false);
  const id = useId();

  // Stable on purpose: it does not close over translations, so a language switch or a `router.refresh()` cannot
  // start a read. The reducer additionally refuses to replace edits or a retained command by an unforced read.
  const load = useCallback(async (force: boolean) => {
    dispatch({ type: "requestStarted" });
    let catalog = null;
    try { catalog = externalPinCatalog(await adminCall("dates_external_pins")); } catch { catalog = null; }
    dispatch({ type: "loaded", catalog, force });
  }, []);
  useEffect(() => { void load(false); }, [load]);

  const hold = externalPinHold(state);
  useEffect(() => { onHoldChange?.(hold); }, [hold, onHoldChange]);

  const problems = useMemo(() => externalPinProblems(state.pins), [state.pins]);
  const current = state.pins.find(pin => pin.key === state.selected);
  const pinName = (pin: DatesExternalPin) => (locale === "hu" ? pin.name_hu : pin.name_en).trim() || (locale === "hu" ? pin.name_en : pin.name_hu).trim() || t("untitled");
  const categoryName = (category: string) => categories.has(category) ? categories(category) : humanizeMachineKey(category);
  const locked = !canManage || state.busy || state.pending !== null;
  const colorDraft = usePinColorDraft(current?.key, current?.marker_background_color ?? null, color => edit({ marker_background_color: color }));
  // The catalogue's colour is required: an empty field is not "default", and nothing is stored until it is a colour.
  const catalogDraft = usePinColorDraft(CATALOG_COLOR, state.defaultColor, color => { if (color !== null) dispatch({ type: "defaultColor", value: color }); }, true);
  const { clear: clearColorDraft } = colorDraft, { clear: clearCatalogDraft } = catalogDraft;
  // A new catalogue (a read or a receipt) ends every half-typed value.
  useEffect(() => { clearColorDraft(); clearCatalogDraft(); setUploadError(null); }, [state.revision, state.baseline, clearColorDraft, clearCatalogDraft]);
  const draftInvalid = colorDraft.hexInvalid || catalogDraft.hexInvalid;
  const block = externalPinSaveBlock(state, canManage, draftInvalid);
  const dirty = externalPinDirty(state);

  function select(key: string) {
    dispatch({ type: "selected", key });
    clearColorDraft(); setUploadError(null);
  }
  function edit(patch: Partial<Omit<DatesExternalPinFields, "key">>) {
    if (current) dispatch({ type: "edited", key: current.key, patch });
  }
  function reload() {
    if (state.pending !== null ? !window.confirm(shared("discardPending")) : dirty && !window.confirm(t("discard"))) return;
    void load(true);
  }
  async function upload(file?: File) {
    if (!file || !current) return;
    const key = current.key;
    const image = await uploadPinImage(file, on => dispatch({ type: on ? "requestStarted" : "requestFinished" }));
    if (image === null) { setUploadError(key); return; }
    setUploadError(null);
    dispatch({ type: "edited", key, patch: { image_url: image } });
  }
  async function save() {
    if (saveInFlight.current) return;
    const command = externalPinSaveCommand(state, canManage, () => createAdminIdempotencyKey("external-pins"), draftInvalid);
    if (!command) return;
    saveInFlight.current = true;
    setSaving(true);
    dispatch({ type: "saveStarted", command });
    // A call that fails without an answer is an answer that did not arrive: the outcome is unknown.
    let response: unknown = null;
    try { response = await adminCall("dates_external_pins_save", command); } catch { response = null; }
    saveInFlight.current = false;
    setSaving(false);
    dispatch({ type: "saveAnswered", response });
  }

  const body = state.revision !== null && current ? renderBody(state, current) : null;

  function renderBody(loaded: ExternalPinEditorState, pin: DatesExternalPin) {
    const problemText = (field: EventIconField, code: string) => shared(`problems.${field}.${code}`, { max: field === "order" ? EVENT_ICON_ORDER_MAX : EVENT_ICON_NAME_MAX });
    const own = new Map<EventIconField, string>(problems.filter(problem => problem.key === pin.key).map(problem => [problem.field, problemText(problem.field, problem.code)]));
    const elsewhere = [...new Map(problems.filter(problem => problem.key !== pin.key).map(problem => [`${problem.key}:${problem.field}`, problem])).values()];
    const broken = new Set(problems.map(problem => problem.key));
    const field = (name: string) => `${id}-${name}`;
    const errorOf = (name: EventIconField) => own.has(name) ? field(`${name}-error`) : undefined;
    const fieldError = (name: EventIconField) => own.has(name) && <p id={field(`${name}-error`)} className="dates-event-icon-error">{own.get(name)}</p>;
    const outcome = loaded.outcome;
    const blockText = block === "readOnly" ? t("blockReadOnly") : block === "clean" ? shared("blockClean") : block === "problems" ? shared("blockProblems")
      : block === "reason" ? shared("blockReason", { min: EVENT_ICON_REASON_MIN }) : null;
    const colorLabels = { hex: shared("colorHex"), picker: shared("colorPicker") };

    return (
      <div className="dates-event-icons-body">
        <div className="dates-event-icons-layout">
          <div className="dates-event-icons-catalog">
            <fieldset className="dates-external-pin-default" disabled={locked}>
              <legend>{t("defaultColorTitle")}</legend>
              <div className="dates-external-pin-default-line">
                <EventIconPin shape="external" size="small" icon={{ emoji: pin.emoji, image_url: pin.image_url, marker_background_color: null }} defaultColor={loaded.defaultColor} />
                <PinHexInputs draft={catalogDraft} pickerColor={loaded.defaultColor} invalid={catalogDraft.hexInvalid} labels={{ ...colorLabels, hex: t("defaultColorTitle") }}
                  describedBy={catalogDraft.hexInvalid ? field("default-color-error") : field("default-color-hint")} />
                <button type="button" className="dates-event-link" disabled={loaded.defaultColor === DEFAULT_EXTERNAL_PIN_COLOR && !catalogDraft.hexInvalid}
                  onClick={() => catalogDraft.choose(DEFAULT_EXTERNAL_PIN_COLOR)}>{t("defaultColorReset", { color: DEFAULT_EXTERNAL_PIN_COLOR })}</button>
              </div>
              {catalogDraft.hexInvalid && <p id={field("default-color-error")} className="dates-event-icon-error">{t("defaultColorInvalid", { color: DEFAULT_EXTERNAL_PIN_COLOR })}</p>}
              <small id={field("default-color-hint")} className="dates-event-icon-hint">{t("defaultColorHint")}</small>
            </fieldset>

            <div className="dates-event-icons-grid" role="radiogroup" aria-label={t("catalogLabel")}>
              {loaded.pins.map(row => (
                <label key={row.key} className={`dates-event-icon-choice${row.key === pin.key ? " active" : ""}`}>
                  <input type="radio" name={field("pin")} value={row.key} checked={row.key === pin.key} disabled={loaded.busy} onChange={() => select(row.key)} />
                  <EventIconPin shape="external" icon={row} size="large" defaultColor={loaded.defaultColor} />
                  <strong>{pinName(row)}</strong>
                  <small>{shared(row.marker_background_color === null ? "tileDefault" : "tileCustom")}</small>
                  <span className="dates-event-icon-tags">
                    {row.categories.map(category => <span key={category}>{categoryName(category)}</span>)}
                    {broken.has(row.key) && <span className="danger">{shared("tileNeedsFix")}</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <section className="dates-event-icon-editor" aria-labelledby={field("edit")}>
            <h3 id={field("edit")}>{t("edit")}</h3>
            <fieldset className="dates-event-icon-fields" disabled={locked}>
              <div className="dates-event-icon-row">
                <label htmlFor={field("key")}>{shared("key")}</label>
                <div><input id={field("key")} value={pin.key} readOnly /></div>
              </div>
              <div className="dates-event-icon-row">
                <span className="dates-external-pin-label" id={field("covers")}>{t("covers")}</span>
                <div>
                  <ul className="dates-external-pin-covers" aria-labelledby={field("covers")}>
                    {pin.categories.map(category => <li key={category}>{categoryName(category)}</li>)}
                  </ul>
                  <small className="dates-event-icon-hint">{t("coversHint")}</small>
                </div>
              </div>
              {(["name_hu", "name_en"] as const).map(name => (
                <div key={name} className="dates-event-icon-row">
                  <label htmlFor={field(name)}>{shared(name === "name_hu" ? "nameHu" : "nameEn")}</label>
                  <div>
                    <input id={field(name)} value={pin[name]} maxLength={240} lang={name === "name_hu" ? "hu" : "en"} autoComplete="off"
                      aria-invalid={own.has(name)} aria-describedby={errorOf(name)} onChange={event => edit({ [name]: event.target.value })} />
                    {fieldError(name)}
                  </div>
                </div>
              ))}
              <PinArtRow id={field} emoji={pin.emoji} imageUrl={pin.image_url} error={own.get("emoji")} uploadFailed={uploadError === pin.key}
                labels={{ emoji: shared("emoji"), image: shared("image"), imageUploaded: shared("imageUploaded"), removeImage: shared("removeImage"),
                  imageError: shared("imageError"), imageHint: shared("imageHint") }}
                onEmoji={emoji => edit({ emoji })} onFile={file => void upload(file)} onRemoveImage={() => edit({ image_url: null })} />
              <div className="dates-event-icon-row">
                <label htmlFor={field("order")}>{shared("order")}</label>
                <div>
                  <input id={field("order")} className="dates-event-order-input" type="number" inputMode="numeric" min={0} max={EVENT_ICON_ORDER_MAX} step={1}
                    value={Number.isFinite(pin.order) ? pin.order : ""} aria-invalid={own.has("order")} aria-describedby={errorOf("order")}
                    onChange={event => edit({ order: event.target.value.trim() === "" ? Number.NaN : Number(event.target.value) })} />
                  {fieldError("order")}
                </div>
              </div>

              <PinColorField id={field} draft={colorDraft} color={pin.marker_background_color} base={loaded.defaultColor} error={own.get("marker_background_color")}
                swatches={SWATCHES.map((swatch): PinSwatch => ({ ...swatch, shown: swatch.color ?? loaded.defaultColor, label: t(`swatches.${swatch.name}`) }))}
                labels={{ ...colorLabels, title: shared("colorTitle"), modeDefault: shared("colorModeDefault"), modeCustom: shared("colorModeCustom"),
                  invalid: shared("colorInvalid"), swatches: shared("colorSwatches"), reset: t("colorReset"), base: t("colorBase", { color: loaded.defaultColor }),
                  defaultHint: t("colorDefaultHint", { color: loaded.defaultColor }) }} />

              <div className="dates-event-pin-previews-block">
                <h4>{shared("colorPreview")}</h4>
                <div className="dates-event-pin-previews">
                  {([false, true] as const).map(dark => (
                    <PinMapPreview key={String(dark)} dark={dark} label={shared(dark ? "colorPreviewNight" : "colorPreviewDay")} chip={shared(dark ? "colorNight" : "colorDay")}>
                      <EventIconPin shape="external" icon={pin} dark={dark} defaultColor={loaded.defaultColor} />
                      <EventIconPin shape="external" icon={pin} dark={dark} defaultColor={loaded.defaultColor} selected />
                    </PinMapPreview>
                  ))}
                </div>
                {/* Once, beside a member pin with the same icon: the two differ in the shape of the head and in the colour. */}
                <div className="dates-external-pin-compare" role="img" aria-label={t("compareLabel")}>
                  <span><EventIconPin size="small" icon={{ emoji: pin.emoji, image_url: pin.image_url, marker_background_color: null }} dark />{t("compareMember")}</span>
                  <span><EventIconPin shape="external" size="small" icon={pin} defaultColor={loaded.defaultColor} />{t("compareExternal")}</span>
                </div>
              </div>
            </fieldset>

            <div className="dates-event-icon-save">
              <label htmlFor={field("reason")}>
                {shared("reason")} <span className="dates-event-required" aria-hidden="true">*</span><span className="sr-only"> ({shared("required")})</span>
              </label>
              <input id={field("reason")} value={loaded.reason} maxLength={EVENT_ICON_REASON_MAX} required aria-required="true" aria-describedby={field("reason-hint")}
                disabled={locked} onChange={event => dispatch({ type: "reason", value: event.target.value })} />
              <small id={field("reason-hint")} className="dates-event-icon-hint">{shared("reasonHint", { min: EVENT_ICON_REASON_MIN })}</small>

              {outcome?.kind === "saved" && <p className="alert alert-success" role="status">{t("saved")}</p>}
              {outcome?.kind === "refused" && <p className="alert alert-error" role="alert">{outcome.error === "dates-admin-stale-revision" ? shared("refusedStale") : shared("refused", { error: outcome.error })}</p>}
              {outcome?.kind === "unknown" && <p className="alert alert-error" role="alert">{shared("unknown")}</p>}
              {loaded.loadFailed && loaded.pending !== null && <p className="alert alert-error" role="alert">{t("loadError")}</p>}

              {blockText !== null && !loaded.busy && <p id={field("block")} className="dates-event-save-block">{blockText}</p>}
              {block === "problems" && elsewhere.length > 0 && (
                <div className="dates-event-problems">
                  <p>{t("problemsElsewhere")}</p>
                  <ul>
                    {elsewhere.map(problem => {
                      const row = loaded.pins.find(candidate => candidate.key === problem.key);
                      return row && (
                        <li key={`${problem.key}:${problem.field}`}>
                          <button type="button" className="dates-event-link" disabled={loaded.busy} onClick={() => select(problem.key)}>
                            {shared("problemAt", { icon: pinName(row), problem: problemText(problem.field, problem.code) })}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              <div className="dates-event-icon-save-actions">
                {loaded.pending !== null && <button type="button" className="button button-secondary" disabled={loaded.busy} onClick={reload}>{shared("reloadFromServer")}</button>}
                <button type="button" className="button button-primary" disabled={loaded.busy || block !== null}
                  aria-describedby={blockText !== null && !loaded.busy ? field("block") : undefined} onClick={() => void save()}>
                  {saving ? common("saving") : loaded.pending !== null ? shared("retry") : common("save")}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <section className="panel dates-section dates-event-icons dates-external-pins">
      <div className="panel-header">
        <div><h2>{t("title")}</h2><p>{t("copy")}</p></div>
        <button type="button" className="button button-secondary" disabled={state.busy} onClick={reload}>{common("refresh")}</button>
      </div>
      {state.loadFailed && <p className="alert alert-error dates-event-icons-notice" role="alert">{t("loadError")}</p>}
      {state.revision === null && !state.loadFailed && <p className="page-subtitle dates-event-icons-notice" role="status">{t("loading")}</p>}
      {body}
    </section>
  );
}
