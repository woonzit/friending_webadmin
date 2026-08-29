"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { adminCall } from "@/lib/adminClient";
import {
  APPEARANCE_MAP_FRAME_PATH,
  googleMapsBrowserKey,
  appearanceMapMoveAccepted,
  isTrustedAppearanceMapEvent,
  parseAppearanceMapFrameMessage,
  type AppearanceMapCenter,
  type AppearanceMapLanguage,
  type AppearanceMapParentMessage,
} from "@/lib/appearanceMap";
import {
  appearanceTrim,
  decodeAppearanceGeocodeResponse,
  MAX_APPEARANCE_GEOCODE_QUERY_LENGTH,
  type AppearanceGeocodeCandidate,
} from "@/lib/appearanceRules";

type Props = {
  center: AppearanceMapCenter | null;
  radiusKm: number | null;
  language: AppearanceMapLanguage;
  disabled: boolean;
  onMove: (center: AppearanceMapCenter) => void;
  onCandidate: (candidate: AppearanceGeocodeCandidate) => void;
};

/**
 * City search (Core geocode endpoint) plus the embedded map document. The map
 * is optional: without a build-time browser key the notice replaces the frame
 * and the coordinate/radius inputs in the editor remain the way to set a place.
 */
export default function AppearanceMapPicker({ center, radiusKm, language, disabled, onMove, onCandidate }: Props) {
  const t = useTranslations("appearance.map");
  const hasKey = googleMapsBrowserKey() !== "";
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<AppearanceGeocodeCandidate[] | null>(null);
  const [searchError, setSearchError] = useState("");
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  // Finding 23: the handler reads the CURRENT lock state, never a captured prop.
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  useEffect(() => {
    if (!hasKey) return;
    function onMessage(event: MessageEvent) {
      const frameWindow = frameRef.current?.contentWindow;
      if (!isTrustedAppearanceMapEvent(event, window.location.origin, frameWindow)) return;
      const message = parseAppearanceMapFrameMessage(event.data);
      if (!message) return;
      if (message.type === "friending.appearance-map.ready") {
        setFrameReady(true);
        return;
      }
      const center = appearanceMapMoveAccepted(message, disabledRef.current);
      if (!center) return;
      onMoveRef.current(center);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [hasKey]);

  useEffect(() => {
    if (!hasKey || !frameReady) return;
    const frameWindow = frameRef.current?.contentWindow;
    if (!frameWindow) return;
    const message: AppearanceMapParentMessage = {
      type: "friending.appearance-map.set",
      center,
      radiusKm,
      language,
    };
    frameWindow.postMessage(message, window.location.origin);
  }, [hasKey, frameReady, center, radiusKm, language]);

  async function search() {
    const trimmed = appearanceTrim(query);
    if (!trimmed || searching) return;
    setSearching(true);
    setSearchError("");
    setCandidates(null);
    const response = await adminCall("appearance_city_geocode", { query: trimmed.slice(0, MAX_APPEARANCE_GEOCODE_QUERY_LENGTH), lang: language });
    setSearching(false);
    const decoded = decodeAppearanceGeocodeResponse(response);
    if (!decoded.ok) {
      setSearchError(decoded.kind === "refused" && decoded.error === "admin-write-required" ? t("searchForbidden") : t("searchError"));
      return;
    }
    setCandidates(decoded.value);
  }

  return (
    <div className="appearance-map-picker field-full">
      <div className="appearance-map-search">
        <label className="field">
          <span>{t("searchLabel")}</span>
          <input
            value={query}
            maxLength={MAX_APPEARANCE_GEOCODE_QUERY_LENGTH}
            disabled={disabled || searching}
            placeholder={t("searchPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void search();
              }
            }}
          />
          <small className="field-hint">{t("searchHint")}</small>
        </label>
        <button
          type="button"
          className="button button-secondary"
          disabled={disabled || searching || appearanceTrim(query) === ""}
          onClick={() => void search()}
        >
          {searching ? t("searching") : t("searchButton")}
        </button>
      </div>
      {searchError && <div className="alert alert-error" role="alert">{searchError}</div>}
      {candidates && (
        candidates.length === 0 ? (
          <p className="appearance-map-no-results">{t("noResults")}</p>
        ) : (
          <ul className="appearance-map-candidates" aria-label={t("candidatesLabel")}>
            {candidates.map((candidate) => (
              <li key={candidate.place_id}>
                <button
                  type="button"
                  className="appearance-map-candidate"
                  disabled={disabled}
                  onClick={() => {
                    onCandidate(candidate);
                    setCandidates(null);
                  }}
                >
                  <strong>{candidate.place_label}</strong>
                  <span>
                    {candidate.country_code ? `${candidate.country_code} · ` : ""}
                    {t("candidateGeometry", {
                      latitude: candidate.center.latitude.toFixed(4),
                      longitude: candidate.center.longitude.toFixed(4),
                      radius: candidate.radius_km,
                    })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}
      {hasKey ? (
        <div className="appearance-map-embed">
          <iframe
            ref={frameRef}
            className={`appearance-map-iframe${disabled ? " is-disabled" : ""}`}
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            src={APPEARANCE_MAP_FRAME_PATH}
            title={t("mapLabel")}
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="strict-origin-when-cross-origin"
            loading="lazy"
          />
          <small className="field-hint">{t("mapHint")}</small>
        </div>
      ) : (
        <div className="alert alert-info appearance-map-notice" role="status">
          <strong>{t("unavailableTitle")}</strong>
          <span>{t("unavailable")}</span>
        </div>
      )}
    </div>
  );
}
