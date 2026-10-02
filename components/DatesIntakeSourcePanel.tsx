"use client";

import Link from "next/link";
import React, { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import DatesIntakeRefusal from "@/components/DatesIntakeRefusal";
import { adminIntakeCreate } from "@/lib/adminClient";
import { DATES_INTAKE_INPUT_KINDS, DATES_INTAKE_MAX_IMAGES, DATES_INTAKE_MAX_TEXT_GRAPHEMES, DATES_INTAKE_MAX_URL_LENGTH,
  type DatesIntakeSourceKind } from "@/lib/datesIntakeAdmin";
import { createDatesIntakeSourceAttempts, datesIntakeSourceProblem,
  type DatesIntakeDraftEntry, type DatesIntakeSourceAttempts, type DatesIntakeSourceFile } from "@/lib/datesIntakeConsole";

type Picked = DatesIntakeSourceFile & { file: File };
export type DatesIntakeSourceNoticeValue = { kind: "problem"; key: string } | { kind: "refused"; error: string } | { kind: "uncertain"; error: string | null };

/**
 * What the last attempt came to. A definitive refusal is Core's own words. An
 * unknown outcome says that it is unknown, shows what was answered when
 * something was, and tells the operator that the retry is the same request.
 */
export function DatesIntakeSourceNotice({ notice }: { notice: DatesIntakeSourceNoticeValue | null }) {
  const t = useTranslations("datesAdmin.intake.source");
  if (notice === null) return null;
  if (notice.kind === "problem") return <p className="alert alert-error" role="alert">{t(`problems.${notice.key}`)}</p>;
  if (notice.kind === "refused") return <DatesIntakeRefusal error={notice.error} />;
  return <>
    <p className="alert alert-error" role="alert">{t("uncertain")}</p>
    {notice.error !== null && <DatesIntakeRefusal error={notice.error} tone="info" />}
    <p className="field-hint">{t("locked")} <Link href="/dates/intakes">{t("checkQueue")}</Link></p>
  </>;
}

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
  const [notice, setNotice] = useState<DatesIntakeSourceNoticeValue | null>(null);
  // An attempt whose outcome is unknown locks the source: the retry must be the same request.
  const [locked, setLocked] = useState(false);
  // One identity per source. It survives everything except Core's receipt, Core's
  // definitive refusal, an edit of a source nothing is pending for, and an explicit discard.
  const attempts = useRef<DatesIntakeSourceAttempts | null>(null), busyRef = useRef(false);
  if (attempts.current === null) attempts.current = createDatesIntakeSourceAttempts();

  if (entry.state === "noCapability") return null;
  const disabled = entry.state === "disabled";

  function changed() {
    if (attempts.current!.changed()) setNotice(null);
  }

  /** The operator's own decision: the unanswered request is given up, and the next one is a new command. */
  function discard() {
    if (busyRef.current) return;
    attempts.current!.discard(); setLocked(false); setNotice(null);
  }

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
      const outcome = await attempts.current!.send(adminIntakeCreate, draft, files.map((item) => item.file), locale);
      setLocked(attempts.current!.unanswered);
      if (outcome.kind === "success") { onCreated(outcome.receipt.intake.intake_id); return; }
      // Only Core's definitive refusal ends the request. Anything else may have created the intake:
      // the same request, with the same identity, finds it if it was made.
      setNotice(outcome.kind === "refused" ? { kind: "refused", error: outcome.error } : { kind: "uncertain", error: outcome.error });
    } finally { busyRef.current = false; setBusy(false); }
  }

  return <section className="panel dates-external-fields" aria-label={t("title")}>
    <div className="row-actions"><h2>{t("title")}</h2>
      {!disabled && <button type="button" className="button button-primary" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{t(open ? "close" : "open")}</button>}</div>
    <p>{t("copy")}</p>
    {disabled && <p className="alert alert-info">{t("disabled")} <Link href="/dates/configuration">{t("disabledLink")}</Link></p>}
    {entry.state === "unknown" && <p className="field-hint">{t("unknown")}</p>}
    {open && !disabled && <form onSubmit={submit}><fieldset className="dates-external-fields" disabled={busy || locked}>
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
    </fieldset>
      <DatesIntakeSourceNotice notice={notice} />
      <div className="row-actions">
        <button type="submit" className="button button-primary" disabled={busy}>{busy ? common("working") : t(locked ? "retry" : "submit")}</button>
        {locked && <button type="button" className="button button-secondary" disabled={busy} onClick={discard}>{t("discard")}</button>}
      </div>
      {locked && <p className="field-hint">{t("discardHint")}</p>}
    </form>}
  </section>;
}
