"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import DatesAdminTabs from "@/components/DatesAdminTabs";
import DatesEventPhotos from "@/components/DatesEventPhotos";
import DatesWallEvidenceMedia from "@/components/DatesWallEvidenceMedia";
import DatesCaseHistory from "@/components/DatesCaseHistory";
import { DatesCaseEventLink, DatesCaseTarget, DatesReportEntryPoint } from "@/components/DatesCaseLabels";
import DatesExternalProvenance from "@/components/DatesExternalProvenance";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { adminMembershipFailureText } from "@/lib/adminMembershipFailureText";
import {
  createAdminIdempotencyKey,
  DATES_CASE_NOTE_LIMIT,
  datesAdminPrincipal,
  datesCaseInternalNotes,
  epochFromLocalInput,
  hasDatesCapability,
  humanizeMachineKey,
  datesAppealBlockedByRole,
  datesCaseClaimableByRole,
  datesExternalReviewAllowed,
  isDatesExternalMessageCase,
  permittedResolutionActions,
  resolutionActions,
  type DatesAdminPrincipal,
  type DatesCaseInternalNotes,
} from "@/lib/datesAdmin";
import { formatDate } from "@/lib/format";
import { datesCaseResolutionReceipt } from "@/lib/datesCommandReceipts";
import { datesCommandOutcome, decodeDatesExternalDetail, type DatesExternalDetailRow } from "@/lib/datesExternalAdmin";
import { datesExternalBrowserStorage } from "@/lib/datesExternalMutations";
import { datesExternalResolutionMatches, prepareDatesExternalResolution, readDatesExternalResolution, readDatesExternalResolutionAccess,
  runDatesExternalResolution, type DatesExternalResolutionPending, type DatesExternalResolutionRead } from "@/lib/datesExternalModeration";
import { datesExternalMessageResolutionBaseline, datesExternalMessageResolutionMayStart, prepareDatesExternalMessageResolution,
  readDatesExternalMessageResolution, readDatesExternalMessageResolutionAccess, runDatesExternalMessageResolution,
  type DatesExternalMessageResolutionPending, type DatesExternalMessageResolutionRead } from "@/lib/datesExternalMessageModeration";
import { DatesCaseReadFence, datesCaseDetail, datesEvidenceRead, datesLegalHoldAllowed, datesLegalHoldCommandReceipt,
  datesConsoleCommandReceipt, datesTrailEvidenceCommandReceipt, isDatesConsoleCommand,
  type DatesCaseDetail, type DatesEvidenceRead } from "@/lib/datesModerationRead";
import type { DatesWallMediaAccess } from "@/lib/datesWallMedia";

/** `refresh` adds the operator's own "Refresh the case" beside the message; the page never rereads by itself after an unknown outcome. */
type Feedback = { tone: "success" | "error"; text: string; refresh?: boolean };
type ConfirmedOperation = { kind: "resolve" | "legal_hold"; label: string; payload: Record<string, unknown> };

function safeJson(value: unknown): string {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export default function DatesModerationCasePage() {
  const params = useParams<{ caseId: string }>();
  const caseId = useMemo(() => {
    try { return decodeURIComponent(params.caseId || ""); } catch { return ""; }
  }, [params.caseId]);
  return <DatesModerationCase key={caseId} caseId={caseId} />;
}

function DatesModerationCase({ caseId }: { caseId: string }) {
  const t = useTranslations("datesAdmin.caseDetail");
  const membership = useTranslations("adminMembership");
  const external = useTranslations("datesAdmin.external");
  const commandOutcome = useTranslations("datesAdmin.commandOutcome");
  const messageReview = useTranslations("datesAdmin.external.messageModeration");
  const common = useTranslations("common");
  const locale = useLocale();
  const readFence = useRef(new DatesCaseReadFence()).current;
  const lifetime = useRef(0), mutationBusy = useRef(false);
  const [data, setData] = useState<DatesCaseDetail | null>(null);
  const [externalEvent, setExternalEvent] = useState<DatesExternalDetailRow | null>(null);
  const [externalPending, setExternalPending] = useState<DatesExternalResolutionRead>({ kind: "blocked" });
  const [externalNeedsReload, setExternalNeedsReload] = useState(false);
  const [messagePending, setMessagePending] = useState<DatesExternalMessageResolutionRead>({ kind: "blocked" });
  const [messageNeedsReload, setMessageNeedsReload] = useState(false);
  const [principal, setPrincipal] = useState<DatesAdminPrincipal | null>(null);
  const [notes, setNotes] = useState<DatesCaseInternalNotes>({ status: "unsupported" });
  // The evidence that is shown, with the scope it was read with: the private media of the list is read with that scope.
  const [evidence, setEvidence] = useState<(DatesEvidenceRead & { sent: DatesWallMediaAccess }) | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "not-found">("loading");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [confirmed, setConfirmed] = useState<ConfirmedOperation | null>(null);
  const [breakGlass, setBreakGlass] = useState(false);
  const [breakGlassReason, setBreakGlassReason] = useState("");
  const [evidenceSensitive, setEvidenceSensitive] = useState(false);
  const [evidenceReason, setEvidenceReason] = useState("");
  const [trailFrom, setTrailFrom] = useState("");
  const [trailTo, setTrailTo] = useState("");
  const [trailReason, setTrailReason] = useState("");
  const [note, setNote] = useState("");
  const [noteReason, setNoteReason] = useState("");
  const [escalationReason, setEscalationReason] = useState("");
  const [resolutionAction, setResolutionAction] = useState("");
  const [resolutionReason, setResolutionReason] = useState("");
  const [visibleReasonEn, setVisibleReasonEn] = useState("");
  const [visibleReasonHu, setVisibleReasonHu] = useState("");
  const [restrictionExpiry, setRestrictionExpiry] = useState("");
  const [holdAction, setHoldAction] = useState("place");
  const [holdReason, setHoldReason] = useState("");
  const [legalBasis, setLegalBasis] = useState("");
  const [holdReviewAt, setHoldReviewAt] = useState("");

  const load = useCallback(async () => {
    const ticket = readFence.begin();
    setEvidence(null);
    setData(null);
    setExternalEvent(null);
    setPrincipal(null);
    setConfirmed(null);
    setBreakGlass(false);
    setEvidenceSensitive(false);
    if (!/^cas_[a-f0-9]{32}$/.test(caseId)) {
      setState("not-found");
      return;
    }
    setState("loading");
    const [response, identity] = await Promise.all([
      adminCall("dates_moderation_detail", { case_id: caseId }),
      adminCall("admin_me"),
    ]);
    if (!readFence.accepts(ticket)) return;
    if (response?.error === "dates-moderation-case-unavailable") {
      setState("not-found");
      return;
    }
    const nextPrincipal = datesAdminPrincipal(identity);
    const next = datesCaseDetail(response, caseId);
    if (!next || !nextPrincipal) {
      setPrincipal(null);
      setState("error");
      return;
    }
    let factsUnavailable = false;
    if (next.case.target_type === "external_event" && next.case.external_target_available) {
      const eventResponse = await adminCall("dates_external_event_detail", { external_event_id: next.case.target_id });
      if (!readFence.accepts(ticket)) return;
      const detail = decodeDatesExternalDetail(eventResponse, next.case.target_id);
      if (!detail || detail.event.revision !== next.case.external_revision || detail.event.activity_id !== next.case.activity_id) {
        factsUnavailable = true;
        setFeedback({ tone: "error", text: external("moderation.factsUnavailable") });
      } else setExternalEvent(detail.event);
    }
    setData(next);
    setNotes(datesCaseInternalNotes(response));
    setPrincipal(nextPrincipal);
    setExternalPending(next.case.target_type === "external_event"
      ? readDatesExternalResolution(datesExternalBrowserStorage(), nextPrincipal.email) : { kind: "empty" });
    setMessagePending(isDatesExternalMessageCase(next.case)
      ? readDatesExternalMessageResolution(datesExternalBrowserStorage(), nextPrincipal.email) : { kind: "empty" });
    setMessageNeedsReload(false);
    // Retained case history and exact receipt recovery do not depend on a
    // second successful facts read. New decisions still require a coherent pair.
    setExternalNeedsReload(factsUnavailable);
    const permitted = permittedResolutionActions(next.case, nextPrincipal);
    setResolutionAction((current) => permitted.includes(current) ? current : permitted[0] || "");
    setState("ready");
  }, [caseId, readFence, external]);

  useEffect(() => { void load(); return () => { readFence.invalidate(); ++lifetime.current; }; }, [load, readFence]);

  const writeLocked = busy || externalPending.kind !== "empty" || externalNeedsReload
    || messagePending.kind !== "empty" || messageNeedsReload;

  /**
   * The receipt of a legal hold, a trail capture or a resolution, bound to the request it answers, with what the page
   * says about it and the case revision it leaves; `null`: the body is no receipt of this command (the outcome is then
   * not known). The four console commands are read in `mutate` itself.
   */
  function commandSettled(action: string, payload: Record<string, unknown>, response: unknown, successMessage: string):
    { message: string; revision: number | null } | null {
    if (action === "dates_moderation_legal_hold") {
      // What the hold did, as Core says it (T-891): placed, amended, released - or nothing, because it was already so.
      const receipt = datesLegalHoldCommandReceipt(response, payload);
      if (receipt === null) return null;
      const message = receipt.hold_change === null ? successMessage
        : t(receipt.hold_change === "unchanged" ? (payload.action === "place" ? "legalHoldAlreadyInPlace" : "legalHoldNothingHeld")
          : receipt.hold_change === "placed" ? "legalHoldPlaced" : receipt.hold_change === "amended" ? "legalHoldAmended" : "legalHoldReleased");
      return { message, revision: receipt.revision };
    }
    if (action === "dates_moderation_trail_evidence") {
      const receipt = datesTrailEvidenceCommandReceipt(response, payload);
      return receipt === null ? null : { message: receipt.existing ? t("trailEvidenceExisting") : successMessage, revision: receipt.revision };
    }
    return datesCaseResolutionReceipt(response, payload) ? { message: successMessage, revision: (response as { revision: number }).revision } : null;
  }

  /** A receipt's case revision, adopted at once: it never moves back, and never to nothing. The case is then read again. */
  function adoptCaseRevision(revision: number | null) {
    if (revision === null) return;
    setData((current) => current && current.case.case_id === caseId && revision > current.case.revision
      ? { ...current, case: { ...current.case, revision } } : current);
  }

  /**
   * One command. `skipped`: nothing was sent. `abandoned`: it was sent, and the page moved on before the answer.
   * `refused`: an answer that wrote nothing. `uncertain`: nothing says whether it landed - no answer, an unreadable
   * one, a transport or server failure - so the page says exactly that, and changes nothing else.
   * Every command of this page is fenced in Core by the case revision - since T-891 the legal hold and the trail
   * capture too - so each attempt carries its own key: a repeat of a command that did land is refused as stale.
   */
  async function mutate(action: string, payload: Record<string, unknown>, successMessage: string) {
    if (writeLocked || mutationBusy.current) return "skipped" as const;
    mutationBusy.current = true;
    const ticket = readFence.begin(), currentLifetime = lifetime.current;
    setEvidence(null);
    setBusy(true);
    setFeedback(null);
    try {
      let response: Awaited<ReturnType<typeof adminCall>> = null;
      try { response = await adminCall(action, payload); } catch { response = null; }
      if (!readFence.accepts(ticket)) return "abandoned" as const;
      const consoleReceipt = isDatesConsoleCommand(action) ? datesConsoleCommandReceipt(response, action, caseId, payload.expected_revision) : null;
      const settled = !isDatesConsoleCommand(action) ? commandSettled(action, payload, response, successMessage)
        : consoleReceipt === null ? null : { message: successMessage, revision: consoleReceipt.revision };
      const outcome = datesCommandOutcome(response, settled !== null, "fresh");
      if (outcome.kind === "refused") {
        setFeedback({ tone: "error", text: t("operationFailed", { error: outcome.error }) });
        return "refused" as const;
      }
      if (outcome.kind === "uncertain") {
        const key = `unknown${outcome.error === null ? "" : "Answered"}`;
        // Wording only. Nothing on the page changes: a reread would clear the evidence the operator has read, the
        // break-glass choice and the confirmation, and under a continuing outage replace the page with an error.
        // Whether to read the case again is the operator's decision, offered beside the message.
        setFeedback({ tone: "error", text: commandOutcome(key, { error: outcome.error ?? "" }), refresh: true });
        return "uncertain" as const;
      }
      adoptCaseRevision(settled!.revision);
      setFeedback({ tone: "success", text: settled!.message });
      await load();
      return "success" as const;
    } finally {
      mutationBusy.current = false;
      if (currentLifetime === lifetime.current) setBusy(false);
    }
  }

  async function claim() {
    if (!data || !principal || !datesCaseClaimableByRole(data.case, principal)) return;
    const usedBreakGlass = data.case.conflict_of_interest && breakGlass;
    if (usedBreakGlass && breakGlassReason.trim().length < 3) {
      setFeedback({ tone: "error", text: t("breakGlassReasonRequired") });
      return;
    }
    await mutate("dates_moderation_claim", {
      case_id: caseId,
      expected_revision: data.case.revision,
      break_glass: usedBreakGlass,
      reason: usedBreakGlass ? breakGlassReason.trim() : null,
      idempotency_key: createAdminIdempotencyKey("dates-case-claim"),
    }, t("claimed"));
  }

  async function lease(operation: "heartbeat" | "release") {
    if (!data) return;
    await mutate(`dates_moderation_${operation}`, {
      case_id: caseId,
      expected_revision: data.case.revision,
      reason: breakGlassReason.trim() || null,
      idempotency_key: createAdminIdempotencyKey(`dates-case-${operation}`),
    }, t(operation === "heartbeat" ? "leaseExtended" : "released"));
  }

  async function readEvidence(event: React.FormEvent) {
    event.preventDefault();
    if (!data || !principal || !datesExternalReviewAllowed(data.case, principal) || busy) return;
    setEvidence(null);
    const conflictBreakGlass = data.case.conflict_of_interest && breakGlass;
    const includeSensitiveLocation = data.case.target_type !== "external_event"
      && !isDatesExternalMessageCase(data.case) && evidenceSensitive;
    if ((includeSensitiveLocation || conflictBreakGlass) && evidenceReason.trim().length < 3) {
      setFeedback({ tone: "error", text: t("evidenceReasonRequired") });
      return;
    }
    const ticket = readFence.begin();
    setBusy(true);
    setFeedback(null);
    const sent = { include_sensitive_location: includeSensitiveLocation, break_glass: conflictBreakGlass, reason: evidenceReason.trim() || null };
    const response = await adminCall("dates_moderation_evidence", { case_id: caseId, ...sent });
    if (!readFence.accepts(ticket)) return;
    setBusy(false);
    const decoded = datesEvidenceRead(response, { case_id: caseId, appeal_id: data.appeal?.appeal_id ?? null,
      include_sensitive_location: includeSensitiveLocation, break_glass: conflictBreakGlass });
    if (!decoded) {
      setFeedback({ tone: "error", text: adminMembershipFailureText(response?.error, t("operationFailed", { error: String(response?.error || "core-unavailable") }), membership("requestUnconfirmed")) });
      return;
    }
    setEvidence({ ...decoded, sent });
    setFeedback({ tone: "success", text: t("evidenceLoaded") });
  }

  async function addNote(event: React.FormEvent) {
    event.preventDefault();
    if (!data || note.trim().length < 1) return;
    if (data.case.conflict_of_interest && breakGlass && noteReason.trim().length < 3) {
      setFeedback({ tone: "error", text: t("breakGlassReasonRequired") });
      return;
    }
    const result = await mutate("dates_moderation_note", {
      case_id: caseId,
      expected_revision: data.case.revision,
      note: note.trim(),
      break_glass: data.case.conflict_of_interest && breakGlass,
      reason: noteReason.trim() || null,
      idempotency_key: createAdminIdempotencyKey("dates-case-note"),
    }, t("noteAdded"));
    if (result === "success") { setNote(""); setNoteReason(""); }
  }

  async function captureTrailEvidence(event: React.FormEvent) {
    event.preventDefault();
    if (!data || busy || data.case.target_type === "external_event" || isDatesExternalMessageCase(data.case) || !data.case.activity_id) return;
    const capturedFrom = epochFromLocalInput(trailFrom);
    const capturedTo = epochFromLocalInput(trailTo);
    if (!capturedFrom || !capturedTo || capturedTo <= capturedFrom || trailReason.trim().length < 3) {
      setFeedback({ tone: "error", text: t("trailEvidenceInputInvalid") });
      return;
    }
    const result = await mutate("dates_moderation_trail_evidence", {
      case_id: caseId,
      expected_revision: data.case.revision,
      captured_from: capturedFrom,
      captured_to: capturedTo,
      reason: trailReason.trim(),
      break_glass: data.case.conflict_of_interest && breakGlass,
      idempotency_key: createAdminIdempotencyKey("dates-case-trail-evidence"),
    }, t("trailEvidenceCaptured"));
    // A capture moves the case revision (T-891): repeated under a new key after it landed, it is refused as stale; the
    // same window at the current revision is answered with the snapshot that exists. The form keeps what was sent
    // until the capture is confirmed.
    if (result === "success") {
      setTrailFrom("");
      setTrailTo("");
      setTrailReason("");
      setEvidence(null);
    }
  }

  async function escalate(event: React.FormEvent) {
    event.preventDefault();
    if (!data || escalationReason.trim().length < 3) return;
    const result = await mutate("dates_moderation_escalate", {
      case_id: caseId,
      expected_revision: data.case.revision,
      reason: escalationReason.trim(),
      idempotency_key: createAdminIdempotencyKey("dates-case-escalate"),
    }, t("escalated"));
    if (result === "success") setEscalationReason("");
  }

  function prepareResolution(event: React.FormEvent) {
    event.preventDefault();
    if (writeLocked || !data || !principal || !permittedResolutionActions(data.case, principal).includes(resolutionAction)) return;
    if (resolutionReason.trim().length < 3 || visibleReasonEn.trim().length < 1 || visibleReasonHu.trim().length < 1) return;
    setConfirmed({
      kind: "resolve",
      label: t(`actions.${resolutionAction}`),
      payload: {
        case_id: caseId,
        expected_revision: data.case.revision,
        ...(data.case.target_type === "external_event" ? { expected_external_revision: data.case.external_revision } : {}),
        action: resolutionAction,
        reason: resolutionReason.trim(),
        user_visible_reason_en: visibleReasonEn.trim(),
        user_visible_reason_hu: visibleReasonHu.trim(),
        expires_at: resolutionAction === "restrict_dates" ? epochFromLocalInput(restrictionExpiry) : null,
        break_glass: data.case.conflict_of_interest && breakGlass,
        idempotency_key: createAdminIdempotencyKey("dates-case-resolve"),
      },
    });
  }

  function prepareLegalHold(event: React.FormEvent) {
    event.preventDefault();
    if (writeLocked || !data || !principal || !datesLegalHoldAllowed(data.case, principal, holdAction, breakGlass)) return;
    if (holdReason.trim().length < 3 || legalBasis.trim().length < 3 || (holdAction === "place" && !holdReviewAt)) return;
    setConfirmed({
      kind: "legal_hold",
      label: t(holdAction === "place" ? "placeHold" : "releaseHold"),
      payload: {
        case_id: caseId,
        action: holdAction,
        reason: holdReason.trim(),
        legal_basis: legalBasis.trim(),
        break_glass: data.case.conflict_of_interest && breakGlass,
        review_at: holdAction === "place" ? epochFromLocalInput(holdReviewAt) : null,
        // T-891: the hold is fenced by the case revision. With it Core says what the command did (placed, amended,
        // released, or nothing because it was already so) and the revision it leaves; a stale one is refused.
        expected_revision: data.case.revision,
        idempotency_key: createAdminIdempotencyKey(`dates-legal-hold-${holdAction}`),
      },
    });
  }

  async function executeConfirmed() {
    if (!confirmed) return;
    const operation = confirmed;
    if (operation.kind === "resolve" && data?.case.target_type === "external_event") {
      await executeExternalResolution(operation); return;
    }
    if (operation.kind === "resolve" && data && isDatesExternalMessageCase(data.case)) {
      await executeMessageResolution(operation); return;
    }
    const result = await mutate(operation.kind === "resolve" ? "dates_moderation_resolve" : "dates_moderation_legal_hold", operation.payload,
      t(operation.kind === "resolve" ? "resolved" : "legalHoldUpdated"));
    setConfirmed(null);
    if (result === "success" && operation.kind === "legal_hold") { setHoldReason(""); setLegalBasis(""); setHoldReviewAt(""); }
    if (result === "success" && operation.kind === "resolve") {
      setResolutionReason(""); setVisibleReasonEn(""); setVisibleReasonHu(""); setRestrictionExpiry("");
    }
  }

  async function executeExternalResolution(operation: ConfirmedOperation | null, retry: DatesExternalResolutionPending | null = null) {
    if (mutationBusy.current || !principal || (!operation && !retry) || (!retry && writeLocked)) return;
    mutationBusy.current = true; setBusy(true); setEvidence(null); setFeedback(null);
    const ticket = readFence.begin(), currentLifetime = lifetime.current;
    try {
      const body = retry?.body ?? operation!.payload;
      const access = await readDatesExternalResolutionAccess(adminCall, String(body.case_id));
      if (!readFence.accepts(ticket)) return;
      if (access.kind !== "authorized") {
        setConfirmed(null); setFeedback({ tone: "error", text: external(access.kind === "denied"
          ? "moderation.reviewRequired" : "moderation.accessUnconfirmed") }); return;
      }
      if (access.actor !== principal.email || (retry && retry.actor !== access.actor)) {
        setConfirmed(null); setFeedback({ tone: "error", text: external("moderation.reviewRequired") }); return;
      }
      const baseline = retry?.baseline ?? (externalEvent ? { external_event_id: externalEvent.external_event_id,
        activity_id: externalEvent.activity_id, activity_revision: externalEvent.activity_revision } : null);
      if (!baseline || (!retry && (!datesExternalResolutionMatches(access.item, body, baseline)
        || !permittedResolutionActions(access.item, access.principal).includes(String(body.action))))) {
        setExternalNeedsReload(true); setConfirmed(null); setFeedback({ tone: "error", text: external("moderation.reloadRequired") }); return;
      }
      const pending = retry ?? prepareDatesExternalResolution(access.actor, body, baseline, access.serverNow);
      if (!pending) { setConfirmed(null); setFeedback({ tone: "error", text: external("feedback.invalid") }); return; }
      const storage = datesExternalBrowserStorage();
      const result = await runDatesExternalResolution(pending, storage, access.serverNow, adminCall);
      if (!readFence.accepts(ticket)) return;
      setExternalPending(readDatesExternalResolution(storage, access.actor)); setConfirmed(null);
      if (result.kind === "success") {
        setFeedback({ tone: "success", text: external(result.retained ? "feedback.successRetained" : "feedback.success") });
        if (!result.retained) {
          setResolutionReason(""); setVisibleReasonEn(""); setVisibleReasonHu("");
          await load();
        }
      } else if (result.kind === "refused") {
        setExternalNeedsReload(true);
        setFeedback({ tone: "error", text: external(result.retained ? "feedback.refusedRetained" : "moderation.reloadRequired") });
      } else setFeedback({ tone: "error", text: external(`feedback.${result.kind}`) });
    } finally {
      mutationBusy.current = false;
      if (currentLifetime === lifetime.current) setBusy(false);
    }
  }

  async function executeMessageResolution(operation: ConfirmedOperation | null, retry: DatesExternalMessageResolutionPending | null = null) {
    if (mutationBusy.current || !principal || !data || !isDatesExternalMessageCase(data.case)
      || (!operation && !retry) || (!retry && writeLocked)) return;
    const body = retry?.body ?? operation!.payload;
    if (body.case_id !== caseId) return;
    const baseline = retry?.baseline ?? datesExternalMessageResolutionBaseline(data.case);
    mutationBusy.current = true; setBusy(true); setEvidence(null); setFeedback(null);
    const ticket = readFence.begin(), currentLifetime = lifetime.current;
    try {
      const access = await readDatesExternalMessageResolutionAccess(adminCall, caseId);
      if (!readFence.accepts(ticket)) return;
      if (!access || access.actor !== principal.email || (retry && retry.actor !== access.actor)) {
        setConfirmed(null); setFeedback({ tone: "error", text: messageReview("reviewRequired") }); return;
      }
      if (!baseline || (!retry && !datesExternalMessageResolutionMayStart(access.item, access.principal, body, baseline, access.serverNow))) {
        setMessageNeedsReload(true); setConfirmed(null); setFeedback({ tone: "error", text: messageReview("reloadRequired") }); return;
      }
      const pending = retry ?? prepareDatesExternalMessageResolution(access.actor, body, baseline, access.serverNow);
      if (!pending) { setConfirmed(null); setFeedback({ tone: "error", text: messageReview("invalid") }); return; }
      const storage = datesExternalBrowserStorage();
      const result = await runDatesExternalMessageResolution(pending, storage, access.serverNow, adminCall);
      if (!readFence.accepts(ticket)) return;
      setMessagePending(readDatesExternalMessageResolution(storage, access.actor)); setConfirmed(null);
      if (result.kind === "success") {
        setFeedback({ tone: "success", text: messageReview(result.retained ? "successRetained" : "success") });
        if (!result.retained) {
          setResolutionReason(""); setVisibleReasonEn(""); setVisibleReasonHu("");
          await load();
        }
      } else if (result.kind === "refused") {
        setMessageNeedsReload(true);
        setFeedback({ tone: "error", text: messageReview(result.retained ? "refusedRetained" : "reloadRequired") });
      } else setFeedback({ tone: "error", text: messageReview(result.kind) });
    } finally {
      mutationBusy.current = false;
      if (currentLifetime === lifetime.current) setBusy(false);
    }
  }

  if (state === "loading") return <LoadingPanel />;
  if (state === "not-found") return <ErrorPanel message={t("notFound")} retry={() => void load()} />;
  if (state === "error" || !data || !principal) return <ErrorPanel message={t("loadError")} retry={() => void load()} />;

  const item = data.case;
  const isExternal = item.target_type === "external_event";
  const isExternalMessage = isDatesExternalMessageCase(item);
  const assignedToMe = item.assignee_email?.toLowerCase() === principal.email.toLowerCase();
  const leaseActive = (item.claim_expires_at || 0) > Math.floor(Date.now() / 1000);
  const canBreakGlass = item.capabilities.can_break_glass && principal.break_glass;
  const appealBlocked = datesAppealBlockedByRole(item, principal);
  const mayClaim = datesCaseClaimableByRole(item, principal) && (item.capabilities.can_claim || (item.conflict_of_interest && canBreakGlass));
  const mayReadEvidence = datesExternalReviewAllowed(item, principal)
    && (item.capabilities.can_read_evidence || (item.conflict_of_interest && canBreakGlass));
  const mayCaptureTrail = Boolean(
    !isExternal && !isExternalMessage && item.activity_id
    && principal.sensitive_location
    && hasDatesCapability(principal, "dates_trail_evidence_capture")
    && (!item.conflict_of_interest || (canBreakGlass && breakGlass)),
  );
  const actions = permittedResolutionActions(item, principal);
  const mayResolve = actions.length > 0 && (item.capabilities.can_resolve || (item.conflict_of_interest && canBreakGlass && assignedToMe && leaseActive));
  const restrictionActionsHidden = actions.length > 0 && resolutionActions(item).some((action) => !actions.includes(action));

  return (
    <>
      <Link className="back-link" href="/dates/moderation">← {t("back")}</Link>
      <PageHeader eyebrow={t("eyebrow")} title={item.case_id} subtitle={t("subtitle", { queue: humanizeMachineKey(item.queue), revision: item.revision })} actions={<button className="button button-secondary" onClick={() => void load()} disabled={busy}>{common("refresh")}</button>} />
      <DatesAdminTabs />
      {feedback && <div className={`alert ${feedback.tone === "success" ? "alert-success" : "alert-error"} page-alert`} role="status">{feedback.text}
        {feedback.refresh && <> <button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => void load()}>{commandOutcome("refreshCase")}</button></>}</div>}
      {item.conflict_of_interest && <div className="alert alert-error page-alert"><strong>{t("conflictTitle")}</strong> {t("conflictCopy")}</div>}
      {isExternal && <section className="panel dates-external-fields">
        <span className="badge badge-demo">{external("badge")}</span>
        <p>{external("moderation.boundary")}</p>
        <p>{item.external_target_available ? external("moderation.revisions", { caseRevision: item.revision, eventRevision: item.external_revision! }) : external("moderation.unavailable")}</p>
        {!datesExternalReviewAllowed(item, principal) && <p className="alert alert-info">{external("moderation.reviewRequired")}</p>}
        {externalEvent && <><h2>{externalEvent.title}</h2><p className="preserve-whitespace">{locale === "hu" ? externalEvent.facts.summary.hu : externalEvent.facts.summary.en}</p>
          <Link href={`/dates/external/${item.target_id}`}>{external("editor.detailTitle")}</Link></>}
      </section>}
      {externalEvent && <DatesExternalProvenance event={externalEvent} />}
      {isExternalMessage && <section className="panel dates-external-fields">
        <span className="badge badge-demo">{messageReview("badge")}</span>
        <h2>{messageReview("title")}</h2><p>{messageReview("boundary")}</p>
        {typeof item.external_message?.revision === "number" && <p>{messageReview("revisions", { caseRevision: item.revision, messageRevision: item.external_message.revision })}</p>}
        {item.external_message?.moderation_state && <p>{messageReview(`states.${item.external_message.moderation_state}`)}</p>}
        {!item.external_message?.available && <p className="alert alert-info">{messageReview("unavailable")}</p>}
      </section>}
      {isExternal && externalPending.kind !== "empty" && <section className="panel dates-external-fields">
        <h2>{external("moderation.pendingTitle")}</h2>
        {externalPending.kind === "blocked" ? <p>{external("pending.blocked")}</p> : <>
          <p>{external("moderation.pendingCopy")}</p><code>{externalPending.pending.body.idempotency_key}</code>
          <details><summary>{external("pending.payload")}</summary><pre className="dates-external-payload">{JSON.stringify(externalPending.pending.body, null, 2)}</pre></details>
          {externalPending.pending.body.case_id !== caseId ? <Link href={`/dates/moderation/${externalPending.pending.body.case_id}`}>{external("pending.open")}</Link>
            : <button className="button button-primary" disabled={busy || !datesExternalReviewAllowed(item, principal) || !hasDatesCapability(principal, "dates_case_resolve")}
              onClick={() => void executeExternalResolution(null, externalPending.pending)}>{external("pending.retry")}</button>}
        </>}
      </section>}
      {isExternalMessage && messagePending.kind !== "empty" && <section className="panel dates-external-fields">
        <h2>{messageReview("pendingTitle")}</h2>
        {messagePending.kind === "blocked" ? <p>{messageReview("blocked")}</p> : <>
          <p>{messageReview("pendingCopy")}</p><code>{messagePending.pending.body.idempotency_key}</code>
          <details><summary>{external("pending.payload")}</summary><pre className="dates-external-payload">{JSON.stringify(messagePending.pending.body, null, 2)}</pre></details>
          {messagePending.pending.body.case_id !== caseId ? <Link href={`/dates/moderation/${messagePending.pending.body.case_id}`}>{external("pending.open")}</Link>
            : <button className="button button-primary" disabled={busy || !hasDatesCapability(principal, "dates_case_resolve")}
              onClick={() => void executeMessageResolution(null, messagePending.pending)}>{external("pending.retry")}</button>}
        </>}
      </section>}

      <div className="dates-detail-grid">
        <section className="panel">
          <div className="panel-header"><div><h2>{t("caseOverview")}</h2><p>{t("caseOverviewCopy")}</p></div><div className="row-actions"><span className={`badge ${["new", "in_review", "appealed"].includes(item.status) ? "badge-warning" : "badge-active"}`}>{humanizeMachineKey(item.status)}</span><span className={`badge ${["high", "critical"].includes(item.severity) ? "badge-warning" : ""}`}>{humanizeMachineKey(item.severity)}</span></div></div>
          <div className="panel-body"><dl className="detail-list">
            <div className="detail-row"><dt>{t("queue")}</dt><dd>{humanizeMachineKey(item.queue)} · {humanizeMachineKey(item.case_kind)}</dd></div>
            <div className="detail-row"><dt>{t("target")}</dt><dd><DatesCaseTarget item={item} /></dd></div>
            <div className="detail-row"><dt>{t("subject")}</dt><dd>{isExternal ? external("moderation.nonmember") : `UID ${item.target_uid}`}{item.activity_id && <> · <DatesCaseEventLink activityId={item.activity_id} /></>}</dd></div>
            <div className="detail-row"><dt>{t("reports")}</dt><dd>{item.report_count} · {t("distinctReporters", { count: item.distinct_reporter_count })}</dd></div>
            <div className="detail-row"><dt>{t("assignee")}</dt><dd>{item.assignee_email || t("unassigned")}</dd></div>
            <div className="detail-row"><dt>{t("claimExpiry")}</dt><dd>{item.claim_expires_at ? formatDate(item.claim_expires_at, locale, true) : "—"}</dd></div>
            <div className="detail-row"><dt>{t("slaDue")}</dt><dd className={item.sla_breached ? "dates-danger-text" : ""}>{item.sla_due_at ? formatDate(item.sla_due_at, locale, true) : "—"}{item.sla_breached ? ` · ${t("breached")}` : ""}</dd></div>
            <div className="detail-row"><dt>{common("createdAt")}</dt><dd>{formatDate(item.created_at, locale, true)}</dd></div>
          </dl></div>
        </section>

        <section className="panel">
          <div className="panel-header"><div><h2>{t("claimTitle")}</h2><p>{t("claimCopy")}</p></div></div>
          <div className="panel-body form-stack">
            {item.conflict_of_interest && canBreakGlass && <><label className="checkbox-field"><input type="checkbox" checked={breakGlass} disabled={busy} onChange={(event) => { readFence.invalidate(); setEvidence(null); setBreakGlass(event.target.checked); }} /><span>{t("useBreakGlass")}</span></label><label className="field"><span>{t("breakGlassReason")}</span><textarea required={breakGlass} value={breakGlassReason} onChange={(event) => setBreakGlassReason(event.target.value)} /></label></>}
            <div className="row-actions">
              {mayClaim && <button className="button button-primary" onClick={() => void claim()} disabled={writeLocked || (item.conflict_of_interest && !breakGlass)}>{t("claim")}</button>}
              {assignedToMe && leaseActive && <><button className="button button-secondary" onClick={() => void lease("heartbeat")} disabled={writeLocked}>{t("heartbeat")}</button><button className="button button-danger" onClick={() => void lease("release")} disabled={writeLocked}>{t("release")}</button></>}
            </div>
            {!mayClaim && !assignedToMe && <p className="page-subtitle">{appealBlocked ? t("appealClaimUnavailable") : t("claimUnavailable")}</p>}
            {appealBlocked && assignedToMe && leaseActive && <p className="alert alert-info">{t("appealDecisionUnavailable")}</p>}
          </div>
        </section>
      </div>

      <section className="panel dates-section">
        <div className="panel-header"><div><h2>{t("reportsTitle")}</h2><p>{t("reportsCopy")}</p></div></div>
        {data.report_notes_withheld && <p className="alert alert-warning">{t("reportNotesWithheld")}</p>}
        <div className="table-wrap dates-embedded-table">{data.reports.length === 0 ? <div className="empty-state dates-compact-empty"><p>{t("noReports")}</p></div> : <table className="data-table"><thead><tr><th>{t("reportId")}</th><th>{t("reason")}</th><th>{t("entryPoint")}</th><th>{t("note")}</th><th>{common("createdAt")}</th></tr></thead><tbody>{data.reports.map((report) => <tr key={report.report_id}><td>{report.report_id}</td><td><div className="cell-stack"><span>{displayReason(report.reason_label_snapshot, locale)}</span><small>{report.reason_key} · {humanizeMachineKey(report.severity)}</small></div></td><td><DatesReportEntryPoint value={report.entry_point} /></td><td className="dates-wrapping-cell">{report.note || "—"}</td><td>{formatDate(report.created_at, locale, true)}</td></tr>)}</tbody></table>}</div>
      </section>

      <section className="panel dates-section">
        <div className="panel-header"><div><h2>{t("notesTitle")}</h2><p>{t("notesCopy")}</p></div></div>
        <div className="panel-body">
          {notes.status === "withheld" ? <p className="alert alert-warning">{t("notesWithheld")}</p>
            : notes.status === "invalid" ? <p className="alert alert-error">{t("notesInvalid")}</p>
              : notes.status === "unsupported" ? <p className="page-subtitle">{t("notesUnsupported")}</p>
                : notes.notes.length === 0 ? <p className="page-subtitle">{t("noNotes")}</p>
                  : <ol className="dates-note-list">{notes.notes.map((entry) => <li key={entry.note_id}><div className="dates-note-meta"><strong>{entry.author_email}</strong><time dateTime={new Date(entry.created_at * 1000).toISOString()}>{formatDate(entry.created_at, locale, true)}</time></div><p className="dates-note-text">{entry.text}</p></li>)}</ol>}
          {notes.status === "ready" && notes.notes.length >= DATES_CASE_NOTE_LIMIT && <p className="field-hint">{t("notesLimited", { limit: DATES_CASE_NOTE_LIMIT })}</p>}
        </div>
      </section>

      <section className="panel dates-section">
        <div className="panel-header"><div><h2>{t("evidenceTitle")}</h2><p>{t("evidenceCopy")}</p></div></div>
        <div className="panel-body">
          {!mayReadEvidence ? <p className="page-subtitle">{t("evidenceUnavailable")}</p> : <form className="dates-evidence-controls" onSubmit={readEvidence}>
            {!isExternal && !isExternalMessage && principal.sensitive_location && <label className="checkbox-field"><input type="checkbox" checked={evidenceSensitive} disabled={busy} onChange={(event) => { readFence.invalidate(); setEvidence(null); setEvidenceSensitive(event.target.checked); }} /><span>{t("includeSensitiveLocation")}</span></label>}
            <label className="field"><span>{t("auditReason")}</span><input value={evidenceReason} required={evidenceSensitive || (item.conflict_of_interest && breakGlass)} onChange={(event) => setEvidenceReason(event.target.value)} placeholder={t("auditReasonPlaceholder")} /></label>
            <button className="button button-danger" type="submit" disabled={busy || (item.conflict_of_interest && !breakGlass)}>{t("readEvidence")}</button>
          </form>}
          {evidence && <div className="dates-evidence-list">
            <p className="field-hint">{t("evidenceAuditReceipt", { id: evidence.audit_id })}</p>
            {evidence.appeal_note && <article><div className="dates-evidence-header"><strong>{t("appellantNote")}</strong><time dateTime={new Date(evidence.appeal_note.created_at * 1000).toISOString()}>{formatDate(evidence.appeal_note.created_at, locale, true)}</time></div><p className="dates-note-text">{evidence.appeal_note.note ?? t("noAppellantNote")}</p></article>}
            {evidence.evidence.length === 0 && evidence.appeal_note === null && <p className="page-subtitle">{t("noEvidence")}</p>}
            {evidence.evidence.map((entry) => <article key={String(entry.evidence_id)}><div className="dates-evidence-header"><strong>{String(entry.evidence_id)}</strong><span className="badge">{humanizeMachineKey(String(entry.evidence_type))}</span></div><DatesEventPhotos source={entry.snapshot} /><DatesWallEvidenceMedia source={entry.snapshot} caseId={item.case_id} evidenceId={String(entry.evidence_id)} access={evidence.sent} /><pre>{safeJson(entry)}</pre></article>)}
            {evidence.redacted_sensitive_location_count > 0 && <p className="alert alert-info">{t("redactedEvidence", { count: evidence.redacted_sensitive_location_count })}</p>}
          </div>}
        </div>
      </section>

      {!isExternal && !isExternalMessage && principal.sensitive_location && hasDatesCapability(principal, "dates_trail_evidence_capture") && item.activity_id && <section className="panel dates-section">
        <div className="panel-header"><div><h2>{t("trailEvidenceTitle")}</h2><p>{t("trailEvidenceCopy")}</p></div></div>
        <div className="panel-body">
          <form className="dates-evidence-controls" onSubmit={captureTrailEvidence}>
            <label className="field"><span>{t("trailFrom")}</span><input type="datetime-local" required value={trailFrom} onChange={(event) => setTrailFrom(event.target.value)} /></label>
            <label className="field"><span>{t("trailTo")}</span><input type="datetime-local" required value={trailTo} onChange={(event) => setTrailTo(event.target.value)} /></label>
            <label className="field"><span>{t("trailReason")}</span><input required minLength={3} maxLength={500} value={trailReason} onChange={(event) => setTrailReason(event.target.value)} /></label>
            <button className="button button-danger" type="submit" disabled={writeLocked || !mayCaptureTrail}>{t("captureTrailEvidence")}</button>
          </form>
        </div>
      </section>}

      {assignedToMe && leaseActive && <div className="section-grid dates-section">
        {hasDatesCapability(principal, "dates_case_note") && <section className="panel"><div className="panel-header"><div><h2>{t("noteTitle")}</h2><p>{t("noteCopy")}</p></div></div><form className="panel-body form-stack" onSubmit={addNote}><label className="field"><span>{t("internalNote")}</span><textarea required maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label><label className="field"><span>{t("auditReasonOptional")}</span><input value={noteReason} onChange={(event) => setNoteReason(event.target.value)} /></label><button className="button button-primary" type="submit" disabled={writeLocked}>{t("addNote")}</button></form></section>}
        {hasDatesCapability(principal, "dates_case_resolve") && !item.conflict_of_interest && <section className="panel"><div className="panel-header"><div><h2>{t("escalateTitle")}</h2><p>{t("escalateCopy")}</p></div></div><form className="panel-body form-stack" onSubmit={escalate}><label className="field"><span>{t("auditReason")}</span><textarea required value={escalationReason} onChange={(event) => setEscalationReason(event.target.value)} /></label><button className="button button-danger" type="submit" disabled={writeLocked || item.escalated}>{item.escalated ? t("alreadyEscalated") : t("escalate")}</button></form></section>}
      </div>}

      {mayResolve && <section className="panel dates-section dates-resolution-panel">
        <div className="panel-header"><div><h2>{t("resolutionTitle")}</h2><p>{t("resolutionCopy")}</p></div></div>
        <form className="panel-body form-grid" onSubmit={prepareResolution}>
          <label className="field"><span>{t("action")}</span><select value={resolutionAction} onChange={(event) => setResolutionAction(event.target.value)}>{actions.map((action) => <option key={action} value={action}>{t(`actions.${action}`)}</option>)}</select>{restrictionActionsHidden && <small className="field-hint">{t("restrictionActionsUnavailable")}</small>}</label>
          {resolutionAction === "restrict_dates" && <label className="field"><span>{t("restrictionExpiry")}</span><input type="datetime-local" value={restrictionExpiry} onChange={(event) => setRestrictionExpiry(event.target.value)} /></label>}
          <label className="field field-full"><span>{t("internalReason")}</span><textarea required maxLength={1000} value={resolutionReason} onChange={(event) => setResolutionReason(event.target.value)} /></label>
          <label className="field"><span>{t("visibleReasonEn")}</span><textarea required maxLength={500} value={visibleReasonEn} onChange={(event) => setVisibleReasonEn(event.target.value)} /></label>
          <label className="field"><span>{t("visibleReasonHu")}</span><textarea required maxLength={500} value={visibleReasonHu} onChange={(event) => setVisibleReasonHu(event.target.value)} /></label>
          <div className="field-full"><button className="button button-danger" type="submit" disabled={writeLocked || (item.conflict_of_interest && !breakGlass)}>{t("prepareResolution")}</button></div>
        </form>
      </section>}

      {hasDatesCapability(principal, "dates_legal_hold") && <section className="panel dates-section">
        <div className="panel-header"><div><h2>{t("legalHoldTitle")}</h2><p>{t("legalHoldCopy")}</p></div></div>
        <form className="panel-body form-grid" onSubmit={prepareLegalHold}>
          <label className="field"><span>{t("holdAction")}</span><select value={holdAction} onChange={(event) => setHoldAction(event.target.value)}><option value="place">{t("placeHold")}</option><option value="release" disabled={["new", "in_review", "appealed"].includes(item.status)}>{t("releaseHold")}</option></select></label>
          {["new", "in_review", "appealed"].includes(item.status) && <p className="field-full field-hint">{t("holdReleaseCaseOpen")}</p>}
          {item.conflict_of_interest && !(canBreakGlass && breakGlass) && <p className="field-full alert alert-warning">{t("holdConflictUnavailable")}</p>}
          {holdAction === "place" && <label className="field"><span>{t("reviewAt")}</span><input type="datetime-local" required value={holdReviewAt} onChange={(event) => setHoldReviewAt(event.target.value)} /></label>}
          <label className="field"><span>{t("auditReason")}</span><textarea required value={holdReason} onChange={(event) => setHoldReason(event.target.value)} /></label>
          <label className="field"><span>{t("legalBasis")}</span><textarea required value={legalBasis} onChange={(event) => setLegalBasis(event.target.value)} /></label>
          <div className="field-full"><button className="button button-danger" type="submit" disabled={writeLocked || !datesLegalHoldAllowed(item, principal, holdAction, breakGlass)}>{t("prepareLegalHold")}</button></div>
        </form>
      </section>}

      <DatesCaseHistory decisions={data.decisions} appeal={data.appeal} />

      {confirmed && <ConfirmDialog title={t("confirmTitle", { action: confirmed.label })} copy={t("confirmCopy")} confirmLabel={t("confirmAction")} busy={busy} onCancel={() => setConfirmed(null)} onConfirm={() => void executeConfirmed()} />}
    </>
  );
}

function displayReason(value: unknown, locale: string): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    if ((row.locale === "en" || row.locale === "hu") && typeof row.label === "string") return row.label;
    const key = locale.startsWith("hu") ? "hu" : "en";
    return String(row[key] || row.en || row.hu || "—");
  }
  return value ? String(value) : "—";
}
