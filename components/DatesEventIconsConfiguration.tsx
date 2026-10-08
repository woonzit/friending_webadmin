"use client";

// The default import keeps the component renderable where JSX compiles to React.createElement (the test runner).
import React, { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState, type CSSProperties } from "react";
import { useLocale, useTranslations } from "next-intl";
import { adminCall, adminUploadProfileIcon } from "@/lib/adminClient";
import { createAdminIdempotencyKey } from "@/lib/datesAdmin";
import {
  EVENT_ICON_EDITOR_INITIAL, eventIconDirty, eventIconEditorReducer, eventIconHold, eventIconProblems, eventIconSaveBlock, eventIconSaveCommand,
  type EventIconEditorState, type EventIconField,
} from "@/lib/datesEventIconEditor";
import {
  DEFAULT_EVENT_PIN_COLOR, DEFAULT_EVENT_PIN_COLOR_DARK, EVENT_ICON_ACTIVITY_TYPES, EVENT_ICON_MAX_COUNT, EVENT_ICON_NAME_MAX, EVENT_ICON_ORDER_MAX,
  EVENT_ICON_REASON_MAX, EVENT_ICON_REASON_MIN, eventIconCatalog, eventIconImageURL, eventPinColorFromInput, eventPinOutline, validEventPinColor,
  type DatesEventIcon,
} from "@/lib/datesEventIcons";

type ActivityType = DatesEventIcon["activity_type"];
/** The quick colours. The first one is the default orange: it stands for "no custom colour", not for a custom orange. */
const SWATCHES = [
  { name: "orange", color: null, shown: DEFAULT_EVENT_PIN_COLOR },
  { name: "purple", color: "#8A72D8", shown: "#8A72D8" },
  { name: "teal", color: "#2B9D8F", shown: "#2B9D8F" },
  { name: "coral", color: "#E47768", shown: "#E47768" },
  { name: "yellow", color: "#E6B640", shown: "#E6B640" },
] as const;
const MAX_ICON_IMAGE_BYTES = 2 * 1024 * 1024;

/** A map pin as the apps draw it: the icon on a white plate, on the assigned colour; the selected pin is larger and light. */
export function EventIconPin({ icon, dark = false, selected = false, size = "regular" }:
  { icon: Pick<DatesEventIcon, "emoji" | "image_url" | "marker_background_color">; dark?: boolean; selected?: boolean; size?: "regular" | "large" }) {
  // The image the browser could not load; the emoji takes its place, as it does in the apps.
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const fallback = dark ? DEFAULT_EVENT_PIN_COLOR_DARK : DEFAULT_EVENT_PIN_COLOR;
  const color = icon.marker_background_color !== null && validEventPinColor(icon.marker_background_color) ? icon.marker_background_color : fallback;
  const outline = eventPinOutline(color);
  const image = icon.image_url !== null && icon.image_url !== failedImage ? icon.image_url : null;
  const style = { "--event-pin-color": color, "--event-pin-stroke": outline.stroke, "--event-pin-ring": outline.ring,
    "--event-pin-plate": outline.light ? outline.ring : "transparent" } as CSSProperties;
  return (
    <span className={`dates-event-icon-pin${size === "large" ? " large" : ""}${selected ? " selected" : ""}`} style={style} aria-hidden="true">
      <svg viewBox="0 0 48 60" focusable="false"><path d="M24 57.5C20 53.5 2.5 34 2.5 24a21.5 21.5 0 1 1 43 0c0 10-17.5 29.5-21.5 33.5Z" /></svg>
      <span className="dates-event-icon-art">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {image ? <img src={image} alt="" onError={() => setFailedImage(image)} /> : icon.emoji.trim()}
      </span>
    </span>
  );
}

function UploadGlyph() {
  return <svg className="dates-event-glyph" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 13V3.5M10 3.5 6.5 7M10 3.5 13.5 7M3.5 12.5V15A1.5 1.5 0 0 0 5 16.5h10a1.5 1.5 0 0 0 1.5-1.5v-2.5" /></svg>;
}
function PlusGlyph() {
  return <svg className="dates-event-glyph" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 4v12M4 10h12" /></svg>;
}

export default function DatesEventIconsConfiguration({ canManage, onHoldChange }: {
  canManage: boolean;
  /** Told whenever the editor starts or stops holding unsaved edits or a save in doubt, so that the page does not unmount it. */
  onHoldChange?: (hold: boolean) => void;
}) {
  const t = useTranslations("datesAdmin.eventIcons"), common = useTranslations("common"), locale = useLocale();
  const [state, dispatch] = useReducer(eventIconEditorReducer, EVENT_ICON_EDITOR_INITIAL);
  const [filter, setFilter] = useState<"all" | ActivityType>("all");
  // What is typed into the HEX field while it is not a colour yet. The icon keeps its last colour meanwhile.
  const [hexDraft, setHexDraft] = useState<{ key: string; text: string } | null>(null);
  // The icon whose Custom mode is open although no custom colour is chosen yet.
  const [customOpen, setCustomOpen] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null), defaultMode = useRef<HTMLInputElement>(null);
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
  // A new catalogue (a read or a receipt) ends every half-typed value.
  useEffect(() => { setHexDraft(null); setCustomOpen(null); setUploadError(null); }, [state.revision, state.baseline]);

  const problems = useMemo(() => eventIconProblems(state.icons), [state.icons]);
  const current = state.icons.find(icon => icon.key === state.selected);
  const iconName = (icon: DatesEventIcon) => (locale === "hu" ? icon.name_hu : icon.name_en).trim() || (locale === "hu" ? icon.name_en : icon.name_hu).trim() || t("untitled");
  const locked = !canManage || state.busy || state.pending !== null;
  const hexText = current && hexDraft?.key === current.key ? hexDraft.text : current?.marker_background_color ?? "";
  const hexInvalid = current !== undefined && hexDraft?.key === current.key && hexDraft.text.trim() !== "" && eventPinColorFromInput(hexDraft.text) === null;
  const block = eventIconSaveBlock(state, canManage, hexInvalid);
  const dirty = eventIconDirty(state);

  function select(key: string) {
    dispatch({ type: "selected", key });
    setHexDraft(null); setCustomOpen(null); setUploadError(null);
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
    setHexDraft(null); setCustomOpen(null); setUploadError(null);
  }
  async function upload(file?: File) {
    if (!file || !current) return;
    const key = current.key;
    if (file.type !== "image/png" || file.size === 0 || file.size > MAX_ICON_IMAGE_BYTES) { setUploadError(key); return; }
    dispatch({ type: "requestStarted" });
    const response = await adminUploadProfileIcon(file);
    dispatch({ type: "requestFinished" });
    if (!response?.success || !eventIconImageURL(response.media_url)) { setUploadError(key); return; }
    setUploadError(null);
    dispatch({ type: "edited", key, patch: { image_url: response.media_url } });
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
  function setDefaultColor(moveFocus: boolean) {
    edit({ marker_background_color: null });
    setHexDraft(null); setCustomOpen(null);
    // The control that was used disappears with the Custom mode; the keyboard goes to the mode switch.
    if (moveFocus) defaultMode.current?.focus();
  }
  function typeHex(text: string) {
    if (!current) return;
    setHexDraft({ key: current.key, text });
    setCustomOpen(current.key);
    const color = eventPinColorFromInput(text);
    if (color !== null) edit({ marker_background_color: color });
    else if (text.trim() === "") edit({ marker_background_color: null });
  }

  const visible = state.icons.filter(icon => filter === "all" || icon.activity_type === filter);
  const body = state.revision !== null && current ? renderBody(state, current) : null;

  function renderBody(loaded: EventIconEditorState, icon: DatesEventIcon) {
    const own = new Map<EventIconField, string>(problems.filter(problem => problem.key === icon.key)
      .map(problem => [problem.field, t(`problems.${problem.field}.${problem.code}`, { max: problem.field === "order" ? EVENT_ICON_ORDER_MAX : EVENT_ICON_NAME_MAX })]));
    const elsewhere = [...new Map(problems.filter(problem => problem.key !== icon.key).map(problem => [`${problem.key}:${problem.field}`, problem])).values()];
    const broken = new Set(problems.map(problem => problem.key));
    const known = loaded.knownKeys.includes(icon.key);
    const custom = icon.marker_background_color !== null || customOpen === icon.key;
    const field = (name: string) => `${id}-${name}`;
    const errorOf = (name: EventIconField) => own.has(name) ? field(`${name}-error`) : undefined;
    const fieldError = (name: EventIconField) => own.has(name) && <p id={field(`${name}-error`)} className="dates-event-icon-error">{own.get(name)}</p>;
    const described = (...ids: (string | undefined | false)[]) => ids.filter(Boolean).join(" ") || undefined;
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
              <div className="dates-event-icon-row">
                <label htmlFor={field("emoji")}>{t("emoji")}</label>
                <div>
                  <div className="dates-event-emoji-line">
                    <input id={field("emoji")} className="dates-event-emoji-input" value={icon.emoji} maxLength={32} autoComplete="off" spellCheck={false}
                      aria-invalid={own.has("emoji")} aria-describedby={described(errorOf("emoji"), field("image-hint"))} onChange={event => edit({ emoji: event.target.value })} />
                    {icon.image_url !== null && (
                      <span className="dates-event-image-thumb" role="img" aria-label={t("imageUploaded")}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={icon.image_url} alt="" />
                      </span>
                    )}
                    <button type="button" className="button dates-event-outline-button" aria-describedby={described(uploadError === icon.key && field("image-error"), field("image-hint"))}
                      onClick={() => fileInput.current?.click()}>
                      <UploadGlyph />{t("image")}
                    </button>
                    <input ref={fileInput} type="file" accept="image/png" hidden tabIndex={-1} aria-hidden="true"
                      onChange={event => { void upload(event.target.files?.[0]); event.target.value = ""; }} />
                  </div>
                  {icon.image_url !== null && <button type="button" className="dates-event-link" onClick={() => edit({ image_url: null })}>{t("removeImage")}</button>}
                  {fieldError("emoji")}
                  {uploadError === icon.key && <p id={field("image-error")} className="dates-event-icon-error" role="alert">{t("imageError")}</p>}
                  <small id={field("image-hint")} className="dates-event-icon-hint">{t("imageHint")}</small>
                </div>
              </div>
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

              <div className="dates-event-pin-colors">
                <h4 id={field("color")}>{t("colorTitle")}</h4>
                <div className="dates-event-segmented" role="radiogroup" aria-labelledby={field("color")}>
                  <label>
                    <input ref={defaultMode} type="radio" name={field("mode")} checked={!custom} onChange={() => setDefaultColor(false)} />
                    <span>{t("colorModeDefault")}</span>
                  </label>
                  <label>
                    <input type="radio" name={field("mode")} checked={custom} onChange={() => setCustomOpen(icon.key)} />
                    <span>{t("colorModeCustom")}</span>
                  </label>
                </div>
                {custom ? <>
                  <div className="dates-event-color-inputs">
                    <input className="dates-event-hex-input" value={hexText} maxLength={9} placeholder="#RRGGBB" spellCheck={false} autoComplete="off" autoCapitalize="characters"
                      aria-label={t("colorHex")} aria-invalid={hexInvalid || own.has("marker_background_color")} aria-describedby={hexInvalid ? field("hex-error") : errorOf("marker_background_color")}
                      onChange={event => typeHex(event.target.value)} onBlur={() => { if (!hexInvalid) setHexDraft(null); }} />
                    <input type="color" aria-label={t("colorPicker")} value={(icon.marker_background_color !== null && validEventPinColor(icon.marker_background_color) ? icon.marker_background_color : DEFAULT_EVENT_PIN_COLOR).toLowerCase()}
                      onChange={event => { setHexDraft(null); setCustomOpen(icon.key); edit({ marker_background_color: event.target.value.toUpperCase() }); }} />
                  </div>
                  {hexInvalid ? <p id={field("hex-error")} className="dates-event-icon-error">{t("colorInvalid")}</p> : fieldError("marker_background_color")}
                  <div className="dates-event-color-quick">
                    <div className="dates-event-color-swatches" role="group" aria-label={t("colorSwatches")}>
                      {SWATCHES.map(swatch => (
                        <button key={swatch.name} type="button" aria-label={t(`swatches.${swatch.name}`)} title={t(`swatches.${swatch.name}`)}
                          aria-pressed={!hexInvalid && icon.marker_background_color === swatch.color}
                          onClick={() => { if (swatch.color === null) setDefaultColor(true); else { setHexDraft(null); edit({ marker_background_color: swatch.color }); } }}>
                          <span style={{ "--event-pin-color": swatch.shown } as CSSProperties} />
                        </button>
                      ))}
                    </div>
                    <div className="dates-event-color-reset">
                      <button type="button" className="dates-event-link" onClick={() => setDefaultColor(true)}>{t("colorReset")}</button>
                      <small>{t("colorBase", { color: DEFAULT_EVENT_PIN_COLOR })}</small>
                    </div>
                  </div>
                </> : <small className="dates-event-icon-hint">{t("colorDefaultHint", { day: DEFAULT_EVENT_PIN_COLOR, night: DEFAULT_EVENT_PIN_COLOR_DARK })}</small>}
              </div>

              <div className="dates-event-pin-previews-block">
                <h4>{t("colorPreview")}</h4>
                <div className="dates-event-pin-previews">
                  {([false, true] as const).map(dark => (
                    <div key={String(dark)} className={`dates-event-pin-preview ${dark ? "night" : "day"}`} role="img" aria-label={t(dark ? "colorPreviewNight" : "colorPreviewDay")}>
                      <span className="dates-event-pin-preview-pins"><EventIconPin icon={icon} dark={dark} /><EventIconPin icon={icon} dark={dark} selected /></span>
                      <span className="dates-event-pin-preview-chip">{t(dark ? "colorNight" : "colorDay")}</span>
                    </div>
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
