"use client";

import Link from "next/link";
import React, { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import DatesIntakeRefusal from "@/components/DatesIntakeRefusal";
import { adminIntakeCreate } from "@/lib/adminClient";
import { DATES_INTAKE_INPUT_KINDS, DATES_INTAKE_MAX_IMAGES, DATES_INTAKE_MAX_TEXT_GRAPHEMES, DATES_INTAKE_MAX_URL_LENGTH,
  type DatesIntakeSourceKind } from "@/lib/datesIntakeAdmin";
import { createDatesIntakeSourceKey, datesIntakeSourceProblem, submitDatesIntakeSource,
  type DatesIntakeDraftEntry, type DatesIntakeSourceFile } from "@/lib/datesIntakeConsole";

type Picked = DatesIntakeSourceFile & { file: File };
type Notice = { kind: "problem"; key: string } | { kind: "refused"; error: string } | { kind: "uncertain" };

/**
 * "Draft from source" / "Vázlat forrásból": a link, a flyer photo or a line of
 * text becomes an intake. The AI drafts; a person reviews and publishes.
 * A flyer goes to Core through the console's own server route and is never
 * shown publicly or used as the event image.
 */
export default function DatesIntakeSourcePanel({ entry, onCreated }: {
  entry: DatesIntakeDraftEntry;
  /** The intake exists: the caller takes the operator to its review screen. */
  onCreated: (intakeId: string) => void;
}) {
  const t = useTranslations("datesAdmin.intake.source");
  const kinds = useTranslations("datesAdmin.intake.inputKindValues");
  const common = useTranslations("common");
  const locale = useLocale() === "hu" ? "hu" : "en";
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<DatesIntakeSourceKind>("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  // One identity per source: it survives a retry and changes with the source.
  const key = useRef(""), busyRef = useRef(false);

  if (entry.state === "noCapability") return null;
  const disabled = entry.state === "disabled";

  function changed() { key.current = ""; setNotice(null); }

  async function pick(list: FileList | null) {
    changed();
    const chosen = Array.from(list ?? []).slice(0, DATES_INTAKE_MAX_IMAGES + 1);
    setFiles(await Promise.all(chosen.map(async (file) => ({ file, name: file.name, size: file.size,
      header: new Uint8Array(await file.slice(0, 16).arrayBuffer()) }))));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busyRef.current || disabled) return;
    const draft = { kind, url, text: kind === "url" ? "" : text };
    const problem = datesIntakeSourceProblem(draft, files);
    if (problem) { setNotice({ kind: "problem", key: problem }); return; }
    busyRef.current = true; setBusy(true); setNotice(null);
    try {
      if (key.current === "") key.current = createDatesIntakeSourceKey();
      const outcome = await submitDatesIntakeSource(adminIntakeCreate, draft, files.map((item) => item.file), locale, key.current);
      if (outcome.kind === "success") { onCreated(outcome.receipt.intake.intake_id); return; }
      if (outcome.kind === "refused") { key.current = ""; setNotice({ kind: "refused", error: outcome.error }); }
      // The answer was lost: the same request, with the same identity, finds the intake if it was made.
      else setNotice({ kind: "uncertain" });
    } finally { busyRef.current = false; setBusy(false); }
  }

  return <section className="panel dates-external-fields" aria-label={t("title")}>
    <div className="row-actions"><h2>{t("title")}</h2>
      {!disabled && <button type="button" className="button button-primary" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{t(open ? "close" : "open")}</button>}</div>
    <p>{t("copy")}</p>
    {disabled && <p className="alert alert-info">{t("disabled")} <Link href="/dates/configuration">{t("disabledLink")}</Link></p>}
    {entry.state === "unknown" && <p className="field-hint">{t("unknown")}</p>}
    {open && !disabled && <form onSubmit={submit}><fieldset className="dates-external-fields" disabled={busy}>
      <div className="row-actions" role="radiogroup" aria-label={t("kind")}>
        {DATES_INTAKE_INPUT_KINDS.map((value) => <label className="checkbox-field" key={value}>
          <input type="radio" name="dates-intake-kind" checked={kind === value} onChange={() => { changed(); setKind(value); }} /><span>{kinds(value)}</span></label>)}
      </div>
      {kind === "url" && <label className="field"><span>{t("url")}</span>
        <input type="url" required maxLength={DATES_INTAKE_MAX_URL_LENGTH} value={url} placeholder="https://" onChange={(change) => { changed(); setUrl(change.target.value); }} />
        <small>{t("urlHint")}</small></label>}
      {kind === "images" && <label className="field"><span>{t("images")}</span>
        <input type="file" required multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(change) => void pick(change.target.files)} />
        <small>{t("imagesHint")}</small></label>}
      {kind === "images" && files.length > 0 && <ul>{files.map((item, index) => <li key={`${index}-${item.name}`}>{item.name} · {(item.size / (1024 * 1024)).toFixed(1)} MiB</li>)}</ul>}
      {kind !== "url" && <label className="field"><span>{t(kind === "images" ? "imageText" : "text")}</span>
        <textarea required={kind === "text"} rows={3} maxLength={8000} value={text} onChange={(change) => { changed(); setText(change.target.value); }} />
        <small>{t("textHint", { maximum: DATES_INTAKE_MAX_TEXT_GRAPHEMES })}</small></label>}
      <p className="field-hint">{t("privacy")}</p>
      {notice?.kind === "problem" && <p className="alert alert-error" role="alert">{t(`problems.${notice.key}`)}</p>}
      {notice?.kind === "refused" && <DatesIntakeRefusal error={notice.error} />}
      {notice?.kind === "uncertain" && <p className="alert alert-error" role="alert">{t("uncertain")}</p>}
      <button type="submit" className="button button-primary">{busy ? common("working") : t(notice?.kind === "uncertain" ? "retry" : "submit")}</button>
    </fieldset></form>}
  </section>;
}
