"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { adminCall } from "@/lib/adminClient";

/**
 * Re-crops a member's picture and overwrites it.
 *
 * The source arrives from Core as a data URL rather than the public
 * img.friending.co URL on purpose: that host sends no `Access-Control-Allow-Origin`,
 * so a cross-origin <img> would taint the canvas and `toDataURL` would throw at
 * the very end, after the operator had done the work. A data URL is same-origin
 * by construction.
 *
 * The canvas is 4:5, matching the member-facing crop in Join, so a picture an
 * admin re-crops frames the same way as one the member cropped. Core fits the
 * result inside its variant boxes and preserves the aspect ratio, so this
 * choice is the console's to make.
 */

const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 900;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.15;

/**
 * `replace` overwrites the picture itself (the original behaviour). `square`
 * only re-frames the SQUARE THUMBNAIL: the crop box travels to Core in
 * original pixel space (`set_image_square_crop`) and the picture's pixels are
 * untouched. Rotation is disabled in square mode because the stored crop box
 * cannot express a rotated source.
 */
type EditorMode = "replace" | "square";

type Props = {
  uid: number;
  imageId: string;
  mode?: EditorMode;
  onCancel: () => void;
  onSaved: () => void;
};

export default function AdminImageEditor({ uid, imageId, mode = "replace", onCancel, onSaved }: Props) {
  const isSquare = mode === "square";
  const canvasWidth = CANVAS_WIDTH;
  const canvasHeight = isSquare ? CANVAS_WIDTH : CANVAS_HEIGHT;
  const t = useTranslations("imageEditor");
  const common = useTranslations("common");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [positionX, setPositionX] = useState(0);
  const [positionY, setPositionY] = useState(0);
  // Original pixel dimensions from Core: the loaded data URL may be a resized
  // variant, so the square crop is scaled back into original space on save.
  const [originalSize, setOriginalSize] = useState<{ width: number; height: number } | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const radians = (rotation * Math.PI) / 180;
    const swapped = Math.abs(rotation % 180) === 90;
    const effectiveWidth = swapped ? image.naturalHeight : image.naturalWidth;
    const effectiveHeight = swapped ? image.naturalWidth : image.naturalHeight;
    // Cover, never contain: the crop must not leave empty bars in a picture
    // that is about to become the member's public photo.
    const scale = Math.max(
      canvas.width / effectiveWidth,
      canvas.height / effectiveHeight,
    ) * zoom;
    const drawnWidth = effectiveWidth * scale;
    const drawnHeight = effectiveHeight * scale;
    // Pan is expressed as -1..1 of the overflow, so it cannot drag the image
    // off the canvas no matter the zoom or rotation.
    const offsetX = (positionX * Math.max(0, drawnWidth - canvas.width)) / 2;
    const offsetY = (positionY * Math.max(0, drawnHeight - canvas.height)) / 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2 + offsetX, canvas.height / 2 + offsetY);
    ctx.rotate(radians);
    ctx.drawImage(
      image,
      (-image.naturalWidth * scale) / 2,
      (-image.naturalHeight * scale) / 2,
      image.naturalWidth * scale,
      image.naturalHeight * scale,
    );
    ctx.restore();
  }, [positionX, positionY, rotation, zoom]);

  useEffect(() => {
    draw();
  }, [draw, ready]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await adminCall("admin_get_image_data", { uid, image_id: imageId });
      if (cancelled) return;
      const dataUrl = typeof response?.data_url === "string" ? response.data_url : "";
      if (!response?.success || !dataUrl.startsWith("data:image/")) {
        setLoadError(typeof response?.error === "string" ? response.error : "load-failed");
        return;
      }
      if (
        typeof response.width === "number" && response.width > 0
        && typeof response.height === "number" && response.height > 0
      ) {
        setOriginalSize({ width: response.width, height: response.height });
      }
      const image = new Image();
      image.onload = () => {
        if (cancelled) return;
        imageRef.current = image;
        setReady(true);
      };
      image.onerror = () => {
        if (!cancelled) setLoadError("load-failed");
      };
      image.src = dataUrl;
    })();
    return () => {
      cancelled = true;
    };
  }, [imageId, uid]);

  useEffect(() => {
    cancelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!ready || busy) return;
    dragRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const start = dragRef.current;
    const canvas = canvasRef.current;
    if (!start || !canvas) return;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    // Two CSS pixels of drag should move the image two canvas pixels, so the
    // delta is scaled by how much the canvas is shrunk on screen.
    setPositionX((value) => clamp(value - ((event.clientX - start.x) * 2) / bounds.width));
    setPositionY((value) => clamp(value - ((event.clientY - start.y) * 2) / bounds.height));
    dragRef.current = { x: event.clientX, y: event.clientY };
  }

  function onPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function reset() {
    setZoom(1);
    setRotation(0);
    setPositionX(0);
    setPositionY(0);
  }

  async function save() {
    const canvas = canvasRef.current;
    if (!canvas || !ready || busy) return;
    setBusy(true);
    setSaveError("");
    if (isSquare) {
      const crop = squareCropInOriginalSpace();
      if (!crop) {
        setSaveError("encode-failed");
        setBusy(false);
        return;
      }
      const response = await adminCall("set_image_square_crop", {
        uid,
        image_id: imageId,
        x: crop.x,
        y: crop.y,
        size: crop.size,
      });
      setBusy(false);
      if (!response?.success) {
        setSaveError(typeof response?.error === "string" ? response.error : "save-failed");
        return;
      }
      onSaved();
      return;
    }
    let encoded: string;
    try {
      encoded = canvas.toDataURL("image/jpeg", 0.92);
    } catch {
      setSaveError("encode-failed");
      setBusy(false);
      return;
    }
    const response = await adminCall("admin_replace_image", {
      uid,
      image_id: imageId,
      image_b64: encoded,
    });
    setBusy(false);
    if (!response?.success) {
      setSaveError(typeof response?.error === "string" ? response.error : "save-failed");
      return;
    }
    onSaved();
  }

  /**
   * Invert the draw() geometry (rotation is always 0 in square mode): the
   * visible canvas square maps to a source-space square, scaled from the
   * loaded bitmap into Core's original pixel space.
   */
  function squareCropInOriginalSpace(): { x: number; y: number; size: number } | null {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return null;
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (width < 1 || height < 1) return null;
    const scale = Math.max(canvas.width / width, canvas.height / height) * zoom;
    const drawnWidth = width * scale;
    const drawnHeight = height * scale;
    const offsetX = (positionX * Math.max(0, drawnWidth - canvas.width)) / 2;
    const offsetY = (positionY * Math.max(0, drawnHeight - canvas.height)) / 2;
    let x = width / 2 - (canvas.width / 2 + offsetX) / scale;
    let y = height / 2 - (canvas.height / 2 + offsetY) / scale;
    let size = canvas.width / scale;
    const factor = originalSize && originalSize.width > 0
      ? originalSize.width / width
      : 1;
    const boundWidth = originalSize?.width ?? width;
    const boundHeight = originalSize?.height ?? height;
    x = Math.round(x * factor);
    y = Math.round(y * factor);
    size = Math.round(size * factor);
    size = Math.max(50, Math.min(size, Math.min(boundWidth, boundHeight)));
    x = Math.max(0, Math.min(x, boundWidth - size));
    y = Math.max(0, Math.min(y, boundHeight - size));
    return { x, y, size };
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        className="dialog image-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-editor-title"
      >
        <div className="dialog-header">
          <h2 id="image-editor-title">{t(isSquare ? "squareTitle" : "title")}</h2>
          <button
            className="dialog-close"
            onClick={onCancel}
            disabled={busy}
            aria-label={common("close")}
          >
            ×
          </button>
        </div>

        <div className="dialog-body">
          <p className="page-subtitle">{t(isSquare ? "squareCopy" : "copy")}</p>

          {loadError ? (
            <p className="alert alert-error" role="alert">{t("loadError")}</p>
          ) : null}
          {saveError ? (
            <p className="alert alert-error" role="alert">{t("saveError")}</p>
          ) : null}

          <div className={`image-editor-stage${isSquare ? " is-square" : ""}`}>
            <canvas
              ref={canvasRef}
              width={canvasWidth}
              height={canvasHeight}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              aria-label={t("canvasLabel")}
            />
            {!ready && !loadError ? <span>{common("loading")}</span> : null}
          </div>

          <div className="image-editor-controls">
            <label>
              <span>{t("zoom")}</span>
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step="0.01"
                value={zoom}
                disabled={!ready || busy}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
            </label>
            <div className="image-editor-buttons">
              <button
                type="button"
                className="button button-secondary"
                disabled={!ready || busy || zoom <= MIN_ZOOM}
                onClick={() => setZoom((value) => clampZoom(value - ZOOM_STEP))}
              >
                {t("zoomOut")}
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={!ready || busy || zoom >= MAX_ZOOM}
                onClick={() => setZoom((value) => clampZoom(value + ZOOM_STEP))}
              >
                {t("zoomIn")}
              </button>
              {isSquare ? null : (
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={!ready || busy}
                  onClick={() => setRotation((value) => (value + 90) % 360)}
                >
                  {t("rotate")}
                </button>
              )}
              <button
                type="button"
                className="button button-secondary"
                disabled={!ready || busy}
                onClick={reset}
              >
                {t("reset")}
              </button>
            </div>
          </div>
        </div>

        <div className="dialog-actions">
          <button
            ref={cancelRef}
            className="button button-secondary"
            onClick={onCancel}
            disabled={busy}
          >
            {common("cancel")}
          </button>
          <button
            className="button button-primary"
            onClick={() => void save()}
            disabled={!ready || busy}
          >
            {busy ? common("working") : t(isSquare ? "squareSave" : "save")}
          </button>
        </div>
      </section>
    </div>
  );
}

function clamp(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}
