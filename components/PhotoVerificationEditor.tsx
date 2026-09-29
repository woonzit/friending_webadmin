"use client";

import React, { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import ImageUploadField from "@/components/ImageUploadField";
import LocalizedFields, { type Language } from "@/components/LocalizedFields";
import {
  PHOTO_GESTURES_MAX,
  PHOTO_GESTURE_COUNT_MAX,
  PHOTO_GESTURE_COUNT_MIN,
  PHOTO_GESTURE_EXAMPLE_GENDERS,
  PHOTO_GESTURE_SUBTITLE_MAX,
  PHOTO_GESTURE_TITLE_MAX,
  PROFILE_VERIFICATION_PHOTO_FLOW_FIELDS,
  PROFILE_VERIFICATION_PHOTO_FLOW_KEYS,
  emptyPhotoGesture,
  photoCatalogueSufficient,
  type ProfileVerificationConfig,
} from "@/lib/profileVerification";
import { VERIFICATION_METHOD_PHOTO_CATALOGUE_ANCHOR } from "@/lib/verificationMethod";

type Change = (mutator: (next: ProfileVerificationConfig) => void) => void;
/** The translated problem of one field (`photo_gestures.<id>.title`, language) or undefined. */
type FieldError = (path: string, language?: Language) => string | undefined;

/**
 * Where the gesture photo selfie is mandated, from Core's method console. `null`
 * means the console could not be read: the editor then claims nothing and lets
 * Core decide on save.
 */
export type PhotoCoverage = { live: boolean; draft: boolean } | null;

/**
 * The D-135 gesture catalogue: bilingual gesture rows with a male and a
 * female example image (uploaded through the existing `upload_image`), and
 * how many gestures (1-10) one member photographs. Core draws each member's
 * set at random from the catalogue, so the catalogue must hold at least that
 * many rows before `photo` can be published anywhere; while a LIVE scope uses
 * `photo`, Core refuses a save that would leave fewer
 * (`profile-verification-gestures-insufficient`).
 */
export default function PhotoGestureCatalogue({
  value,
  disabled,
  change,
  onBusyChange,
  fieldError,
  coverage,
  countRefused,
}: {
  value: ProfileVerificationConfig;
  disabled: boolean;
  change: Change;
  onBusyChange: (busy: boolean) => void;
  fieldError: FieldError;
  coverage: PhotoCoverage;
  /** Core refused the last save with `profile-verification-gestures-insufficient`. */
  countRefused: boolean;
}) {
  const t = useTranslations("profileVerification.configuration.photo");
  const fields = useTranslations("profileVerification.configuration.fields");
  const [uploading, setUploading] = useState<ReadonlySet<string>>(new Set());
  const uploadingRef = useRef<Set<string>>(new Set());
  const locked = disabled || uploading.size > 0;
  const count = value.photo_gesture_count;
  const size = value.photo_gestures.length;
  const sufficient = photoCatalogueSufficient(value.photo_gestures, count);
  const missing = Math.max(0, count - size);

  function uploadBusy(key: string, busy: boolean) {
    const next = new Set(uploadingRef.current);
    if (busy) next.add(key); else next.delete(key);
    uploadingRef.current = next;
    setUploading(next);
    // Event-owned side effect: never inside a state updater, which Strict Mode may replay.
    onBusyChange(next.size > 0);
  }

  function setCount(raw: string) {
    // A cleared or out-of-range field keeps the previous count instead of storing 0 or NaN.
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < PHOTO_GESTURE_COUNT_MIN || parsed > PHOTO_GESTURE_COUNT_MAX) return;
    change((next) => { next.photo_gesture_count = parsed; });
  }

  function editGesture(id: string, edit: (row: ProfileVerificationConfig["photo_gestures"][number]) => void) {
    change((next) => {
      const row = next.photo_gestures.find((entry) => entry.id === id);
      if (row) edit(row);
    });
  }

  const sufficiency = sufficient
    ? <div className="alert alert-success" role="status">{t("sufficient", { size, count })}</div>
    : (
      <div className={`alert ${coverage?.live || countRefused ? "alert-error" : "alert-warning"}`} role="status" data-photo-catalogue-insufficient="true">
        <strong>{t("insufficientTitle", { size, count, missing })}</strong>{" "}
        {coverage?.live || countRefused ? t("insufficientLive") : t("insufficientDormant")}
      </div>
    );

  return (
    <div className="verification-editor-section" id={VERIFICATION_METHOD_PHOTO_CATALOGUE_ANCHOR}>
      <div className="verification-section-heading"><h3>{t("title")}</h3><p>{t("copy")}</p></div>
      {coverage === null
        ? <p className="field-hint">{t("coverageUnknown")}</p>
        : <p className="field-hint">{coverage.live ? t("coverageLive") : coverage.draft ? t("coverageDraft") : t("coverageNone")}</p>}
      {sufficiency}
      <label className="field photo-gesture-count">
        <span>{t("count")}</span>
        <input
          type="number"
          min={PHOTO_GESTURE_COUNT_MIN}
          max={PHOTO_GESTURE_COUNT_MAX}
          step={1}
          value={count}
          disabled={locked}
          aria-invalid={fieldError("photo_gesture_count") || countRefused ? true : undefined}
          onChange={(event) => setCount(event.target.value)}
        />
        <small className="field-hint">{t("countHint", { min: PHOTO_GESTURE_COUNT_MIN, max: PHOTO_GESTURE_COUNT_MAX })}</small>
        {fieldError("photo_gesture_count") ? <small className="field-error" role="alert">{fieldError("photo_gesture_count")}</small> : null}
      </label>

      <div className="verification-section-heading"><h3>{t("gestures", { size })}</h3><p>{t("gesturesHint")}</p></div>
      {size === 0 ? <p className="page-subtitle">{t("empty")}</p> : null}
      <div className="photo-gesture-list">
        {value.photo_gestures.map((gesture, index) => {
          const base = `photo_gestures.${gesture.id}`;
          const idError = fieldError(`${base}.id`);
          return (
            <article className="verification-status-editor photo-gesture-row" key={gesture.id} data-gesture-id={gesture.id}>
              <div className="verification-status-editor-heading">
                <div><span className="badge">{t("gesture", { index: index + 1 })}</span><code>{gesture.id}</code></div>
                {!disabled ? (
                  <button
                    type="button"
                    className="button button-ghost button-danger button-small"
                    disabled={locked}
                    onClick={() => change((next) => { next.photo_gestures = next.photo_gestures.filter((row) => row.id !== gesture.id); })}
                  >
                    {t("removeGesture")}
                  </button>
                ) : null}
              </div>
              {idError ? <p className="field-error" role="alert">{idError}</p> : null}
              <LocalizedFields
                value={gesture.title}
                maximum={PHOTO_GESTURE_TITLE_MAX}
                disabled={locked}
                labelEn={fields("titleEn")}
                labelHu={fields("titleHu")}
                errors={{ en: fieldError(`${base}.title`, "en"), hu: fieldError(`${base}.title`, "hu") }}
                onChange={(language, text) => editGesture(gesture.id, (row) => { row.title[language] = text; })}
              />
              <LocalizedFields
                value={gesture.subtitle}
                maximum={PHOTO_GESTURE_SUBTITLE_MAX}
                disabled={locked}
                multiline
                labelEn={t("instructionEn")}
                labelHu={t("instructionHu")}
                errors={{ en: fieldError(`${base}.subtitle`, "en"), hu: fieldError(`${base}.subtitle`, "hu") }}
                onChange={(language, text) => editGesture(gesture.id, (row) => { row.subtitle[language] = text; })}
              />
              <div className="verification-localized-pair">
                {PHOTO_GESTURE_EXAMPLE_GENDERS.map((gender) => {
                  const key = `${gesture.id}-${gender}`;
                  const error = fieldError(`${base}.${gender}_image_url`);
                  return (
                    <div key={gender}>
                      <ImageUploadField
                        label={t(`${gender}Example`)}
                        hint={t("exampleHint")}
                        value={gesture[`${gender}_image_url`]}
                        required
                        disabled={disabled || (uploading.size > 0 && !uploading.has(key))}
                        onBusyChange={(busy) => uploadBusy(key, busy)}
                        onChange={(url) => editGesture(gesture.id, (row) => { row[`${gender}_image_url`] = url; })}
                      />
                      {error ? <small className="field-error" role="alert">{error}</small> : null}
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
      {!disabled ? (
        <div className="row-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={locked || size >= PHOTO_GESTURES_MAX}
            onClick={() => change((next) => { next.photo_gestures = [...next.photo_gestures, emptyPhotoGesture()]; })}
          >
            {t("addGesture")}
          </button>
          {size >= PHOTO_GESTURES_MAX ? <small className="field-hint">{t("catalogueFull", { max: PHOTO_GESTURES_MAX })}</small> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The eighteen editable `copy.photo_flow` sentences: what a member in a photo
 * scope reads instead of the matching video sentence (intro, capture step,
 * camera, preview, pending card, six status lines, consent).
 */
export function PhotoFlowWording({
  value,
  disabled,
  change,
  fieldError,
}: {
  value: ProfileVerificationConfig;
  disabled: boolean;
  change: Change;
  fieldError: FieldError;
}) {
  const t = useTranslations("profileVerification.configuration.photoFlow");
  return (
    <div className="verification-editor-section" id="profile-verification-photo-wording">
      <div className="verification-section-heading"><h3>{t("title")}</h3><p>{t("copy")}</p></div>
      {PROFILE_VERIFICATION_PHOTO_FLOW_KEYS.map((field) => {
        const maximum = PROFILE_VERIFICATION_PHOTO_FLOW_FIELDS[field];
        const path = `copy.photo_flow.${field}`;
        return (
          <div className="verification-copy-row" key={field}>
            <div className="verification-copy-row-title"><strong>{t(`fields.${field}`)}</strong><code>{field}</code></div>
            <LocalizedFields
              value={value.copy.photo_flow[field]}
              maximum={maximum}
              disabled={disabled}
              multiline={maximum > 320}
              labelEn={t("english")}
              labelHu={t("hungarian")}
              errors={{ en: fieldError(path, "en"), hu: fieldError(path, "hu") }}
              onChange={(language, text) => change((next) => { next.copy.photo_flow[field][language] = text; })}
            />
          </div>
        );
      })}
    </div>
  );
}
