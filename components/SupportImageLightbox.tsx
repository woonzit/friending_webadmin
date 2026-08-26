"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export default function SupportImageLightbox({
  src,
  alt,
  closeLabel,
  onClose,
}: { src: string; alt: string; closeLabel: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      } else if (event.key === "Tab") {
        // The close control is intentionally the only focusable item.
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={dialogRef}
      className="support-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close.current();
      }}
    >
      <button
        ref={closeRef}
        type="button"
        className="support-lightbox-close"
        aria-label={closeLabel}
        onClick={() => close.current()}
      >✕</button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        onMouseDown={(event) => event.stopPropagation()}
      />
    </div>,
    document.body,
  );
}
