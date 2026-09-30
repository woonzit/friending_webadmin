"use client";

import React, { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  APPEARANCE_MAP_FRAME_PATH, appearanceMapMoveAccepted, googleMapsBrowserKey,
  isTrustedAppearanceMapEvent, parseAppearanceMapFrameMessage,
  type AppearanceMapCenter, type AppearanceMapParentMessage,
} from "@/lib/appearanceMap";

/** Reuses the isolated map document, without claiming a city search verified a venue. */
export default function DatesExternalVenueMap({ center, disabled, onMove }: {
  center: AppearanceMapCenter | null; disabled: boolean; onMove: (center: AppearanceMapCenter) => void;
}) {
  const t = useTranslations("datesAdmin.external.form");
  const locale = useLocale();
  const language = locale === "hu" ? "hu" : "en";
  const frame = useRef<HTMLIFrameElement>(null);
  const [readyGeneration, setReadyGeneration] = useState(0);
  const hasKey = googleMapsBrowserKey() !== "";
  const disabledRef = useRef(disabled);
  const onMoveRef = useRef(onMove);
  disabledRef.current = disabled;
  onMoveRef.current = onMove;

  useEffect(() => {
    if (!hasKey) return;
    function receive(event: MessageEvent) {
      if (!isTrustedAppearanceMapEvent(event, window.location.origin, frame.current?.contentWindow)) return;
      const message = parseAppearanceMapFrameMessage(event.data);
      if (!message) return;
      if (message.type === "friending.appearance-map.ready") { setReadyGeneration((current) => current + 1); return; }
      const moved = appearanceMapMoveAccepted(message, disabledRef.current);
      if (moved) onMoveRef.current(moved);
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [hasKey]);

  useEffect(() => {
    if (!hasKey || readyGeneration === 0) return;
    const message: AppearanceMapParentMessage = { type: "friending.appearance-map.set", center, radiusKm: null, language };
    frame.current?.contentWindow?.postMessage(message, window.location.origin);
  }, [hasKey, readyGeneration, center, language]);

  return <div className="appearance-map-picker field-full">
    <p className="field-hint">{t("mapHint")}</p>
    {hasKey ? <div className="appearance-map-embed"><iframe key={language} ref={frame} className={`appearance-map-iframe${disabled ? " is-disabled" : ""}`}
      src={APPEARANCE_MAP_FRAME_PATH} title={t("mapTitle")} sandbox="allow-scripts allow-same-origin"
      referrerPolicy="strict-origin-when-cross-origin" loading="lazy"
      tabIndex={disabled ? -1 : 0} aria-disabled={disabled} /></div> : <p className="alert alert-info">{t("mapUnavailable")}</p>}
  </div>;
}
