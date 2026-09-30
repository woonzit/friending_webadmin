"use client";

import React, { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { adminCall } from "@/lib/adminClient";
import { datesExternalPlaceQuery, decodeDatesExternalPlaces, type DatesExternalPlace, type DatesExternalPlaces } from "@/lib/datesExternalAdmin";

export default function DatesExternalPlaceSearch({ disabled, onSelect }: { disabled: boolean; onSelect: (place: DatesExternalPlace) => void }) {
  const t = useTranslations("datesAdmin.external.places"), locale = useLocale();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<DatesExternalPlaces | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error" | "invalid">("idle");
  const generation = useRef(0), controller = useRef<AbortController | null>(null), locked = useRef(disabled);
  locked.current = disabled;
  useEffect(() => {
    ++generation.current; controller.current?.abort(); setState("idle"); setResult(null);
    return () => { ++generation.current; controller.current?.abort(); };
  }, [disabled, locale]);

  async function search() {
    if (locked.current) return;
    const current = ++generation.current;
    controller.current?.abort(); setResult(null);
    if (!datesExternalPlaceQuery(query)) { setState("invalid"); return; }
    const next = new AbortController(); controller.current = next; setState("loading");
    const response = await adminCall("dates_external_event_place_search", { query: query.trim(), language: locale === "hu" ? "hu" : "en" }, next.signal);
    if (next.signal.aborted || current !== generation.current || locked.current) return;
    const decoded = decodeDatesExternalPlaces(response);
    if (!decoded) { setState("error"); return; }
    setResult(decoded); setState("ready");
  }
  return <div className="dates-external-place-search">
    <div className="row-actions"><h4>{t("title")}</h4><span className="dates-external-google" translate="no">Google Maps</span></div>
    <p className="field-hint">{t("hint")}</p>
    <label className="field"><span>{t("query")}</span><input value={query} disabled={disabled} maxLength={32000}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }}
      onChange={(event) => { ++generation.current; controller.current?.abort(); setQuery(event.target.value); setResult(null); setState("idle"); }} /></label>
    <button type="button" className="button button-secondary" disabled={disabled || state === "loading"} onClick={() => void search()}>{t(state === "loading" ? "loading" : "search")}</button>
    <div aria-live="polite">
      {(state === "error" || state === "invalid") && <p className="field-hint">{t(state === "invalid" ? "invalid" : "unavailable")}</p>}
      {state === "ready" && result && (!result.available ? <p className="field-hint">{t(result.unavailable_reason === "rate_limited" ? "rateLimited" : "unavailable")}</p>
        : result.places.length === 0 ? <p>{t("empty")}</p> : <ul className="dates-external-place-results">{result.places.map((place) => <li key={place.place_id}>
          <strong>{place.name}</strong><p>{place.formatted_address} · {place.city} · {place.country_code}</p>
          {place.public_venue_warning && <p className="alert alert-info">{t("publicWarning")}</p>}
          {place.attributions.length > 0 && <p>{place.attributions.map((source, index) => <span key={`${source.uri}-${index}`}><a href={source.uri} target="_blank" rel="noopener noreferrer">{source.provider}</a>{index < place.attributions.length - 1 ? " · " : ""}</span>)}</p>}
          <button type="button" className="button button-secondary button-small" disabled={disabled} onClick={() => { if (!locked.current) onSelect(place); }}>{t("select")}</button>
        </li>)}</ul>)}
    </div>
  </div>;
}
