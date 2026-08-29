"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  APPEARANCE_MAP_DEFAULT_CENTER,
  appearanceMapOptions,
  APPEARANCE_MAP_READY_CALLBACK,
  googleMapsBrowserKey,
  googleMapsScriptUrl,
  isTrustedAppearanceMapEvent,
  parseAppearanceMapParentMessage,
  roundAppearanceCoordinate,
  type AppearanceMapCenter,
  type AppearanceMapFrameMessage,
  type AppearanceMapLanguage,
} from "@/lib/appearanceMap";

type Status = "loading" | "ready" | "unavailable" | "failed";

const ACCENT = "#007F91";

/**
 * Body of the `/appearance-map` document. It owns one map, one draggable
 * marker and one radius circle, and talks to the embedding editor only through
 * the closed message vocabulary in `lib/appearanceMap.ts`. Every inbound
 * message must come from this origin and from the embedding window.
 */
export default function AppearanceMapFrame({ language }: { language: AppearanceMapLanguage }) {
  const t = useTranslations("appearance.map");
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const shownRef = useRef<{ center: AppearanceMapCenter | null; radiusKm: number | null }>({ center: null, radiusKm: null });
  const [status, setStatus] = useState<Status>(() => (googleMapsBrowserKey() ? "loading" : "unavailable"));

  useEffect(() => {
    const key = googleMapsBrowserKey();
    const scriptUrl = googleMapsScriptUrl(key, language);
    if (!scriptUrl || !container.current) return;

    const parent = window.parent;
    const post = (message: AppearanceMapFrameMessage) => {
      if (parent && parent !== window) parent.postMessage(message, window.location.origin);
    };

    function show(center: AppearanceMapCenter | null, radiusKm: number | null) {
      const map = mapRef.current;
      const marker = markerRef.current;
      const circle = circleRef.current;
      if (!map || !marker || !circle) return;
      const shown = shownRef.current;
      const sameCenter = shown.center !== null && center !== null
        && shown.center.latitude === center.latitude && shown.center.longitude === center.longitude;
      const sameRadius = shown.radiusKm === radiusKm;
      if (sameCenter && sameRadius) return;
      shownRef.current = { center, radiusKm };
      const position = center
        ? { lat: center.latitude, lng: center.longitude }
        : { lat: APPEARANCE_MAP_DEFAULT_CENTER.latitude, lng: APPEARANCE_MAP_DEFAULT_CENTER.longitude };
      marker.setPosition(position);
      circle.setCenter(position);
      circle.setRadius(Math.max(0, (radiusKm ?? 0) * 1000));
      const bounds = radiusKm ? circle.getBounds() : null;
      if (bounds) {
        map.fitBounds(bounds, 24);
      } else {
        map.setCenter(position);
      }
    }

    function moved(latLng: google.maps.LatLng | null | undefined) {
      if (!latLng) return;
      const center = {
        latitude: roundAppearanceCoordinate(latLng.lat()),
        longitude: roundAppearanceCoordinate(latLng.lng()),
      };
      markerRef.current?.setPosition({ lat: center.latitude, lng: center.longitude });
      circleRef.current?.setCenter({ lat: center.latitude, lng: center.longitude });
      shownRef.current = { ...shownRef.current, center };
      post({ type: "friending.appearance-map.moved", center });
    }

    function onMessage(event: MessageEvent) {
      if (parent === window || !isTrustedAppearanceMapEvent(event, window.location.origin, parent)) return;
      const message = parseAppearanceMapParentMessage(event.data);
      if (!message) return;
      show(message.center, message.radiusKm);
    }

    const listeners: google.maps.MapsEventListener[] = [];
    const globalWindow = window as unknown as Record<string, unknown>;
    globalWindow[APPEARANCE_MAP_READY_CALLBACK] = () => {
      const element = container.current;
      if (!element) return;
      try {
        const start = { lat: APPEARANCE_MAP_DEFAULT_CENTER.latitude, lng: APPEARANCE_MAP_DEFAULT_CENTER.longitude };
        // Fixed dark colour scheme for the dark-only console (finding 18); options pinned in lib/appearanceMap.ts.
        const map = new google.maps.Map(element, appearanceMapOptions(start));
        const marker = new google.maps.Marker({ map, position: start, draggable: true, title: t("markerTitle") });
        const circle = new google.maps.Circle({
          map,
          center: start,
          radius: 0,
          strokeColor: ACCENT,
          strokeOpacity: 0.9,
          strokeWeight: 2,
          fillColor: ACCENT,
          fillOpacity: 0.12,
          clickable: false,
        });
        mapRef.current = map;
        markerRef.current = marker;
        circleRef.current = circle;
        listeners.push(marker.addListener("dragend", () => moved(marker.getPosition())));
        listeners.push(map.addListener("click", (event) => moved(event.latLng)));
        setStatus("ready");
        window.addEventListener("message", onMessage);
        post({ type: "friending.appearance-map.ready" });
      } catch {
        setStatus("failed");
      }
    };

    const script = document.createElement("script");
    script.src = scriptUrl;
    script.async = true;
    script.onerror = () => setStatus("failed");
    document.head.appendChild(script);

    return () => {
      window.removeEventListener("message", onMessage);
      listeners.forEach((listener) => listener.remove());
      delete globalWindow[APPEARANCE_MAP_READY_CALLBACK];
    };
    // The language is fixed per document load; the editor reloads the frame to change it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="appearance-map-frame" data-status={status}>
      <div className="appearance-map-canvas" ref={container} role="application" aria-label={t("mapLabel")} />
      {status !== "ready" && (
        <p className="appearance-map-status" role="status">
          {status === "loading" ? t("loading") : status === "unavailable" ? t("unavailable") : t("failed")}
        </p>
      )}
    </div>
  );
}
