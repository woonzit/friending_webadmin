"use client";

import {
  DragEvent,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import {
  ADMIN_IMAGE_ACCEPT,
  MAX_ADMIN_IMAGE_INPUT_BYTES,
} from "@/lib/adminImageConfig";
import { adminUploadImage } from "@/lib/adminClient";

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type ImageUploadFieldProps = {
  label: string;
  value: string;
  onChange: (url: string) => void;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  onBusyChange?: (busy: boolean) => void;
};

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14.5v3.25A2.25 2.25 0 0 0 7.25 20h9.5A2.25 2.25 0 0 0 19 17.75V14.5" />
    </svg>
  );
}

export default function ImageUploadField({
  label,
  value,
  onChange,
  hint,
  required = false,
  disabled = false,
  className = "",
  onBusyChange,
}: ImageUploadFieldProps) {
  const t = useTranslations("imageUpload");
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  const onBusyChangeRef = useRef(onBusyChange);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  onChangeRef.current = onChange;
  onBusyChangeRef.current = onBusyChange;

  function localizedError(code: unknown): string {
    if (code === "image-too-large") return t("tooLarge");
    if (code === "image-format-invalid") return t("invalidType");
    if (code === "image-dimensions-invalid") return t("invalidDimensions");
    if (code === "image-invalid" || code === "image-missing") return t("invalidImage");
    if (code === "auth-required") return t("authRequired");
    return t("failed");
  }

  async function upload(file: File) {
    setError("");
    if (file.type && !ACCEPTED_TYPES.has(file.type)) {
      setError(t("invalidType"));
      return;
    }
    if (file.size === 0) {
      setError(t("invalidImage"));
      return;
    }
    if (file.size > MAX_ADMIN_IMAGE_INPUT_BYTES) {
      setError(t("tooLarge"));
      return;
    }

    setBusy(true);
    onBusyChangeRef.current?.(true);
    try {
      const response = await adminUploadImage(file);
      if (!response?.success || typeof response.media_url !== "string") {
        setError(localizedError(response?.error));
        return;
      }
      onChangeRef.current(response.media_url);
    } finally {
      setBusy(false);
      onBusyChangeRef.current?.(false);
    }
  }

  function acceptDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled || busy) return;
    const file = event.dataTransfer.files?.[0];
    if (file) void upload(file);
  }

  const locked = disabled || busy;
  const wrapperClass = [
    "field",
    "image-upload-field",
    className,
  ].filter(Boolean).join(" ");

  return (
    <div className={wrapperClass}>
      <span id={`${inputId}-label`}>{label}</span>
      <div
        className={`image-upload-box${dragging ? " is-dragging" : ""}${value ? " has-image" : ""}`}
        aria-busy={busy}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!locked) setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget;
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            setDragging(false);
          }
        }}
        onDrop={acceptDrop}
      >
        <div className="image-upload-preview">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" />
          ) : (
            <UploadIcon />
          )}
        </div>
        <div className="image-upload-content">
          <strong>{busy ? t("uploading") : value ? t("ready") : t("empty")}</strong>
          <span>{t("dropHint")}</span>
          <small>{hint ?? t("requirements")}</small>
          <div className="image-upload-actions">
            <button
              type="button"
              className="button button-secondary button-small"
              disabled={locked}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? t("uploadingShort") : value ? t("replace") : t("choose")}
            </button>
            {value && !required && (
              <button
                type="button"
                className="text-button image-upload-remove"
                disabled={locked}
                onClick={() => {
                  setError("");
                  onChangeRef.current("");
                }}
              >
                {t("remove")}
              </button>
            )}
          </div>
        </div>
      </div>
      <input
        ref={inputRef}
        id={inputId}
        className="sr-only"
        type="file"
        accept={ADMIN_IMAGE_ACCEPT}
        disabled={locked}
        aria-labelledby={`${inputId}-label`}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void upload(file);
        }}
      />
      {error && <small className="image-upload-error" role="alert">{error}</small>}
    </div>
  );
}
