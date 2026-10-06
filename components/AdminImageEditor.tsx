"use client";

import { adminMembershipRefusalForUi } from "@/lib/adminMembershipClientError";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { adminCall } from "@/lib/adminClient";
import {
  clampCropZoom, cropGeometry, INITIAL_CROP, MAX_CROP_ZOOM, MIN_CROP_ZOOM,
  panCrop, pinchCrop, squareCropInOriginalSpace,
  type CropPoint, type CropTransform,
} from "@/lib/imageEditorGeometry";

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
  const dialogRef = useRef<HTMLElement>(null);
  const pointersRef = useRef(new Map<number, CropPoint>());
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  const savingRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [transform, setTransform] = useState<CropTransform>(INITIAL_CROP);
  const { zoom, rotation } = transform;
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
    const { scale, offsetX, offsetY } = cropGeometry(
      { width: image.naturalWidth, height: image.naturalHeight }, canvas, transform,
    );

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
  }, [rotation, transform]);

  useEffect(() => {
    draw();
  }, [draw, ready]);

  useEffect(() => {
    let cancelled = false;
    imageRef.current = null;
    pointersRef.current.clear();
    setReady(false);
    setLoadError("");
    setSaveError("");
    setOriginalSize(null);
    setTransform(INITIAL_CROP);
    (async () => {
      const response = await adminCall("admin_get_image_data", { uid, image_id: imageId });
      if (cancelled) return;
      const dataUrl = typeof response?.data_url === "string" ? response.data_url : "";
      if (response?.success !== true || !dataUrl.startsWith("data:image/")) {
        setLoadError(typeof response?.error === "string" ? response.error : "load-failed");
        return;
      }
      if (
        typeof response.width === "number" && Number.isSafeInteger(response.width) && response.width >= 50
        && typeof response.height === "number" && Number.isSafeInteger(response.height) && response.height >= 50
      ) {
        setOriginalSize({ width: response.width, height: response.height });
      } else if (isSquare) {
        // A resized bitmap is not an authority for original-space crop coordinates.
        setLoadError("image-dimensions-unknown");
        return;
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
  }, [imageId, uid, isSquare]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !savingRef.current) {
        event.preventDefault();
        cancel.current();
      } else if (event.key === "Tab") {
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
        ) ?? []);
        const first = controls[0];
        const last = controls.at(-1);
        if (!first) {
          event.preventDefault();
          dialogRef.current?.focus();
        } else if (!dialogRef.current?.contains(document.activeElement)
          || (event.shiftKey && document.activeElement === first)
          || (!event.shiftKey && document.activeElement === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, []);

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!ready || busy || event.button !== 0 || pointersRef.current.size >= 2) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const pointers = pointersRef.current;
    const start = pointers.get(event.pointerId);
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!start || !canvas || !image || !ready || busy) return;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const before = Array.from(pointers.values());
    const end = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, end);
    const after = Array.from(pointers.values());
    const imageSize = { width: image.naturalWidth, height: image.naturalHeight };
    if (before.length === 2) {
      const inCanvas = (point: CropPoint) => ({
        x: (point.x - bounds.left) * canvas.width / bounds.width,
        y: (point.y - bounds.top) * canvas.height / bounds.height,
      });
      setTransform((value) => pinchCrop(imageSize, canvas, value,
        [inCanvas(before[0]), inCanvas(before[1])], [inCanvas(after[0]), inCanvas(after[1])],
      ));
    } else {
      setTransform((value) => panCrop(imageSize, canvas, bounds, value, { x: end.x - start.x, y: end.y - start.y }));
    }
  }

  function onPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function reset() {
    pointersRef.current.clear();
    setTransform(INITIAL_CROP);
  }

  function rotate(degrees: number) {
    pointersRef.current.clear();
    setTransform((value) => ({ ...value, rotation: (value.rotation + degrees + 360) % 360 }));
  }

  function onCanvasKeyDown(event: React.KeyboardEvent<HTMLCanvasElement>) {
    if (!ready || busy || !imageRef.current) return;
    const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key];
    if (!delta) return;
    event.preventDefault();
    const imageSize = { width: imageRef.current.naturalWidth, height: imageRef.current.naturalHeight };
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    setTransform((value) => panCrop(imageSize, canvas, bounds, value, { x: delta[0], y: delta[1] }));
  }

  async function save() {
    const canvas = canvasRef.current;
    if (!canvas || !ready || savingRef.current) return;
    savingRef.current = true;
    pointersRef.current.clear();
    setBusy(true);
    setSaveError("");
    if (isSquare) {
      const image = imageRef.current;
      const crop = image && originalSize ? squareCropInOriginalSpace(
        { width: image.naturalWidth, height: image.naturalHeight }, canvas, originalSize, transform,
      ) : null;
      if (!crop) {
        setSaveError("encode-failed");
        savingRef.current = false;
        setBusy(false);
        return;
      }
      const response = await adminCall("set_image_square_crop", {
        uid,
        image_id: imageId,
        x: crop.x,
        y: crop.y,
        size: crop.size,
      }).catch(adminMembershipRefusalForUi);
      savingRef.current = false;
      setBusy(false);
      if (response?.success !== true) {
        setSaveError(typeof response?.error === "string" ? response.error : "save-failed");
        return;
      }
      onSaved();
      return;
    }
    let encoded: string;
    try {
      draw();
      encoded = canvas.toDataURL("image/jpeg", 0.92);
    } catch {
      setSaveError("encode-failed");
      savingRef.current = false;
      setBusy(false);
      return;
    }
    const response = await adminCall("admin_replace_image", {
      uid,
      image_id: imageId,
      image_b64: encoded,
    }).catch(adminMembershipRefusalForUi);
    savingRef.current = false;
    setBusy(false);
    if (response?.success !== true) {
      setSaveError(typeof response?.error === "string" ? response.error : "save-failed");
      return;
    }
    onSaved();
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="dialog-backdrop image-editor-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="dialog image-editor-dialog"
        role="dialog"
        tabIndex={-1}
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
              onLostPointerCapture={(event) => pointersRef.current.delete(event.pointerId)}
              onKeyDown={onCanvasKeyDown}
              tabIndex={ready && !busy ? 0 : -1}
              aria-label={t("canvasLabel")}
            />
            {!ready && !loadError ? <span>{common("loading")}</span> : null}
          </div>

          <div className="image-editor-controls">
            <label>
              <span>{t("zoom")}</span>
              <input
                type="range"
                min={MIN_CROP_ZOOM}
                max={MAX_CROP_ZOOM}
                step="0.01"
                value={zoom}
                disabled={!ready || busy}
                onChange={(event) => setTransform((value) => ({ ...value, zoom: clampCropZoom(Number(event.target.value)) }))}
              />
              <output>{Math.round(zoom * 100)}%</output>
            </label>
            <div className="image-editor-buttons">
              <button
                type="button"
                className="button button-secondary"
                disabled={!ready || busy || zoom <= MIN_CROP_ZOOM}
                onClick={() => setTransform((value) => ({ ...value, zoom: clampCropZoom(value.zoom - ZOOM_STEP) }))}
              >
                {t("zoomOut")}
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={!ready || busy || zoom >= MAX_CROP_ZOOM}
                onClick={() => setTransform((value) => ({ ...value, zoom: clampCropZoom(value.zoom + ZOOM_STEP) }))}
              >
                {t("zoomIn")}
              </button>
              {isSquare ? null : (
                <>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={!ready || busy}
                    onClick={() => rotate(-90)}
                  >
                    {t("rotateLeft")}
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={!ready || busy}
                    onClick={() => rotate(90)}
                  >
                    {t("rotate")}
                  </button>
                </>
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
    </div>,
    document.body,
  );
}
