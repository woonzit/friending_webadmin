"use client";

import React, { useId, useRef, useState } from "react";
import { adminUploadProfileIcon } from "@/lib/adminClient";

type Props = {
  label: string;
  hint: string;
  chooseLabel: string;
  removeLabel: string;
  uploadingLabel: string;
  errorLabel: string;
  value: string;
  disabled?: boolean;
  onChange: (value: { url: string; mime: string }) => void;
  onBusyChange?: (busy: boolean) => void;
};

const ALLOWED = new Set(["image/png", "image/svg+xml"]);
const MAX_BYTES = 2 * 1024 * 1024;

export default function ProfileIconUploadField({
  label,
  hint,
  chooseLabel,
  removeLabel,
  uploadingLabel,
  errorLabel,
  value,
  disabled = false,
  onChange,
  onBusyChange,
}: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function upload(file: File) {
    setError("");
    if (!ALLOWED.has(file.type) || file.size === 0 || file.size > MAX_BYTES) {
      setError(errorLabel);
      return;
    }
    setBusy(true);
    onBusyChange?.(true);
    const response = await adminUploadProfileIcon(file);
    setBusy(false);
    onBusyChange?.(false);
    if (
      !response?.success
      || typeof response.media_url !== "string"
      || typeof response.mime !== "string"
    ) {
      setError(errorLabel);
      return;
    }
    onChange({ url: response.media_url, mime: response.mime });
  }

  return (
    <div className="field profile-icon-upload">
      <span>{label}</span>
      <div className="profile-icon-upload-row">
        <span className="profile-icon-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {value ? <img src={value} alt="" /> : <b aria-hidden="true">+</b>}
        </span>
        <div>
          <button
            type="button"
            className="button button-secondary button-small"
            disabled={disabled || busy}
            onClick={() => input.current?.click()}
          >
            {busy ? uploadingLabel : chooseLabel}
          </button>
          {value ? (
            <button
              type="button"
              className="text-button"
              disabled={disabled || busy}
              onClick={() => onChange({ url: "", mime: "" })}
            >{removeLabel}</button>
          ) : null}
          <small className="field-hint">{hint}</small>
        </div>
      </div>
      <input
        ref={input}
        id={id}
        className="sr-only"
        type="file"
        accept="image/png,image/svg+xml"
        disabled={disabled || busy}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void upload(file);
        }}
      />
      {error ? <small className="image-upload-error" role="alert">{error}</small> : null}
    </div>
  );
}
