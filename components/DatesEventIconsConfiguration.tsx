"use client";

// The default import keeps the component renderable where JSX compiles to React.createElement (the test runner).
import React, { useCallback, useEffect, useId, useMemo, useReducer, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { EventIconPin, PinArtRow, PinColorField, PinMapPreview, uploadPinImage, usePinColorDraft, type PinSwatch } from "@/components/DatesPinControls";
import { adminCall } from "@/lib/adminClient";
import { createAdminIdempotencyKey } from "@/lib/datesAdmin";
import {
  EVENT_ICON_EDITOR_INITIAL, eventIconDirty, eventIconEditorReducer, eventIconHold, eventIconProblems, eventIconSaveBlock, eventIconSaveCommand,
  type EventIconEditorState, type EventIconField,
} from "@/lib/datesEventIconEditor";
import {
  DEFAULT_EVENT_PIN_COLOR, DEFAULT_EVENT_PIN_COLOR_DARK, EVENT_ICON_ACTIVITY_TYPES, EVENT_ICON_MAX_COUNT, EVENT_ICON_NAME_MAX, EVENT_ICON_ORDER_MAX,
  EVENT_ICON_REASON_MAX, EVENT_ICON_REASON_MIN, eventIconCatalog, type DatesEventIcon,
} from "@/lib/datesEventIcons";

// The pin is drawn by the controls the two catalogue editors share; it stays importable from here.
export { EventIconPin };

type ActivityType = DatesEventIcon["activity_type"];
/** The quick colours. The first one is the default orange: it stands for "no custom colour", not for a custom orange. */
const SWATCHES = [
  { name: "orange", color: null, shown: DEFAULT_EVENT_PIN_COLOR },
  { name: "purple", color: "#8A72D8", shown: "#8A72D8" },
  { name: "teal", color: "#2B9D8F", shown: "#2B9D8F" },
  { name: "coral", color: "#E47768", shown: "#E47768" },
  { name: "yellow", color: "#E6B640", shown: "#E6B640" },
] as const;

function PlusGlyph() {
  return <svg className="dates-event-glyph" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 4v12M4 10h12" /></svg>;
}

export default function DatesEventIconsConfiguration({ canManage, onHoldChange, initialState = EVENT_ICON_EDITOR_INITIAL }: {
  canManage: boolean;
  /** Told whenever the editor starts or stops holding unsaved edits or a save in doubt, so that the page does not unmount it. */
  onHoldChange?: (hold: boolean) => void;
  /** The state the editor starts in. Only a server render (a test, a preview) gives one; the page starts empty and reads. */
  initialState?: EventIconEditorState;
}) {
  const t = useTranslations("datesAdmin.eventIcons"), common = useTranslations("common"), locale = useLocale();
  const [state, dispatch] = useReducer(eventIconEditorReducer, initialState);
  const [filter, setFilter] = useState<"all" | ActivityType>("all");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const id = useId();

  // Stable on purpose: it does not close over translations, so a language switch or a `router.refresh()` cannot
  // start a read. The reducer additionally refuses to replace edits or a retained command by an unforced read.
  const load = useCallback(async (force: boolean) => {
    dispatch({ type: "requestStarted" });
    let catalog = null;
    try { catalog = eventIconCatalog(await adminCall("dates_event_icons")); } catch { catalog = null; }
    dispatch({ type: "loaded", catalog, force });
  }, []);
  useEffect(() => { void load(false); }, [load]);

  const hold = eventIconHold(state);
  useEffect(() => { onHoldChange?.(hold); }, [hold, onHoldChange]);

  const problems = useMemo(() => eventIconProblems(state.icons), [state.icons]);
  const current = state.icons.find(icon => icon.key === state.selected);
  const iconName = (icon: DatesEventIcon) => (locale === "hu" ? icon.name_hu : icon.name_en).trim() || (locale === "hu" ? icon.name_en : icon.name_hu).trim() || t("untitled");
  const locked = !canManage || state.busy || state.pending !== null;
  // What is typed into the HEX field while it is not a colour yet (the icon keeps its last colour meanwhile), and
  // whether the icon's Custom mode is open although no custom colour is chosen yet.
  const colorDraft = usePinColorDraft(current?.key, current?.marker_background_color ?? null, color => edit({ marker_background_color: color }));
  const { hexInvalid, clear: clearColorDraft } = colorDraft;
  // A new catalogue (a read or a receipt) ends every half-typed value.
  useEffect(() => { clearColorDraft(); setUploadError(null); }, [state.revision, state.baseline, clearColorDraft]);
  const block = eventIconSaveBlock(state, canManage, hexInvalid);
  const dirty = eventIconDirty(state);

  function select(key: string) {
    dispatch({ type: "selected", key });
    clearColorDraft(); setUploadError(null);
  }
  function edit(patch: Partial<Omit<DatesEventIcon, "key">>) {
    if (current) dispatch({ type: "edited", key: current.key, patch });
  }
  function reload() {
    if (state.pending !== null ? !window.confirm(t("discardPending")) : dirty && !window.confirm(t("discard"))) return;
    void load(true);
  }
  function add() {
    dispatch({ type: "added", key: `icon_${crypto.randomUUID().slice(0, 8)}`, activity_type: filter === "all" ? "hangout" : filter });
    clearColorDraft(); setUploadError(null);
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
    const command = eventIconSaveCommand(state, canManage, () => createAdminIdempotencyKey("event-icons"), hexInvalid);
    if (!command) return;
    setSaving(true);
    dispatch({ type: "saveStarted", command });
    const response = await adminCall("dates_event_icons_save", command);
    setSaving(false);
    dispatch({ type: "saveAnswered", response });
  }

  const visible = state.icons.filter(icon => filter === "all" || icon.activity_type === filter);
  const body = state.revision !== null && current ? renderBody(state, current) : null;

  function renderBody(loaded: EventIconEditorState, icon: DatesEventIcon) {
    const own = new Map<EventIconField, string>(problems.filter(problem => problem.key === icon.key)
      .map(problem => [problem.field, t(`problems.${problem.field}.${problem.code}`, { max: problem.field === "order" ? EVENT_ICON_ORDER_MAX : EVENT_ICON_NAME_MAX })]));
    const elsewhere = [...new Map(problems.filter(problem => problem.key !== icon.key).map(problem => [`${problem.key}:${problem.field}`, problem])).values()];
    const broken = new Set(problems.map(problem => problem.key));
    const known = loaded.knownKeys.includes(icon.key);
    const field = (name: string) => `${id}-${name}`;
    const errorOf = (name: EventIconField) => own.has(name) ? field(`${name}-error`) : undefined;
    const fieldError = (name: EventIconField) => own.has(name) && <p id={field(`${name}-error`)} className="dates-event-icon-error">{own.get(name)}</p>;
    const outcome = loaded.outcome;
    const blockText = block === "readOnly" ? t("blockReadOnly") : block === "clean" ? t("blockClean") : block === "problems" ? t("blockProblems")
      : block === "reason" ? t("blockReason", { min: EVENT_ICON_REASON_MIN }) : null;

    return (
      <div className="dates-event-icons-body">
        <div className="dates-event-icons-layout">
          <div className="dates-event-icons-catalog">
            <div className="dates-event-icons-toolbar">
              <select aria-label={t("filterLabel")} value={filter} onChange={event => setFilter(event.target.value as "all" | ActivityType)}>
                <option value="all">{t("filterAll")}</option>
                {EVENT_ICON_ACTIVITY_TYPES.map(type => <option key={type} value={type}>{t(`types.${type}`)}</option>)}
              </select>
              <button type="button" className="button dates-event-outline-button" disabled={locked || loaded.icons.length >= EVENT_ICON_MAX_COUNT} onClick={add}>
                <PlusGlyph />{t("add")}
              </button>
            </div>
            {visible.length === 0 ? <p className="page-subtitle">{t("emptyFilter")}</p> : (
              <div className="dates-event-icons-grid" role="radiogroup" aria-label={t("catalogLabel")}>
                {visible.map(row => (
                  <label key={row.key} className={`dates-event-icon-choice${row.key === icon.key ? " active" : ""}${row.enabled ? "" : " off"}`}>
                    <input type="radio" name={field("icon")} value={row.key} checked={row.key === icon.key} disabled={loaded.busy} onChange={() => select(row.key)} />
                    <EventIconPin icon={row} size="large" />
                    <strong>{iconName(row)}</strong>
                    <small>{t(row.marker_background_color === null ? "tileDefault" : "tileCustom")}</small>
                    <span className="dates-event-icon-tags">
                      <span>{t(`types.${row.activity_type}`)}</span>
                      {row.is_default && <span className="accent">{t("tileTypeDefault")}</span>}
                      {!row.enabled && <span className="muted">{t("tileDisabled")}</span>}
                      {broken.has(row.key) && <span className="danger">{t("tileNeedsFix")}</span>}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <section className="dates-event-icon-editor" aria-labelledby={field("edit")}>
            <h3 id={field("edit")}>{t("edit")}</h3>
            <fieldset className="dates-event-icon-fields" disabled={locked}>
              <div className="dates-event-icon-row">
                <label htmlFor={field("key")}>{t("key")}</label>
                <div><input id={field("key")} value={icon.key} readOnly /></div>
              </div>
              {(["name_hu", "name_en"] as const).map(name => (
                <div key={name} className="dates-event-icon-row">
                  <label htmlFor={field(name)}>{t(name === "name_hu" ? "nameHu" : "nameEn")}</label>
                  <div>
                    <input id={field(name)} value={icon[name]} maxLength={240} lang={name === "name_hu" ? "hu" : "en"} autoComplete="off"
                      aria-invalid={own.has(name)} aria-describedby={errorOf(name)} onChange={event => edit({ [name]: event.target.value })} />
                    {fieldError(name)}
                  </div>
                </div>
              ))}
              <PinArtRow id={field} emoji={icon.emoji} imageUrl={icon.image_url} error={own.get("emoji")} uploadFailed={uploadError === icon.key}
                labels={{ emoji: t("emoji"), image: t("image"), imageUploaded: t("imageUploaded"), removeImage: t("removeImage"), imageError: t("imageError"), imageHint: t("imageHint") }}
                onEmoji={emoji => edit({ emoji })} onFile={file => void upload(file)} onRemoveImage={() => edit({ image_url: null })} />
              <div className="dates-event-icon-row">
                <label htmlFor={field("type")}>{t("type")}</label>
                <div>
                  <select id={field("type")} value={icon.activity_type} disabled={known} aria-describedby={known ? field("type-hint") : undefined}
                    onChange={event => edit({ activity_type: event.target.value as ActivityType })}>
                    {EVENT_ICON_ACTIVITY_TYPES.map(type => <option key={type} value={type}>{t(`types.${type}`)}</option>)}
                  </select>
                  {known && <small id={field("type-hint")} className="dates-event-icon-hint">{t("typeLocked")}</small>}
                </div>
              </div>
              <div className="dates-event-icon-row">
                <label htmlFor={field("order")}>{t("order")}</label>
                <div>
                  <input id={field("order")} className="dates-event-order-input" type="number" inputMode="numeric" min={0} max={EVENT_ICON_ORDER_MAX} step={1}
                    value={Number.isFinite(icon.order) ? icon.order : ""} aria-invalid={own.has("order")} aria-describedby={errorOf("order")}
                    onChange={event => edit({ order: event.target.value.trim() === "" ? Number.NaN : Number(event.target.value) })} />
                  {fieldError("order")}
                </div>
              </div>

              <PinColorField id={field} draft={colorDraft} color={icon.marker_background_color} base={DEFAULT_EVENT_PIN_COLOR} error={own.get("marker_background_color")}
                swatches={SWATCHES.map((swatch): PinSwatch => ({ ...swatch, label: t(`swatches.${swatch.name}`) }))}
                labels={{ title: t("colorTitle"), modeDefault: t("colorModeDefault"), modeCustom: t("colorModeCustom"), hex: t("colorHex"), picker: t("colorPicker"),
                  invalid: t("colorInvalid"), swatches: t("colorSwatches"), reset: t("colorReset"), base: t("colorBase", { color: DEFAULT_EVENT_PIN_COLOR }),
                  defaultHint: t("colorDefaultHint", { day: DEFAULT_EVENT_PIN_COLOR, night: DEFAULT_EVENT_PIN_COLOR_DARK }) }} />

              <div className="dates-event-pin-previews-block">
                <h4>{t("colorPreview")}</h4>
                <div className="dates-event-pin-previews">
                  {([false, true] as const).map(dark => (
                    <PinMapPreview key={String(dark)} dark={dark} label={t(dark ? "colorPreviewNight" : "colorPreviewDay")} chip={t(dark ? "colorNight" : "colorDay")}>
                      <EventIconPin icon={icon} dark={dark} /><EventIconPin icon={icon} dark={dark} selected />
                    </PinMapPreview>
                  ))}
                </div>
              </div>

              <div className="dates-event-icon-checks">
                <label className="dates-event-icon-check">
                  <input type="checkbox" checked={icon.enabled} onChange={event => edit({ enabled: event.target.checked })} />
                  <span>{t("enabled")}</span>
                </label>
                <label className="dates-event-icon-check">
                  <input type="checkbox" checked={icon.is_default} disabled={!icon.enabled} aria-describedby={icon.enabled ? undefined : field("default-hint")}
                    onChange={event => edit({ is_default: event.target.checked })} />
                  <span>{t("default")}</span>
                </label>
              </div>
              {!icon.enabled && <small id={field("default-hint")} className="dates-event-icon-hint">{t("defaultLocked")}</small>}
              {!known && <div><button type="button" className="dates-event-link danger" onClick={() => dispatch({ type: "removed", key: icon.key })}>{t("removeNew")}</button></div>}
            </fieldset>

            <div className="dates-event-icon-save">
              <label htmlFor={field("reason")}>
                {t("reason")} <span className="dates-event-required" aria-hidden="true">*</span><span className="sr-only"> ({t("required")})</span>
              </label>
              <input id={field("reason")} value={loaded.reason} maxLength={EVENT_ICON_REASON_MAX} required aria-required="true" aria-describedby={field("reason-hint")}
                disabled={locked} onChange={event => dispatch({ type: "reason", value: event.target.value })} />
              <small id={field("reason-hint")} className="dates-event-icon-hint">{t("reasonHint", { min: EVENT_ICON_REASON_MIN })}</small>

              {outcome?.kind === "saved" && <p className="alert alert-success" role="status">{t("saved")}</p>}
              {outcome?.kind === "refused" && <p className="alert alert-error" role="alert">{outcome.error === "dates-admin-stale-revision" ? t("refusedStale") : t("refused", { error: outcome.error })}</p>}
              {outcome?.kind === "unknown" && <p className="alert alert-error" role="alert">{t("unknown")}</p>}
              {loaded.loadFailed && loaded.pending !== null && <p className="alert alert-error" role="alert">{t("loadError")}</p>}

              {blockText !== null && !loaded.busy && <p id={field("block")} className="dates-event-save-block">{blockText}</p>}
              {block === "problems" && elsewhere.length > 0 && (
                <div className="dates-event-problems">
                  <p>{t("problemsElsewhere")}</p>
                  <ul>
                    {elsewhere.map(problem => {
                      const row = loaded.icons.find(candidate => candidate.key === problem.key);
                      return row && (
                        <li key={`${problem.key}:${problem.field}`}>
                          <button type="button" className="dates-event-link" disabled={loaded.busy} onClick={() => { setFilter("all"); select(problem.key); }}>
                            {t("problemAt", { icon: iconName(row), problem: t(`problems.${problem.field}.${problem.code}`, { max: problem.field === "order" ? EVENT_ICON_ORDER_MAX : EVENT_ICON_NAME_MAX }) })}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              <div className="dates-event-icon-save-actions">
                {loaded.pending !== null && <button type="button" className="button button-secondary" disabled={loaded.busy} onClick={reload}>{t("reloadFromServer")}</button>}
                <button type="button" className="button button-primary" disabled={loaded.busy || block !== null}
                  aria-describedby={blockText !== null && !loaded.busy ? field("block") : undefined} onClick={() => void save()}>
                  {saving ? common("saving") : loaded.pending !== null ? t("retry") : common("save")}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <section className="panel dates-section dates-event-icons">
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
