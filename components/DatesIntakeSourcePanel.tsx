"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import DatesIntakeRefusal from "@/components/DatesIntakeRefusal";
import { adminCall, adminIntakeCreate } from "@/lib/adminClient";
import { DATES_INTAKE_INPUT_KINDS, DATES_INTAKE_MAX_IMAGES, DATES_INTAKE_MAX_TEXT_GRAPHEMES, DATES_INTAKE_MAX_URL_LENGTH,
  type DatesIntakeSourceKind } from "@/lib/datesIntakeAdmin";
import { datesIntakeSourceProblem, type DatesIntakeDraftEntry, type DatesIntakeSourceFile } from "@/lib/datesIntakeConsole";
import {
  DATES_INTAKE_TOMBSTONE_RESEND_SECONDS, datesIntakeTombstoneStorage, readDatesIntakeTombstone, readDatesIntakeTombstoneEvidence,
  retireDatesIntakeTombstone, sendDatesIntakeSource,
  type DatesIntakeTombstone, type DatesIntakeTombstoneEvidence, type DatesIntakeTombstoneRead,
} from "@/lib/datesIntakeTombstone";
import { formatDate } from "@/lib/format";

type Picked = DatesIntakeSourceFile & { file: File };
export type DatesIntakeSourceNoticeValue = { kind: "problem"; key: string } | { kind: "refused"; error: string } | { kind: "uncertain"; error: string | null };

/**
 * What the last attempt came to. A definitive refusal is Core's own words. An
 * unknown outcome says that it is unknown and shows what was answered when
 * something was; what the operator can do about it is the waiting
 * submission's own notice, above the form.
 */
export function DatesIntakeSourceNotice({ notice }: { notice: DatesIntakeSourceNoticeValue | null }) {
  const t = useTranslations("datesAdmin.intake.source");
  if (notice === null) return null;
  if (notice.kind === "problem") return <p className="alert alert-error" role="alert">{t(`problems.${notice.key}`)}</p>;
  if (notice.kind === "refused") return <DatesIntakeRefusal error={notice.error} />;
  return <>
    <p className="alert alert-error" role="alert">{t("uncertain")}</p>
    {notice.error !== null && <DatesIntakeRefusal error={notice.error} tone="info" />}
  </>;
}

/**
 * A submission whose outcome is not known, shown before anything else. It
 * names the submission by its time and kind (for a flyer its file), and the
 * three ways on: the same request again, a look in the queue, and - only on
 * the strength of that look - closing the record.
 */
export function DatesIntakeTombstoneNotice({ tombstone, evidence, now, busy, onCheck, onRetire }: {
  tombstone: DatesIntakeTombstone; evidence: DatesIntakeTombstoneEvidence | null;
  /** Seconds, on the clock the tombstone was written with. */
  now: number; busy: boolean; onCheck: () => void; onRetire: () => void;
}) {
  const t = useTranslations("datesAdmin.intake.source.pending");
  const intake = useTranslations("datesAdmin.intake");
  const common = useTranslations("common");
  const locale = useLocale();
  const time = (value: number) => formatDate(value, locale, true);
  const expired = now - tombstone.at >= DATES_INTAKE_TOMBSTONE_RESEND_SECONDS;
  return <div className="alert alert-warning" role="status">
    <p><strong>{t("title", { time: time(tombstone.at) })}</strong></p>
    <p>{t("what", { kind: intake(`inputKindValues.${tombstone.kind}`) })}
      {tombstone.files.map((file, index) => <span key={`${index}-${file.sha256}`}> · {file.name || t("unnamedFile")} ({(file.size / (1024 * 1024)).toFixed(1)} MiB)</span>)}</p>
    <p>{t("copy")}</p>
    <p>{t(expired ? "resendExpired" : tombstone.kind === "images" ? "resendFlyer" : "resend")}</p>
    <div className="row-actions">
      <button type="button" className="button button-secondary" disabled={busy} onClick={onCheck}>{busy ? common("working") : t("check")}</button>
      <Link className="button button-secondary" href="/dates/intakes">{t("queueLink")}</Link>
    </div>
    {evidence?.kind === "early" && <p>{t("early", { time: time(evidence.retry_at) })}</p>}
    {evidence?.kind === "unconfirmed" && <p>{t("unconfirmed")}</p>}
    {evidence?.kind === "none" && <>
      <p>{t("none", { checked: time(evidence.checked_at), since: time(evidence.since) })}</p>
      <button type="button" className="button button-secondary" disabled={busy} onClick={onRetire}>{t("discard")}</button>
    </>}
    {evidence?.kind === "found" && <>
      <p>{t("found", { checked: time(evidence.checked_at), since: time(evidence.since) })}</p>
      <ul>{evidence.intakes.map((found) => <li key={found.intake_id}><Link href={`/dates/intakes/${found.intake_id}`}>
        {found.input_kind ? intake(`inputKindValues.${found.input_kind}`) : "—"} · {intake(`statusValues.${found.status}`)} · {time(found.created_at)}</Link></li>)}</ul>
      <button type="button" className="button button-secondary" disabled={busy} onClick={onRetire}>{t("foundRetire")}</button>
    </>}
  </div>;
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
  // The record of a submission whose outcome is not known lives in the browser's storage, per operator - not in this
  // component. The panel only shows what the storage holds, and reads it again after everything it does.
  const [waiting, setWaiting] = useState<DatesIntakeTombstoneRead>({ kind: "empty" });
  const [evidence, setEvidence] = useState<DatesIntakeTombstoneEvidence | null>(null);
  const busyRef = useRef(false);
  const actor = entry.actor;
  // The console's clock, moved towards Core's by what the entry read showed.
  const offset = useRef(entry.serverNow === null ? 0 : entry.serverNow - Math.floor(Date.now() / 1000));
  const clock = () => Math.floor(Date.now() / 1000) + offset.current;

  const refresh = useCallback(() => {
    const read: DatesIntakeTombstoneRead = actor === null ? { kind: "empty" } : readDatesIntakeTombstone(datesIntakeTombstoneStorage(), actor);
    setWaiting(read);
    // A waiting submission is shown first, with the form its kind needs.
    if (read.kind === "pending") { setKind(read.tombstone.kind); setOpen(true); }
    return read;
  }, [actor]);
  // On any page and after any reload: the record is read when the panel appears.
  useEffect(() => { refresh(); }, [refresh]);

  if (entry.state === "noCapability") return null;
  const disabled = entry.state === "disabled";
  const pending = waiting.kind === "pending" ? waiting.tombstone : null;
  const expired = pending !== null && clock() - pending.at >= DATES_INTAKE_TOMBSTONE_RESEND_SECONDS;

  function changed() { setNotice(null); }

  async function pick(list: FileList | null) {
    changed();
    const chosen = Array.from(list ?? []).slice(0, DATES_INTAKE_MAX_IMAGES + 1);
    setFiles(await Promise.all(chosen.map(async (file) => ({ file, name: file.name, size: file.size,
      header: new Uint8Array(await file.slice(0, 16).arrayBuffer()) }))));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busyRef.current || disabled) return;
    // Without the operator's identity the record of this submission could not be kept, so nothing is sent.
    if (actor === null) { setNotice({ kind: "problem", key: "identity" }); return; }
    const draft = { kind, url, text: kind === "url" ? "" : text };
    const problem = datesIntakeSourceProblem(draft, files);
    if (problem) { setNotice({ kind: "problem", key: problem }); return; }
    busyRef.current = true; setBusy(true); setNotice(null);
    try {
      // The identity of the request is the stored record's: a waiting submission is resent under its own key, and only
      // when these are its inputs. Only Core's receipt or Core's definitive refusal removes the record.
      const outcome = await sendDatesIntakeSource({ post: adminIntakeCreate, storage: datesIntakeTombstoneStorage(), actor, now: clock },
        draft, files.map((item) => item.file), locale);
      setEvidence(null); refresh();
      if (outcome.kind === "success") { onCreated(outcome.receipt.intake.intake_id); return; }
      setNotice(outcome.kind === "refused" ? { kind: "refused", error: outcome.error }
        : outcome.kind === "uncertain" ? { kind: "uncertain", error: outcome.error }
          : { kind: "problem", key: outcome.kind === "blocked" ? "storage" : outcome.kind });
    } finally { busyRef.current = false; setBusy(false); }
  }

  /** Looks for the waiting submission in the queue. What the read shows is the only thing that can close the record. */
  async function check() {
    if (busyRef.current || pending === null) return;
    busyRef.current = true; setBusy(true);
    try { setEvidence(await readDatesIntakeTombstoneEvidence(adminCall, pending, clock())); } finally { busyRef.current = false; setBusy(false); }
  }

  /** Closes the record on the strength of the queue read shown beside the button; without one, nothing happens. */
  function retire() {
    if (busyRef.current || pending === null) return;
    if (retireDatesIntakeTombstone(datesIntakeTombstoneStorage(), pending, evidence)) setNotice(null);
    setEvidence(null); refresh();
  }

  return <section className="panel dates-external-fields" aria-label={t("title")}>
    <div className="row-actions"><h2>{t("title")}</h2>
      {!disabled && !pending && <button type="button" className="button button-primary" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{t(open ? "close" : "open")}</button>}</div>
    <p>{t("copy")}</p>
    {waiting.kind === "blocked" && actor !== null && <p className="alert alert-error" role="alert">{t("pending.blocked")}</p>}
    {pending && <DatesIntakeTombstoneNotice tombstone={pending} evidence={evidence} now={clock()} busy={busy} onCheck={() => void check()} onRetire={retire} />}
    {disabled && <p className="alert alert-info">{t("disabled")} <Link href="/dates/configuration">{t("disabledLink")}</Link></p>}
    {entry.state === "unknown" && <p className="field-hint">{t("unknown")}</p>}
    {open && !disabled && waiting.kind !== "blocked" && <form onSubmit={submit}><fieldset className="dates-external-fields" disabled={busy || expired}>
      <div className="row-actions" role="radiogroup" aria-label={t("kind")}>
        {DATES_INTAKE_INPUT_KINDS.map((value) => <label className="checkbox-field" key={value}>
          <input type="radio" name="dates-intake-kind" checked={kind === value} disabled={pending !== null} onChange={() => { changed(); setKind(value); }} /><span>{kinds(value)}</span></label>)}
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
      {!expired && <button type="submit" className="button button-primary" disabled={busy}>{busy ? common("working") : t(pending ? "retry" : "submit")}</button>}
    </form>}
  </section>;
}
