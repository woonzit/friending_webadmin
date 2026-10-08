"use client";

// The default import keeps the components renderable where JSX compiles to React.createElement (the test runner).
import React, { useCallback, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { adminUploadProfileIcon } from "@/lib/adminClient";
import {
  DEFAULT_EVENT_PIN_COLOR, DEFAULT_EVENT_PIN_COLOR_DARK, eventIconImageURL, eventPinColorFromInput, eventPinOutline, validEventPinColor,
} from "@/lib/datesEventIcons";

/**
 * What the two pin catalogue editors of AreYouIn -> Configuration share: the
 * pin itself, its map preview, the emoji / PNG field and the colour field.
 * (components/DatesEventIconsConfiguration.tsx: the member event icons;
 * components/DatesExternalPinsConfiguration.tsx: the third-party event types.)
 */

/** What a pin shows: the icon on its plate and the colour behind it (`null`: the default of its kind). */
export type PinArt = { emoji: string; image_url: string | null; marker_background_color: string | null };
/** A member event's pin is a teardrop; a third-party event's has a rounded-square head on the same pointer. */
export type PinShape = "member" | "external";
/**
 * The outlines, in a 48 x 60 box with the tip at the same point. The member
 * pin's head is a circle of diameter 43. The external pin's head is the
 * rounded square around that circle (corner radius 13, about 30 % of its
 * width), and below it the teardrop's own tip: the two lower curves are the
 * part of the member outline that lies outside the square.
 */
const PIN_OUTLINES: Record<PinShape, string> = {
  member: "M24 57.5C20 53.5 2.5 34 2.5 24a21.5 21.5 0 1 1 43 0c0 10-17.5 29.5-21.5 33.5Z",
  external: "M15.5 2.5h17a13 13 0 0 1 13 13v17a13 13 0 0 1-11.02 12.85C30.13 50.98 25.76 55.74 24 57.5C22.24 55.74 17.87 50.98 13.52 45.35A13 13 0 0 1 2.5 32.5v-17a13 13 0 0 1 13-13Z",
};

/**
 * A map pin as the apps draw it: the icon on a white plate, on the assigned
 * colour; the selected pin is larger and light. Without a colour of its own a
 * pin takes `defaultColor` when one is given (the third-party catalogue's, the
 * same by day and at night), else the member pins' orange of the mode.
 */
export function EventIconPin({ icon, dark = false, selected = false, size = "regular", shape = "member", defaultColor }:
  { icon: PinArt; dark?: boolean; selected?: boolean; size?: "small" | "regular" | "large"; shape?: PinShape; defaultColor?: string }) {
  // The image the browser could not load; the emoji takes its place, as it does in the apps.
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const fallback = defaultColor !== undefined && validEventPinColor(defaultColor) ? defaultColor : dark ? DEFAULT_EVENT_PIN_COLOR_DARK : DEFAULT_EVENT_PIN_COLOR;
  const color = icon.marker_background_color !== null && validEventPinColor(icon.marker_background_color) ? icon.marker_background_color : fallback;
  const outline = eventPinOutline(color);
  const image = icon.image_url !== null && icon.image_url !== failedImage ? icon.image_url : null;
  const style = { "--event-pin-color": color, "--event-pin-stroke": outline.stroke, "--event-pin-ring": outline.ring,
    "--event-pin-plate": outline.light ? outline.ring : "transparent" } as CSSProperties;
  return (
    <span className={`dates-event-icon-pin${shape === "external" ? " external" : ""}${size === "regular" ? "" : ` ${size}`}${selected ? " selected" : ""}`} style={style} aria-hidden="true">
      <svg viewBox="0 0 48 60" focusable="false"><path d={PIN_OUTLINES[shape]} /></svg>
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

/** One drawn map, by day or at night, with the pins standing on it. */
export function PinMapPreview({ dark, label, chip, children }: { dark: boolean; label: string; chip: string; children: ReactNode }) {
  return (
    <div className={`dates-event-pin-preview ${dark ? "night" : "day"}`} role="img" aria-label={label}>
      <span className="dates-event-pin-preview-pins">{children}</span>
      <span className="dates-event-pin-preview-chip">{chip}</span>
    </div>
  );
}

const MAX_PIN_IMAGE_BYTES = 2 * 1024 * 1024;
/**
 * Uploads a pin's PNG through the profile icon route (the store both catalogues
 * use). The address of the stored image, or `null`: not a PNG of up to 2 MB,
 * not uploaded, or not an address a pin may carry. `busy` brackets the request.
 */
export async function uploadPinImage(file: File, busy: (on: boolean) => void): Promise<string | null> {
  if (file.type !== "image/png" || file.size === 0 || file.size > MAX_PIN_IMAGE_BYTES) return null;
  busy(true);
  const response = await adminUploadProfileIcon(file);
  busy(false);
  return response?.success && eventIconImageURL(response.media_url) ? response.media_url : null;
}

/** The emoji and the PNG of a pin, in one row of the editor. `id` names the row's elements; `error` is the emoji's own problem. */
export function PinArtRow({ id, emoji, imageUrl, error, uploadFailed, labels, onEmoji, onFile, onRemoveImage }: {
  id: (name: string) => string;
  emoji: string;
  imageUrl: string | null;
  error?: string;
  uploadFailed: boolean;
  labels: { emoji: string; image: string; imageUploaded: string; removeImage: string; imageError: string; imageHint: string };
  onEmoji: (value: string) => void;
  onFile: (file?: File) => void;
  onRemoveImage: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const described = (...ids: (string | undefined | false)[]) => ids.filter(Boolean).join(" ") || undefined;
  return (
    <div className="dates-event-icon-row">
      <label htmlFor={id("emoji")}>{labels.emoji}</label>
      <div>
        <div className="dates-event-emoji-line">
          <input id={id("emoji")} className="dates-event-emoji-input" value={emoji} maxLength={32} autoComplete="off" spellCheck={false}
            aria-invalid={error !== undefined} aria-describedby={described(error !== undefined && id("emoji-error"), id("image-hint"))} onChange={event => onEmoji(event.target.value)} />
          {imageUrl !== null && (
            <span className="dates-event-image-thumb" role="img" aria-label={labels.imageUploaded}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="" />
            </span>
          )}
          <button type="button" className="button dates-event-outline-button" aria-describedby={described(uploadFailed && id("image-error"), id("image-hint"))}
            onClick={() => fileInput.current?.click()}>
            <UploadGlyph />{labels.image}
          </button>
          <input ref={fileInput} type="file" accept="image/png" hidden tabIndex={-1} aria-hidden="true"
            onChange={event => { onFile(event.target.files?.[0]); event.target.value = ""; }} />
        </div>
        {imageUrl !== null && <button type="button" className="dates-event-link" onClick={onRemoveImage}>{labels.removeImage}</button>}
        {error !== undefined && <p id={id("emoji-error")} className="dates-event-icon-error">{error}</p>}
        {uploadFailed && <p id={id("image-error")} className="dates-event-icon-error" role="alert">{labels.imageError}</p>}
        <small id={id("image-hint")} className="dates-event-icon-hint">{labels.imageHint}</small>
      </div>
    </div>
  );
}

export type PinColorDraft = {
  /** What the HEX field shows: the text being typed, else the colour. */
  hexText: string;
  /** The HEX field holds text that is not a colour (yet). The edited colour stays what it was meanwhile. */
  hexInvalid: boolean;
  /** The Custom mode is open: a colour is set, or the operator opened it to choose one. */
  custom: boolean;
  defaultMode: RefObject<HTMLInputElement>;
  /** Ends every half-typed value: after another target was chosen or another catalogue arrived. */
  clear: () => void;
  /** Back to the default colour. `moveFocus`: the control that was used disappears with the Custom mode. */
  toDefault: (moveFocus: boolean) => void;
  openCustom: () => void;
  type: (text: string) => void;
  blur: () => void;
  /** A value of the native colour picker (`#rrggbb`). */
  pick: (value: string) => void;
  /** A ready colour (a quick colour). */
  choose: (color: string) => void;
};

/**
 * The typing state of one colour field. `target` names what is edited (a
 * half-typed value belongs to it alone), `color` is its colour and `write`
 * stores a new one. With `required` the field has no "default" to fall back
 * to: an empty field is not a colour, and `null` is never written.
 */
export function usePinColorDraft(target: string | undefined, color: string | null, write: (color: string | null) => void, required = false): PinColorDraft {
  // What is typed into the HEX field while it is not a colour yet.
  const [hexDraft, setHexDraft] = useState<{ key: string; text: string } | null>(null);
  // The target whose Custom mode is open although no custom colour is chosen yet.
  const [customOpen, setCustomOpen] = useState<string | null>(null);
  const defaultMode = useRef<HTMLInputElement>(null);
  const typed = target !== undefined && hexDraft?.key === target ? hexDraft.text : null;
  const hexInvalid = typed !== null && (required || typed.trim() !== "") && eventPinColorFromInput(typed) === null;
  const clear = useCallback(() => { setHexDraft(null); setCustomOpen(null); }, []);
  return {
    hexText: typed ?? color ?? "", hexInvalid, custom: target !== undefined && (color !== null || customOpen === target), defaultMode, clear,
    toDefault(moveFocus) {
      write(null);
      clear();
      // The keyboard goes to the mode switch.
      if (moveFocus) defaultMode.current?.focus();
    },
    openCustom() { if (target !== undefined) setCustomOpen(target); },
    type(text) {
      if (target === undefined) return;
      setHexDraft({ key: target, text });
      setCustomOpen(target);
      const next = eventPinColorFromInput(text);
      if (next !== null) write(next);
      else if (!required && text.trim() === "") write(null);
    },
    blur() { if (!hexInvalid) setHexDraft(null); },
    pick(value) { setHexDraft(null); if (target !== undefined) setCustomOpen(target); write(value.toUpperCase()); },
    choose(next) { setHexDraft(null); write(next); },
  };
}

/** The HEX field and the native colour picker beside it. `pickerColor` is what the picker shows. */
export function PinHexInputs({ draft, pickerColor, invalid, describedBy, inputId, labels }: {
  draft: PinColorDraft; pickerColor: string; invalid: boolean; describedBy?: string; inputId?: string; labels: { hex: string; picker: string };
}) {
  return (
    <div className="dates-event-color-inputs">
      <input id={inputId} className="dates-event-hex-input" value={draft.hexText} maxLength={9} placeholder="#RRGGBB" spellCheck={false} autoComplete="off" autoCapitalize="characters"
        aria-label={labels.hex} aria-invalid={invalid} aria-describedby={describedBy}
        onChange={event => draft.type(event.target.value)} onBlur={draft.blur} />
      <input type="color" aria-label={labels.picker} value={pickerColor.toLowerCase()} onChange={event => draft.pick(event.target.value)} />
    </div>
  );
}

/** A quick colour. `color: null` stands for "no custom colour"; `shown` is how its disc is painted. */
export type PinSwatch = { name: string; label: string; color: string | null; shown: string };

/**
 * A pin's background colour: Default (no colour of its own) or Custom, with
 * the HEX field, the picker and the quick colours. `error` is the stored
 * colour's own problem; `base` is the colour a pin without one takes.
 */
export function PinColorField({ id, draft, color, base, error, swatches, labels }: {
  id: (name: string) => string;
  draft: PinColorDraft;
  color: string | null;
  base: string;
  error?: string;
  swatches: readonly PinSwatch[];
  labels: { title: string; modeDefault: string; modeCustom: string; hex: string; picker: string; invalid: string; swatches: string; reset: string; base: string; defaultHint: string };
}) {
  const { custom, hexInvalid } = draft;
  return (
    <div className="dates-event-pin-colors">
      <h4 id={id("color")}>{labels.title}</h4>
      <div className="dates-event-segmented" role="radiogroup" aria-labelledby={id("color")}>
        <label>
          <input ref={draft.defaultMode} type="radio" name={id("mode")} checked={!custom} onChange={() => draft.toDefault(false)} />
          <span>{labels.modeDefault}</span>
        </label>
        <label>
          <input type="radio" name={id("mode")} checked={custom} onChange={draft.openCustom} />
          <span>{labels.modeCustom}</span>
        </label>
      </div>
      {custom ? <>
        <PinHexInputs draft={draft} pickerColor={color !== null && validEventPinColor(color) ? color : base} invalid={hexInvalid || error !== undefined}
          describedBy={hexInvalid ? id("hex-error") : error !== undefined ? id("marker_background_color-error") : undefined} labels={labels} />
        {hexInvalid ? <p id={id("hex-error")} className="dates-event-icon-error">{labels.invalid}</p>
          : error !== undefined && <p id={id("marker_background_color-error")} className="dates-event-icon-error">{error}</p>}
        <div className="dates-event-color-quick">
          <div className="dates-event-color-swatches" role="group" aria-label={labels.swatches}>
            {swatches.map(swatch => (
              <button key={swatch.name} type="button" aria-label={swatch.label} title={swatch.label} aria-pressed={!hexInvalid && color === swatch.color}
                onClick={() => { if (swatch.color === null) draft.toDefault(true); else draft.choose(swatch.color); }}>
                <span style={{ "--event-pin-color": swatch.shown } as CSSProperties} />
              </button>
            ))}
          </div>
          <div className="dates-event-color-reset">
            <button type="button" className="dates-event-link" onClick={() => draft.toDefault(true)}>{labels.reset}</button>
            <small>{labels.base}</small>
          </div>
        </div>
      </> : <small className="dates-event-icon-hint">{labels.defaultHint}</small>}
    </div>
  );
}
