"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import DatesExternalVenueMap from "@/components/DatesExternalVenueMap";
import DatesExternalPlaceSearch from "@/components/DatesExternalPlaceSearch";
import {
  DATES_EXTERNAL_CATEGORIES, DATES_EXTERNAL_FRESH_CONFIRMATIONS,
  datesExternalDraft, datesExternalDraftInput,
  type DatesExternalDraft, type DatesExternalManualEvent, type DatesExternalEditorInput,
} from "@/lib/datesExternalInput";

type TextField = { [K in keyof DatesExternalDraft]: DatesExternalDraft[K] extends string ? K : never }[keyof DatesExternalDraft];

export default function DatesExternalEventForm({ initial, disabled, submitLabel, onSubmit }: {
  initial?: DatesExternalManualEvent | DatesExternalEditorInput | null; disabled: boolean; submitLabel: string;
  onSubmit: (event: DatesExternalManualEvent, reason: string) => void | Promise<void>;
}) {
  const t = useTranslations("datesAdmin.external.form");
  const [draft, setDraft] = useState(() => datesExternalDraft(initial));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  function edit<K extends keyof DatesExternalDraft>(key: K, value: DatesExternalDraft[K]) {
    setDraft((current) => ({ ...current, ...DATES_EXTERNAL_FRESH_CONFIRMATIONS, [key]: value }));
    setError("");
  }
  function input(key: TextField, maximum: number, type = "text", required = false) {
    return <label className="field"><span>{t(key)}</span><input value={draft[key]} type={type} maxLength={maximum}
      required={required} onChange={(event) => edit(key, event.target.value as DatesExternalDraft[typeof key])} /></label>;
  }
  const latitude = draft.latitude.trim() === "" ? NaN : Number(draft.latitude);
  const longitude = draft.longitude.trim() === "" ? NaN : Number(draft.longitude);
  const center = Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Number.isFinite(longitude) && Math.abs(longitude) <= 180
    ? { latitude, longitude } : null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (disabled) return;
    const parsed = datesExternalDraftInput(draft);
    if (!parsed.ok) { setError(t(`errors.${parsed.error}`)); return; }
    if (reason.trim().length < 3) { setError(t("errors.reason")); return; }
    setError("");
    void onSubmit(parsed.event, reason.trim());
  }

  return <form className="dates-external-form" onSubmit={submit}>
    <fieldset className="dates-external-fields" disabled={disabled}>
      <legend>{t("factsTitle")}</legend>
      <p className="alert alert-info">{t("manualOnly")}</p>
      <div className="form-grid">
        {input("title", 32000, "text", true)}
        <label className="field"><span>{t("category")}</span><select value={draft.category} onChange={(event) => edit("category", event.target.value as DatesExternalDraft["category"])}>
          {DATES_EXTERNAL_CATEGORIES.map((category) => <option key={category} value={category}>{t(`categories.${category}`)}</option>)}
        </select></label>
        {(["summaryEn", "summaryHu"] as const).map((key) => <label className="field" key={key}><span>{t(key)}</span><textarea required value={draft[key]} rows={4} maxLength={32000} onChange={(event) => edit(key, event.target.value)} /></label>)}
        <label className="checkbox-field"><input type="checkbox" checked={draft.sensitive} onChange={(event) => edit("sensitive", event.target.checked)} /><span>{t("sensitive")}</span></label>
        {draft.sensitive && input("sensitiveReason", 32000, "text", true)}
        <label className="field"><span>{t("attendeeList")}</span><select value={draft.sensitive ? "count_only" : draft.attendeeList} disabled={disabled || draft.sensitive} onChange={(event) => edit("attendeeList", event.target.value as DatesExternalDraft["attendeeList"])}>
          <option value="visible">{t("attendeeVisible")}</option><option value="count_only">{t("attendeeCountOnly")}</option>
        </select><small>{t("sensitiveHint")}</small></label>
      </div>
      <h3>{t("timeTitle")}</h3>
      <p className="field-hint">{t("timeHint")}</p>
      <div className="form-grid">
        {input("timezone", 80, "text", true)}
        <label className="field"><span>{t("startLocal")}</span><input required type="datetime-local" step={1} value={draft.startLocal} onChange={(event) => edit("startLocal", event.target.value)} /></label>
        {input("startOffset", 6, "text", true)}
        <label className="field"><span>{t("endLocal")}</span><input type="datetime-local" step={1} value={draft.endLocal} onChange={(event) => edit("endLocal", event.target.value)} /></label>
        {input("endOffset", 6, "text", draft.endLocal !== "")}
        <label className="checkbox-field"><input type="checkbox" checked={draft.allDay} onChange={(event) => edit("allDay", event.target.checked)} /><span>{t("allDay")}</span></label>
      </div>
      <p className="field-hint">{t("endHint")}</p>
      <h3>{t("venueTitle")}</h3>
      <DatesExternalPlaceSearch disabled={disabled} onSelect={(place) => {
        if (disabled) return;
        setDraft((current) => ({ ...current, ...DATES_EXTERNAL_FRESH_CONFIRMATIONS,
          venueName: place.name, venueAddress: place.formatted_address, city: place.city, countryCode: place.country_code,
          latitude: String(place.latitude), longitude: String(place.longitude), timezone: place.timezone ?? current.timezone,
          startOffset: place.timezone && place.timezone !== current.timezone ? "" : current.startOffset,
          endOffset: place.timezone && place.timezone !== current.timezone ? "" : current.endOffset,
        }));
      }} />
      <div className="form-grid">
        {input("venueName", 32000, "text", true)}{input("venueAddress", 32000, "text", true)}
        {input("city", 32000, "text", true)}{input("countryCode", 2, "text", true)}
        {input("latitude", 24, "text", true)}{input("longitude", 24, "text", true)}
        <DatesExternalVenueMap center={center} disabled={disabled} onMove={(point) => {
          if (disabled) return;
          setDraft((current) => ({ ...current, ...DATES_EXTERNAL_FRESH_CONFIRMATIONS,
            latitude: String(point.latitude), longitude: String(point.longitude) }));
        }} />
      </div>
      <h3>{t("sourceTitle")}</h3>
      <div className="form-grid">
        {input("organizerName", 32000, "text", true)}{input("organizerWebsite", 2048, "url")}
        {input("sourceUrl", 2048, "url", true)}{input("officialUrl", 2048, "url", !draft.isFree)}{input("ticketUrl", 2048, "url")}
        <label className="checkbox-field"><input type="checkbox" checked={draft.isFree} onChange={(event) => edit("isFree", event.target.checked)} /><span>{t("isFree")}</span></label>
        {input("priceText", 32000)}{input("ageRestriction", 2)}
      </div>
      <p className="field-hint">{t("linksHint")}</p>
      <p className="alert alert-info">{t("imagePolicy")}</p>
      <h3>{t("confirmationsTitle")}</h3>
      <div className="dates-checkbox-stack">
        {(["confirmSource", "confirmPublicVenue", "confirmTimezone", "confirmContentSafe"] as const).map((key) =>
          <label className="checkbox-field" key={key}><input required type="checkbox" checked={draft[key]}
            onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.checked }))} /><span>{t(key)}</span></label>)}
      </div>
      <label className="field"><span>{t("reason")}</span><textarea required maxLength={1000} minLength={3} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <button type="submit" className="button button-primary">{submitLabel}</button>
    </fieldset>
  </form>;
}
