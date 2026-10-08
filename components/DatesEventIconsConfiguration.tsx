"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useLocale, useTranslations } from "next-intl";
import { adminCall, adminUploadProfileIcon } from "@/lib/adminClient";
import { createAdminIdempotencyKey } from "@/lib/datesAdmin";
import { DEFAULT_EVENT_PIN_COLOR, DEFAULT_EVENT_PIN_COLOR_DARK, eventIconCatalog, eventIconImageURL, eventIconSaveOutcome, validEventPinColor, type DatesEventIcon } from "@/lib/datesEventIcons";

type Command = { icons: string; expected_revision: number; reason: string; idempotency_key: string };

function EventIconPin({ icon, dark = false, selected = false }: { icon: DatesEventIcon; dark?: boolean; selected?: boolean }) {
  const fallback = dark ? DEFAULT_EVENT_PIN_COLOR_DARK : DEFAULT_EVENT_PIN_COLOR;
  const color = validEventPinColor(icon.marker_background_color) ? icon.marker_background_color ?? fallback : fallback;
  return <span className={`dates-event-icon-pin ${selected ? "selected" : ""}`} style={{ "--event-pin-color": color } as CSSProperties} aria-hidden="true">
    <svg viewBox="0 0 48 60" focusable="false"><path d="M24 58C20 54 2 34 2 24a22 22 0 1 1 44 0c0 10-18 30-22 34Z" /></svg>
    <span className="dates-event-icon-art">{icon.image_url ? <img src={icon.image_url} alt="" /> : icon.emoji}</span>
  </span>;
}

export default function DatesEventIconsConfiguration({ canManage }: { canManage: boolean }) {
  const t = useTranslations("datesAdmin.eventIcons"), common = useTranslations("common"), locale = useLocale();
  const [icons, setIcons] = useState<DatesEventIcon[]>([]), [revision, setRevision] = useState<number | null>(null);
  const [selected, setSelected] = useState(""), [reason, setReason] = useState(""), [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Command | null>(null), [dirty, setDirty] = useState(false);
  const knownKeys = useRef(new Set<string>());
  const load = useCallback(async () => {
    setBusy(true);
    const catalog = eventIconCatalog(await adminCall("dates_event_icons"));
    setBusy(false);
    if (!catalog) { setNotice(t("loadError")); return; }
    setIcons(catalog.icons); setRevision(catalog.revision); setSelected(catalog.icons[0]?.key ?? "");
    knownKeys.current = new Set(catalog.icons.map(i => i.key)); setPending(null); setDirty(false); setNotice("");
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  const current = icons.find(i => i.key === selected);
  const locked = !canManage || busy || pending !== null;
  const invalidColor = icons.some(icon => !validEventPinColor(icon.marker_background_color));
  function update(patch: Partial<DatesEventIcon>) {
    setDirty(true);
    setIcons(rows => rows.map(icon => {
      if (icon.key === selected) return { ...icon, ...patch,
        ...((patch.enabled === false || patch.activity_type) ? { is_default: false } : {}) };
      if (patch.is_default && icon.activity_type === current?.activity_type) return { ...icon, is_default: false };
      return icon;
    }));
    if (patch.key) setSelected(patch.key);
  }
  async function upload(file?: File) {
    if (!file) return;
    if (file.type !== "image/png" || file.size === 0 || file.size > 2 * 1024 * 1024) { setNotice(t("imageError")); return; }
    setBusy(true);
    const response = await adminUploadProfileIcon(file);
    setBusy(false);
    if (!response?.success || !eventIconImageURL(response.media_url)) { setNotice(t("imageError")); return; }
    update({ image_url: response.media_url }); setNotice("");
  }
  async function save() {
    if (revision === null || (!pending && invalidColor)) return;
    const command = pending ?? { icons: JSON.stringify(icons), expected_revision: revision, reason: reason.trim(), idempotency_key: createAdminIdempotencyKey("event-icons") };
    setPending(command); setBusy(true);
    const response = await adminCall("dates_event_icons_save", command);
    const { receipt, outcome } = eventIconSaveOutcome(response, command, pending !== null);
    setBusy(false);
    if (receipt) {
      setIcons(receipt.icons); setRevision(receipt.revision); knownKeys.current = new Set(receipt.icons.map(i => i.key));
      setPending(null); setDirty(false); setReason(""); setNotice(t("saved"));
    } else if (outcome.kind === "refused") { setPending(null); setNotice(t("refused", { error: outcome.error })); }
    else setNotice(t("unknown"));
  }
  return <section className="panel dates-section">
    <div className="panel-header"><div><h2>{t("title")}</h2><p>{t("copy")}</p></div>
      <button className="button button-secondary" disabled={busy || pending !== null} onClick={() => { if (!dirty || window.confirm(t("discard"))) void load(); }}>{common("refresh")}</button></div>
    {notice && <p className="alert alert-info" role="status">{notice}</p>}
    {revision !== null && <div className="dates-event-icons-body">
      <div className="row-actions"><label className="field"><span>{t("type")}</span><select value={filter} onChange={e => setFilter(e.target.value)}>
        {["all", "sport", "travel", "hangout"].map(type => <option key={type} value={type}>{type === "all" ? common("all") : t(`types.${type}`)}</option>)}</select></label>
        <button className="button button-secondary" disabled={locked || icons.length >= 128} onClick={() => {
          const key = `icon_${crypto.randomUUID().slice(0, 8)}`;
          setIcons(rows => [...rows, { key, activity_type: "hangout", emoji: "☕", image_url: null, marker_background_color: null, name_en: "", name_hu: "", enabled: true, is_default: false, order: Math.min(100000, Math.max(...rows.map(i => i.order)) + 10) }]);
          setSelected(key); setFilter("all"); setDirty(true);
        }}>{t("add")}</button></div>
      <div className="dates-event-icons-layout">
        <div className="dates-event-icons-grid" role="group" aria-label={t("title")}>{icons.filter(i => filter === "all" || i.activity_type === filter).map(icon =>
          <button key={icon.key} className={`dates-event-icon-choice ${icon.key === selected ? "active" : ""}`} disabled={busy} aria-pressed={icon.key === selected} onClick={() => setSelected(icon.key)}>
            <EventIconPin icon={icon} />
            <strong>{(locale === "hu" ? icon.name_hu : icon.name_en) || icon.key}</strong>
            <small>{t(`types.${icon.activity_type}`)} · {icon.enabled ? common("enabled") : common("disabled")}{icon.is_default ? ` · ${t("default")}` : ""}</small>
            <small>{t(icon.marker_background_color === null ? "colorDefault" : "colorCustom")}</small>
          </button>)}</div>
        {current && <fieldset className="dates-event-icon-editor" disabled={locked}>
          <legend>{t("edit")}</legend>
          <label className="field"><span>{t("key")}</span><input value={current.key} readOnly /></label>
          <label className="field"><span>{t("type")}</span><select value={current.activity_type} disabled={knownKeys.current.has(current.key)} onChange={e => update({ activity_type: e.target.value as DatesEventIcon["activity_type"] })}>
            {["sport", "travel", "hangout"].map(type => <option key={type} value={type}>{t(`types.${type}`)}</option>)}</select></label>
          <label className="field"><span>{t("nameEn")}</span><input value={current.name_en} maxLength={60} onChange={e => update({ name_en: e.target.value })} /></label>
          <label className="field"><span>{t("nameHu")}</span><input value={current.name_hu} maxLength={60} onChange={e => update({ name_hu: e.target.value })} /></label>
          <label className="field"><span>{t("emoji")}</span><input value={current.emoji} maxLength={32} onChange={e => update({ emoji: e.target.value })} /></label>
          <label className="field"><span>{t("image")}</span><input type="file" accept="image/png" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ""; }} /><small>{t("imageHint")}</small></label>
          {current.image_url && <button className="button button-secondary" onClick={() => update({ image_url: null })}>{t("removeImage")}</button>}
          <div className="dates-event-pin-colors">
            <strong>{t("colorTitle")}</strong>
            <div className="dates-event-color-modes" role="group" aria-label={t("colorTitle")}>
              <button type="button" className="button button-secondary" aria-pressed={current.marker_background_color === null} onClick={() => update({ marker_background_color: null })}>{t("colorDefault")}</button>
              <button type="button" className="button button-secondary" aria-pressed={current.marker_background_color !== null} onClick={() => update({ marker_background_color: current.marker_background_color ?? DEFAULT_EVENT_PIN_COLOR })}>{t("colorCustom")}</button>
            </div>
            {current.marker_background_color !== null && <>
              <div className="dates-event-color-inputs">
                <label className="field"><span>{t("colorHex")}</span><input value={current.marker_background_color} maxLength={7} spellCheck={false} autoComplete="off"
                  aria-invalid={!validEventPinColor(current.marker_background_color)} onChange={e => update({ marker_background_color: e.target.value.toUpperCase() })} /></label>
                <label className="field"><span>{t("colorPicker")}</span><input type="color" value={validEventPinColor(current.marker_background_color) ? current.marker_background_color : DEFAULT_EVENT_PIN_COLOR}
                  onChange={e => update({ marker_background_color: e.target.value.toUpperCase() })} /></label>
              </div>
              {!validEventPinColor(current.marker_background_color) && <p className="field-error" role="alert">{t("colorInvalid")}</p>}
              <div className="dates-event-color-swatches" role="group" aria-label={t("colorSwatches")}>
                {[DEFAULT_EVENT_PIN_COLOR, "#8A72D8", "#2B9D8F", "#E47768", "#E6B640"].map(color => <button key={color} type="button" aria-label={color}
                  aria-pressed={current.marker_background_color === color} style={{ "--event-pin-color": color } as CSSProperties} onClick={() => update({ marker_background_color: color })} />)}
              </div>
              <button type="button" className="button button-secondary" onClick={() => update({ marker_background_color: null })}>{t("colorReset")}</button>
            </>}
            <small>{t("colorHint")}</small>
            <strong>{t("colorPreview")}</strong>
            <div className="dates-event-pin-previews">{[false, true].map(dark => <div key={String(dark)} className={`dates-event-pin-preview ${dark ? "night" : "day"}`}>
              <span>{t(dark ? "colorNight" : "colorDay")}</span><div><EventIconPin icon={current} dark={dark} /><EventIconPin icon={current} dark={dark} selected /></div>
              <small>{t("colorPreviewStates")}</small>
            </div>)}</div>
          </div>
          <label className="field"><span>{t("order")}</span><input type="number" min="0" max="100000" value={current.order} onChange={e => update({ order: Number(e.target.value) })} /></label>
          <label className="dates-event-icon-check"><input type="checkbox" checked={current.enabled} onChange={e => update({ enabled: e.target.checked })} /> {common("enabled")}</label>
          <label className="dates-event-icon-check"><input type="checkbox" checked={current.is_default} disabled={!current.enabled} onChange={e => update({ is_default: e.target.checked })} /> {t("default")}</label>
        </fieldset>}
      </div>
      <div className="dates-event-icons-save"><label className="field"><span>{t("reason")}</span><input value={reason} maxLength={500} disabled={locked} onChange={e => setReason(e.target.value)} /></label>
        <button className="button button-primary" disabled={!canManage || busy || (!pending && (!dirty || invalidColor || reason.trim().length < 3))} onClick={() => void save()}>{busy ? common("saving") : pending ? t("retry") : common("save")}</button></div>
    </div>}
  </section>;
}
