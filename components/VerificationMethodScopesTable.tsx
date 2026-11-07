"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import VerificationGateModeControl, {
  VerificationClosedModeControl,
  VerificationClosedModeImpact,
  VerificationGateModeLegend,
  useClosedModeLabel,
} from "@/components/VerificationGateModeControl";
import { adminCall, type AdminResponse } from "@/lib/adminClient";
import {
  WAITING_ROOM_COPY_FIELDS,
  WAITING_ROOM_COPY_LIMITS,
  WAITING_ROOM_HELP_URL_MAX_BYTES,
  WAITING_ROOM_LOCALES,
  forcedCopyTrim,
  forcedStorefrontName,
  localizedForcedStorefronts,
  previewWaitingRoomCopy,
  waitingRoomCopyDraft,
  waitingRoomHelpUrlByteLength,
  waitingRoomHelpUrlDraftIssue,
  waitingRoomTextLength,
  type WaitingRoomCopy,
  type WaitingRoomCopyDraft,
  type WaitingRoomCopyField,
  type WaitingRoomCopyKey,
  type WaitingRoomLocale,
} from "@/lib/forcedVerification";
import {
  MANDATORY_METHODS,
  VERIFICATION_METHOD_CONFIRMATION_PHRASE,
  VERIFICATION_METHOD_MAX_OVERRIDES,
  VERIFICATION_METHOD_PENDING_STORAGE_KEY,
  VERIFICATION_METHOD_PHOTO_CATALOGUE_HREF,
  VERIFICATION_METHOD_PHOTO_UNAVAILABLE,
  VERIFICATION_METHOD_PREFERRED_CONTRACT_VERSION,
  VERIFICATION_METHOD_PUBLISH_BLOCKING_CODES,
  VERIFICATION_METHOD_REASON_MAX,
  VERIFICATION_METHOD_UNAVAILABLE_ERROR,
  VERIFICATION_START_METHODS,
  closedModeThresholdApplies,
  closedModeThresholdChangedBySave,
  closedModeThresholdResetOnSave,
  documentUsesMethod,
  draftGateModeConflicts,
  gateModeEntriesDropped,
  gateModeGlobalFollowersAllowExplore,
  gateModeGlobalInheritors,
  gateModeOnlyStorefronts,
  gateModePinsDroppedOnSave,
  loadVerificationMethodConsole,
  verificationMethodPolicyStoresGateMode,
  validateVerificationMethodDraft,
  verificationMethodApplyCommand,
  verificationMethodCommandVersion,
  verificationMethodConflictResponse,
  verificationMethodDocument,
  verificationMethodDocumentFromDraft,
  verificationMethodDocumentsEqual,
  verificationMethodDraft,
  verificationMethodDraftMatchesVersion,
  verificationMethodDraftWithStorefront,
  verificationMethodDraftWithoutStorefront,
  verificationMethodErrorResponse,
  verificationMethodImpactResponse,
  verificationMethodMutationOutcome,
  verificationMethodOutcomeProvesV2,
  verificationMethodPendingFrom,
  verificationMethodPendingMutation,
  verificationMethodPersistBeforeMutation,
  verificationMethodPhotoCopyGuidance,
  verificationMethodPolicyStoresClosedThreshold,
  verificationMethodReason,
  verificationMethodShouldRetainMutation,
  withClosedBelowEvents,
  withGateModeChoice,
  type MandatoryMethod,
  type VerificationGateMode,
  type VerificationMethodAccess,
  type VerificationMethodAvailabilityMap,
  type VerificationMethodConsoleData,
  type VerificationMethodContractVersion,
  type VerificationMethodDraft,
  type VerificationMethodImpactData,
  type VerificationMethodPendingMutation,
  type VerificationMethodPolicy,
} from "@/lib/verificationMethod";

type Props = {
  access: VerificationMethodAccess;
  /** The parent console holds a pending mutation or is busy; nothing here may write meanwhile. */
  locked: boolean;
};

type LoadState = "loading" | "ready" | "unavailable" | "error";
type Notice = { tone: "info" | "error" | "success"; text: string } | null;
/** `null` selects the Global row; a string selects that storefront row. */
type RowKey = string | null;

/** D-052 palette tokens (reports/design/coloring-palette-v3.md) — the Waiting Room frames use exactly these. */
const PHONE_PALETTE = {
  light: { accent: "#007F91", accentPressed: "#006776", faint: "#DDFBFC", onAccent: "#FFFFFF", inactive: "#6B7478", surface: "#F7F8FA", text: "#1C1C1E", line: "#E8EAED" },
  dark: { accent: "#75F0F4", accentPressed: "#8DFDFF", faint: "#12373B", onAccent: "#071516", inactive: "#8A9497", surface: "#1C1C1E", text: "#F7F8FA", line: "#2A2D31" },
} as const;

function PhoneFrame({
  mode,
  storefrontLabel,
  copy,
  method,
  labels,
}: {
  mode: "light" | "dark";
  storefrontLabel: string;
  copy: WaitingRoomCopy;
  method: MandatoryMethod;
  labels: { persona: string; video: string; photo: string; footer: string[]; notForced: string; help: string; modeLabel: string };
}) {
  const palette = PHONE_PALETTE[mode];
  return (
    <figure className={`forced-phone forced-phone-${mode}`} style={{ background: palette.surface, color: palette.text, borderColor: palette.line }} aria-label={labels.modeLabel}>
      <div className="forced-phone-status" style={{ color: palette.inactive }}><span>9:41</span><span>{storefrontLabel}</span></div>
      {copy.help_url !== null ? (
        // The round "?" help button (36 px, accent_faint_bg fill, accent glyph, top-right) exists only for an effective URL.
        <span className="forced-phone-help" style={{ background: palette.faint, color: palette.accent }} role="img" aria-label={labels.help} title={copy.help_url}>?</span>
      ) : null}
      <div className="forced-phone-illustration" style={{ background: palette.faint, color: palette.accent }} aria-hidden="true">
        <span style={{ background: palette.accent }} />
      </div>
      <h4 className="forced-phone-title">{copy.title}</h4>
      <p className="forced-phone-subtitle" style={{ color: palette.accent }}>{copy.subtitle}</p>
      <p className="forced-phone-description">{copy.description}</p>
      <div className="forced-phone-actions">
        {method === "none" ? (
          <span className="forced-phone-note" style={{ color: palette.inactive }}>{labels.notForced}</span>
        ) : (
          // D-092: exactly one method is mandatory, so the room shows exactly one call to action.
          <span className="forced-phone-button" style={{ background: palette.accent, color: palette.onAccent, borderColor: palette.accent }}>
            {method === "persona" ? labels.persona : method === "photo" ? labels.photo : labels.video}
          </span>
        )}
      </div>
      <figcaption className="forced-phone-footer" style={{ color: palette.inactive }}>
        {labels.footer.map((item) => <span key={item}>{item}</span>)}
      </figcaption>
    </figure>
  );
}

/**
 * Verification console → Scopes / Területek: the ONE mandatory-method editor
 * (T-617, D-092a §8, contract §7.1). Rows are Global plus catalogue-picked App
 * Store storefront overrides; each row carries exactly one scalar
 * `persona | video | photo | none` and, beneath it, that row's bilingual
 * Waiting Room copy. `photo` (the gesture photo selfie, D-135) is chosen here
 * and nowhere else; while it cannot start, Core names the
 * `verification-method-photo-unavailable` blocker and this table points the
 * operator at the gesture catalogue editor. Core owns the document, its single
 * revision over `{draft, live}`, availability, validation, the impact scan,
 * publication and audit.
 *
 * Discipline: exact decoders, closed refusal vocabulary, CAS on the observed
 * revision, and one durable retained command in `sessionStorage` that is
 * replayed byte-for-byte after an uncertain answer — never a second logical
 * action.
 *
 * D-151 (contract §8.4/§8.5): the table asks Core for console contract v2;
 * there every row also carries a gate mode — Explore mode or Full block — and
 * every call speaks v2. An older Core refuses that read with
 * `verification-method-contract-version` (409); the table then speaks v1 for
 * the rest of the session: exactly today's table and wire, no mode control.
 * The draft's modes change only on an operator choice.
 *
 * D-152 (contract §7): the table asks for console contract v3 first. There
 * the gate-mode block also carries the one global Closed mode threshold
 * (`closed_below_events`, 0..50, 3 by default, 0 = never close), saved with
 * the draft and published through the same CAS, receipt, audit and
 * confirmation path. A D-151 Core refuses v3 with the same named 409, and the
 * probe steps down to v2 (then v1) exactly as before.
 */
export default function VerificationMethodScopesTable({ access, locked }: Props) {
  const t = useTranslations("verificationAdmin.methodPolicy");
  const gt = useTranslations("verificationAdmin.methodPolicy.gateMode");
  const shared = useTranslations("verificationAdmin.forced");
  /** Contract §8.1: the availability reason reuses the existing live vocabulary unchanged. */
  const methodReason = useTranslations("verificationAdmin.live.methodReasons");
  /** D-152: a threshold as the operator reads it ("Never close (always Explore)" for 0, otherwise "N events"). */
  const thresholdLabel = useClosedModeLabel();
  const locale = useLocale() === "hu" ? "hu" : "en";

  const [state, setState] = useState<LoadState>("loading");
  const [data, setData] = useState<VerificationMethodConsoleData | null>(null);
  const [draft, setDraft] = useState<VerificationMethodDraft | null>(null);
  const [expanded, setExpanded] = useState<RowKey | undefined>(undefined);
  const [previewLocale, setPreviewLocale] = useState<WaitingRoomLocale>(locale);
  const [storefrontToAdd, setStorefrontToAdd] = useState("");
  const [impact, setImpact] = useState<VerificationMethodImpactData | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  /** The last publish was refused with the photo blocker; cleared by the next authoritative read. */
  const [photoRefused, setPhotoRefused] = useState(false);
  /**
   * The console's `publish_guard` describes the draft of the revision it was
   * read at. A save adopts a newer policy without a new guard, so the guard is
   * shown only while the revision it was computed for is still the one on screen.
   */
  const [guardRevision, setGuardRevision] = useState<number | null>(null);
  const [pending, setPending] = useState<VerificationMethodPendingMutation | null>(null);
  /** Scopes Core named in its last `explore_requires_persona` refusal; cleared by any edit or authoritative read. */
  const [refusedScopes, setRefusedScopes] = useState<string[]>([]);
  /** v1 only: Core said a mode is stored that this wire cannot show (`gate_mode_hidden`). */
  const [gateModeHidden, setGateModeHidden] = useState(false);
  const pendingRef = useRef<VerificationMethodPendingMutation | null>(null);
  /**
   * The console wire. `admin_me` does not advertise it (contract §8.4/§15,
   * D-152 §7), so the first read asks for v3 and steps down one version per
   * named refusal (v2, then v1) for the session.
   */
  const wireRef = useRef<VerificationMethodContractVersion>(VERIFICATION_METHOD_PREFERRED_CONTRACT_VERSION);

  const countries = useMemo(() => localizedForcedStorefronts(locale), [locale]);
  const editable = access.editable && !locked && !busy && pending === null;

  const adopt = useCallback((policy: VerificationMethodPolicy, keepDraft: boolean) => {
    setData((current) => (current ? { ...current, policy } : current));
    setDraft((current) => (keepDraft && current ? current : verificationMethodDraft(policy.draft.document)));
    setImpact(null);
    setConfirmation("");
    setRefusedScopes([]);
  }, []);

  const load = useCallback(async (keepDraft: boolean) => {
    setState((current) => (current === "ready" ? current : "loading"));
    // Contract §8.5: a Core that speaks v1 only keeps today's console; the mode control stays hidden.
    const result = await loadVerificationMethodConsole(adminCall, wireRef.current);
    wireRef.current = result.version;
    if (!result.ok) {
      setState(result.error === VERIFICATION_METHOD_UNAVAILABLE_ERROR ? "unavailable" : "error");
      return;
    }
    const material = result.data;
    setData(material);
    setDraft((current) => (keepDraft && current && verificationMethodDraftMatchesVersion(current, material.contract_version)
      ? current
      : verificationMethodDraft(material.policy.draft.document)));
    setImpact(null);
    setConfirmation("");
    setPhotoRefused(false);
    setRefusedScopes([]);
    // The v1 warning stays until a v2 or v3 read proves the modes are on screen.
    if (material.contract_version !== 1) setGateModeHidden(false);
    setGuardRevision(material.policy.revision);
    setState("ready");
  }, []);

  useEffect(() => {
    try {
      const serialized = window.sessionStorage.getItem(VERIFICATION_METHOD_PENDING_STORAGE_KEY);
      if (serialized) {
        const restored = verificationMethodPendingFrom(JSON.parse(serialized));
        if (restored) {
          pendingRef.current = restored;
          setPending(restored);
        } else window.sessionStorage.removeItem(VERIFICATION_METHOD_PENDING_STORAGE_KEY);
      }
    } catch {
      setNotice({ tone: "error", text: t("persistenceUnavailable") });
    }
    void load(false);
  }, [load, t]);

  const draftDocument = useMemo(
    () => (draft ? verificationMethodDocumentFromDraft(draft) : null),
    [draft],
  );
  const draftIssue = useMemo(
    () => (draft ? validateVerificationMethodDraft(draft) : null),
    [draft],
  );
  const authoritativeDraft = data?.policy.draft.document ?? null;
  const dirty = authoritativeDraft !== null
    && (draftDocument === null || !verificationMethodDocumentsEqual(draftDocument, authoritativeDraft));
  /**
   * A preview is bound to one exact revision AND to the authoritative draft it
   * was computed from. Any local edit or any newer revision stales it, so the
   * publish button can never carry a fingerprint for material nobody reviewed.
   */
  const impactBound = impact !== null && data !== null
    && impact.expected_revision === data.policy.revision
    && !dirty;
  const impactStale = impact !== null && !impactBound;

  function clearPending(): boolean {
    try {
      window.sessionStorage.removeItem(VERIFICATION_METHOD_PENDING_STORAGE_KEY);
    } catch {
      return false;
    }
    pendingRef.current = null;
    setPending(null);
    return true;
  }

  function refusalNotice(
    error: ReturnType<typeof verificationMethodErrorResponse>,
    command: VerificationMethodPendingMutation,
  ): Notice {
    if (error === null) return { tone: "error", text: t("uncertain") };
    // Review P3: Core changed version under an open console (v2 → older, or the reverse).
    if (error === "verification-method-contract-version") return { tone: "error", text: gt("coreChanged") };
    const photoCopy = verificationMethodPhotoCopyGuidance(error, command);
    if (photoCopy) return { tone: "error", text: t(`photoHelp.${photoCopy}`, { code: error }) };
    if (error === VERIFICATION_METHOD_PHOTO_UNAVAILABLE) {
      return { tone: "error", text: t("photoBlocked.refused") };
    }
    if ((VERIFICATION_METHOD_PUBLISH_BLOCKING_CODES as readonly string[]).includes(error)) {
      return { tone: "error", text: t("publishBlocked", { code: error }) };
    }
    if (error.startsWith("verification-method-") && error.endsWith("-invalid")) {
      return { tone: "error", text: t("invalid", { code: error }) };
    }
    if (verificationMethodShouldRetainMutation(error)) return { tone: "error", text: t("uncertain") };
    return { tone: "error", text: t("refused", { code: error }) };
  }

  async function executeMutation(next: VerificationMethodPendingMutation) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const existing = pendingRef.current;
    let response: AdminResponse | null;
    if (existing) {
      // The retained command is replayed byte-for-byte: same request id, same
      // revision, same material. Core answers with its receipt, never a second change.
      response = await adminCall(existing.action, existing.payload);
    } else {
      const persisted = await verificationMethodPersistBeforeMutation(
        window.sessionStorage,
        next,
        () => adminCall(next.action, next.payload),
      );
      if (!persisted.ok) {
        setBusy(false);
        setNotice({ tone: "error", text: t("persistenceUnavailable") });
        return;
      }
      pendingRef.current = next;
      setPending(next);
      response = persisted.response;
    }
    const durable = pendingRef.current ?? next;
    // The retained command names its own wire; Core answers in that version.
    const commandVersion = verificationMethodCommandVersion(durable.payload);
    /** A command retained under the other wire (Core changed meanwhile) is answered, then re-read. */
    const sameWire = data?.contract_version === commandVersion;
    const outcome = verificationMethodMutationOutcome(response, commandVersion);
    if (outcome.kind === "success") {
      const success = outcome.data;
      const cleared = clearPending();
      if (!cleared) {
        setNotice({ tone: "error", text: t("persistenceCleanupFailed") });
        setBusy(false);
        return;
      }
      // Review round 2: `gate_mode_hidden` proves Core speaks v2 or newer.
      // Re-probe from the preferred wire so the operator sees the stored modes
      // instead of staying on v1.
      const restoreWire = verificationMethodOutcomeProvesV2(outcome, commandVersion);
      if (sameWire && !restoreWire) {
        adopt(success.policy, false);
        setData((current) => (current
          ? { ...current, policy: success.policy, method_availability: success.method_availability }
          : current));
      } else {
        if (restoreWire) {
          wireRef.current = VERIFICATION_METHOD_PREFERRED_CONTRACT_VERSION;
          setGateModeHidden(true);
        }
        void load(false);
      }
      const base = success.replayed
        ? t("replayed")
        : durable.action === "verification_method_save"
          ? t("draftSaved", { revision: success.policy.revision })
          : t("published", { revision: success.policy.revision });
      // Review round 2: name the explicit Full block entries Core did not keep.
      const sent = durable.action === "verification_method_save" && commandVersion !== 1
        ? verificationMethodDocument(durable.payload.draft_json, "exact", commandVersion)?.gate_mode
        : undefined;
      const dropped = gateModeEntriesDropped(sent, success.policy.draft.document.gate_mode);
      // D-152 Q10: an all-Full-block save returns the threshold to 3; say so.
      const thresholdReset = closedModeThresholdChangedBySave(sent, success.policy.draft.document.gate_mode);
      const extra = [
        dropped.length > 0 ? gt("pinsDropped", { storefronts: dropped.map(scopeLabel).join(", ") }) : null,
        thresholdReset !== null ? gt("closedMode.resetAfterSave", { value: thresholdLabel(thresholdReset) }) : null,
        restoreWire ? gt("hiddenReloaded") : null,
      ].filter(Boolean).join(" ");
      setNotice({ tone: success.replayed ? "info" : "success", text: extra ? `${base} ${extra}` : base });
      setBusy(false);
      return;
    }
    if (outcome.kind === "gate-mode-conflict") {
      // D-151 review: Explore under video or photo. Terminal, never retained,
      // and the named rows are highlighted.
      const cleared = clearPending();
      setRefusedScopes(outcome.conflict.scopes);
      // Round 3: on a v1 session this refusal (a carried mode conflicts) proves
      // Core speaks v2. Switch back, keep the banner, and re-read with the modes.
      const restoreWire = verificationMethodOutcomeProvesV2(outcome, commandVersion);
      if (restoreWire) {
        wireRef.current = VERIFICATION_METHOD_PREFERRED_CONTRACT_VERSION;
        setGateModeHidden(true);
        void load(false);
      }
      setNotice({
        tone: "error",
        text: cleared
          ? [
            gt("conflictRefused", { scopes: outcome.conflict.scopes.map(scopeLabel).join(", ") }),
            restoreWire ? gt("hiddenReloaded") : null,
          ].filter(Boolean).join(" ")
          : t("persistenceCleanupFailed"),
      });
      setBusy(false);
      return;
    }
    if (outcome.kind === "conflict") {
      const cleared = clearPending();
      if (sameWire) {
        adopt(outcome.data.policy, false);
        setData((current) => (current
          ? { ...current, policy: outcome.data.policy, method_availability: outcome.data.method_availability }
          : current));
      } else void load(false);
      setNotice({ tone: "error", text: cleared ? t("conflict") : t("persistenceCleanupFailed") });
      setBusy(false);
      return;
    }
    if (!outcome.retain) clearPending();
    if (outcome.error === VERIFICATION_METHOD_PHOTO_UNAVAILABLE) setPhotoRefused(true);
    setNotice(refusalNotice(outcome.error, durable));
    setBusy(false);
  }

  function startMutation(
    action: VerificationMethodPendingMutation["action"],
    body: Record<string, unknown>,
  ) {
    const next = verificationMethodPendingMutation(action, body);
    if (!next) {
      setNotice({ tone: "error", text: t("invalid", { code: "invalid-input" }) });
      return;
    }
    void executeMutation(next);
  }

  function saveDraft() {
    if (!data || !draftDocument || !editable) return;
    if (draftIssue) {
      setNotice({ tone: "error", text: shared(`validation.${draftIssue}`) });
      return;
    }
    startMutation("verification_method_save", {
      contract_version: data.contract_version,
      draft_json: draftDocument,
      expected_revision: data.policy.revision,
      request_id: crypto.randomUUID(),
    });
  }

  async function previewImpact() {
    if (!data || !access.previewable || busy || locked || pending !== null) return;
    setBusy(true);
    setNotice(null);
    const expected = data.policy.revision;
    const version = data.contract_version;
    const response = await adminCall("verification_method_impact", {
      contract_version: version,
      expected_revision: expected,
    });
    const parsed = verificationMethodImpactResponse(response, version);
    const bound = parsed?.expected_revision === expected ? parsed : null;
    if (bound?.gate_mode_hidden && version === 1) {
      // Review round 2: proof that Core speaks v2 or newer. A v1 preview would
      // bind a publish to modes this view never showed; re-probe instead.
      wireRef.current = VERIFICATION_METHOD_PREFERRED_CONTRACT_VERSION;
      setGateModeHidden(true);
      setNotice({ tone: "info", text: gt("hiddenReloaded") });
      setBusy(false);
      void load(false);
      return;
    }
    setImpact(bound);
    setConfirmation("");
    if (bound) {
      setNotice({ tone: "info", text: t("impactReady", { revision: expected }) });
      setBusy(false);
      return;
    }
    const conflict = verificationMethodConflictResponse(response, version);
    if (conflict) {
      adopt(conflict.data.policy, false);
      setNotice({ tone: "error", text: t("conflict") });
      setBusy(false);
      return;
    }
    const error = verificationMethodErrorResponse(response);
    setNotice({
      tone: "error",
      text: error === "verification-method-contract-version"
        ? gt("coreChanged")
        : t("impactFailed", { code: error ?? "invalid-core-response" }),
    });
    setBusy(false);
  }

  function publish() {
    if (!impact || !impactBound || !access.publishable || locked || busy || pending !== null) return;
    const normalizedReason = verificationMethodReason(reason);
    if (!normalizedReason || confirmation !== VERIFICATION_METHOD_CONFIRMATION_PHRASE) return;
    startMutation("verification_method_apply", verificationMethodApplyCommand(impact, normalizedReason, crypto.randomUUID()));
  }

  function patch(next: Partial<VerificationMethodDraft>) {
    setDraft((current) => (current ? { ...current, ...next } : current));
    setNotice(null);
    setRefusedScopes([]);
  }

  /** `global` or a storefront code, as the operator reads it. */
  function scopeLabel(scope: string): string {
    return scope === "global" ? shared("globalRow") : `${forcedStorefrontName(scope, locale)} · ${scope}`;
  }

  function patchRow(storefront: string, next: Partial<VerificationMethodDraft["overrides"][number]>) {
    if (!draft) return;
    patch({ overrides: draft.overrides.map((row) => (row.storefront === storefront ? { ...row, ...next } : row)) });
  }

  function patchCopy(row: RowKey, copyLocale: WaitingRoomLocale, field: WaitingRoomCopyKey, value: string) {
    if (!draft) return;
    if (row === null) {
      patch({ copy_default: { ...draft.copy_default, [copyLocale]: { ...draft.copy_default[copyLocale], [field]: value } } });
      return;
    }
    const current = draft.overrides.find((entry) => entry.storefront === row);
    if (!current) return;
    patchRow(row, { copy: { ...current.copy, [copyLocale]: { ...current.copy[copyLocale], [field]: value } } });
  }

  function addOverride() {
    if (!draft || !storefrontToAdd) return;
    // A new row starts from the method it inherits and writes no gate mode: it
    // follows Global until the operator picks one (D-151a point 4).
    const next = verificationMethodDraftWithStorefront(draft, storefrontToAdd);
    if (!next) return;
    patch({ overrides: next.overrides });
    setExpanded(storefrontToAdd);
    setStorefrontToAdd("");
  }

  function removeOverride(storefront: string) {
    if (!draft) return;
    // Contract §7.1 plus the gate-mode rules of `gateModeAfterRowRemoval`:
    // a mode that differs from Global stays as a mode-only row; a stored mode
    // under a None method is dropped and named.
    const removed = verificationMethodDraftWithoutStorefront(draft, storefront);
    patch({ overrides: removed.draft.overrides, gate_mode: removed.draft.gate_mode });
    const notice = removed.notice;
    if (notice?.kind === "dropped") {
      setNotice({
        tone: "info",
        text: gt(notice.reason === "none" ? "removedDroppedNone" : "removedDroppedPersona", {
          storefront: scopeLabel(storefront),
          mode: gt(`modes.${notice.mode}`),
          global: gt(`modes.${notice.global}`),
        }),
      });
    } else if (notice?.kind === "follows-global") {
      // Round 3: its own mode is gone, but it gets the same one from Global; say exactly that.
      setNotice({ tone: "info", text: gt("removedFollowsGlobal", { storefront: scopeLabel(storefront), mode: gt(`modes.${notice.mode}`) }) });
    }
    setExpanded((current) => (current === storefront ? undefined : current));
  }

  if (state === "loading") return <LoadingPanel />;
  if (state === "unavailable") {
    return (
      <section className="panel">
        <div className="panel-header"><div><h2>{t("unavailableTitle")}</h2><p>{t("unavailableCopy")}</p></div></div>
        <div className="panel-body">
          <button type="button" className="button button-secondary" onClick={() => void load(false)}>{shared("retry")}</button>
        </div>
      </section>
    );
  }
  if (state === "error" || !data || !draft) {
    return <ErrorPanel message={t("loadError")} retry={() => void load(false)} />;
  }

  const availability: VerificationMethodAvailabilityMap = data.method_availability;
  /** Contract v2 material with its catalogue: only then does the table show the gate-mode column. */
  const gate = draft.gate_mode;
  const recommendedMode = data.gate_mode_catalogue?.recommended ?? null;
  const columnCount = gate !== null && recommendedMode !== null ? 5 : 4;
  /** Rows to highlight: the draft's own Persona-rule conflicts plus any scope Core named. */
  const conflictScopes = new Set([...draftGateModeConflicts(draft), ...refusedScopes]);
  /** Forcing storefronts that follow Global's mode, and Full block entries Core would drop on save (review round 2). */
  const globalInheritors = gateModeGlobalInheritors(draft);
  const followersAllowExplore = gateModeGlobalFollowersAllowExplore(draft);
  const pinsDroppedOnSave = gateModePinsDroppedOnSave(gate);
  /**
   * D-152: the Closed mode threshold, on v3 material only — the draft's value,
   * the live value and Core's bounds. `null` on v1/v2, where the control is absent.
   */
  const closedMode = gate !== null && gate.closed_below_events !== undefined
    && data.contract_version === 3 && data.gate_mode_catalogue?.closed_below_events
    && data.policy.live.document.gate_mode?.closed_below_events !== undefined
    ? {
      value: gate.closed_below_events,
      live: data.policy.live.document.gate_mode.closed_below_events,
      catalogue: data.gate_mode_catalogue.closed_below_events,
    }
    : null;
  const modeOnlyRows = [...gateModeOnlyStorefronts(draft)].sort((left, right) => (
    forcedStorefrontName(left, locale).localeCompare(forcedStorefrontName(right, locale), locale)
    || left.localeCompare(right)
  ));
  const usedStorefronts = new Set(draft.overrides.map((row) => row.storefront));
  const sortedRows = [...draft.overrides].sort((left, right) => (
    forcedStorefrontName(left.storefront, locale).localeCompare(forcedStorefrontName(right.storefront, locale), locale)
    || left.storefront.localeCompare(right.storefront)
  ));
  const normalizedReason = verificationMethodReason(reason);
  /**
   * The photo blocker is shown whenever Core names it (console guard over the
   * saved draft, the bound impact preview, or a refused publish) and whenever
   * the local draft uses `photo` while Core reports it unavailable — so the
   * operator learns about the catalogue before pressing anything.
   */
  const draftUsesPhoto = draftDocument !== null && documentUsesMethod(draftDocument, "photo");
  const consoleBlockers = guardRevision === data.policy.revision ? data.publish_guard.blocking_codes : [];
  const photoBlocked = photoRefused
    || consoleBlockers.includes(VERIFICATION_METHOD_PHOTO_UNAVAILABLE)
    || (impactBound && impact !== null && impact.publish_guard.blocking_codes.includes(VERIFICATION_METHOD_PHOTO_UNAVAILABLE))
    || (draftUsesPhoto && !availability.photo.policy_enable_allowed);
  const otherConsoleBlockers = consoleBlockers.filter((code) => code !== VERIFICATION_METHOD_PHOTO_UNAVAILABLE);
  const publishReady = impactBound
    && impact !== null
    && impact.publish_guard.ready
    && access.publishable
    && !locked && !busy && pending === null
    && normalizedReason !== null
    && confirmation === VERIFICATION_METHOD_CONFIRMATION_PHRASE;

  /**
   * A method may be SELECTED where it is already live even after availability
   * closes — the existing choice stays visible and editable — but a method the
   * deployment cannot serve can never be newly published (contract §7.1 item 2).
   */
  function methodSelectable(method: MandatoryMethod, current: MandatoryMethod): boolean {
    if (method === "none" || method === current) return true;
    return availability[method].policy_enable_allowed;
  }

  /** Contract §8.4: a v2/v3 preview names each scope's live and draft mode; a scope whose method is None shows Off. */
  const impactModes = impact !== null && impact.contract_version !== 1;

  function impactModeLabel(method: MandatoryMethod, mode: VerificationGateMode | undefined) {
    if (mode === undefined) return "";
    return method === "none" ? gt("modes.off") : gt(`modes.${mode}`);
  }

  function impactModeCells(row: {
    live_method: MandatoryMethod;
    draft_method: MandatoryMethod;
    live_gate_mode?: VerificationGateMode;
    draft_gate_mode?: VerificationGateMode;
  }) {
    if (!impactModes) return null;
    const live = impactModeLabel(row.live_method, row.live_gate_mode);
    const next = impactModeLabel(row.draft_method, row.draft_gate_mode);
    return (
      <>
        <td>{live}</td>
        <td data-gate-mode-changed={live !== next ? "true" : undefined}>{live !== next ? <strong>{next}</strong> : next}</td>
      </>
    );
  }

  function photoBlockedAlert() {
    const reason = availability.photo.reason;
    return (
      <div className="alert alert-error" role="alert" data-verification-method-photo-blocked="true">
        <strong>{t("photoBlocked.title")}</strong>{" "}
        {reason === "catalogue_insufficient" || reason === null
          ? t("photoBlocked.catalogue")
          : t("photoBlocked.other", { reason: methodReason(reason) })}{" "}
        <Link className="button button-secondary button-small" href={VERIFICATION_METHOD_PHOTO_CATALOGUE_HREF}>{t("photoBlocked.openCatalogue")}</Link>
      </div>
    );
  }

  function copyField(row: RowKey, copyLocale: WaitingRoomLocale, field: WaitingRoomCopyField) {
    const source = row === null
      ? draft!.copy_default[copyLocale]
      : draft!.overrides.find((entry) => entry.storefront === row)?.copy[copyLocale];
    const value = source?.[field] ?? "";
    const inherited = row === null
      ? data!.compiled_defaults.waiting_room_copy[copyLocale][field]
      : draft!.copy_default[copyLocale][field];
    const limit = WAITING_ROOM_COPY_LIMITS[field];
    const used = waitingRoomTextLength(forcedCopyTrim(value));
    const id = `method-copy-${row ?? "global"}-${copyLocale}-${field}`;
    const common = {
      id,
      value,
      disabled: !editable,
      "aria-invalid": used > limit,
      placeholder: row === null ? inherited : shared("copy.inheritPlaceholder", { value: inherited }),
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => patchCopy(row, copyLocale, field, event.target.value),
    };
    return (
      <label className="field forced-copy-field" key={id}>
        <span>{shared(`copy.fields.${field}`)} · {shared(`copy.locales.${copyLocale}`)}</span>
        {field === "description" ? <textarea rows={4} {...common} /> : <input {...common} />}
        <small className={`field-hint forced-copy-counter${used > limit ? " is-over" : ""}`}>{shared("copy.limit", { used, max: limit })}</small>
      </label>
    );
  }

  function helpUrlField(row: RowKey, copyLocale: WaitingRoomLocale) {
    const source = row === null
      ? draft!.copy_default[copyLocale]
      : draft!.overrides.find((entry) => entry.storefront === row)?.copy[copyLocale];
    const value = source?.help_url ?? "";
    const inherited = draft!.copy_default[copyLocale].help_url;
    const issue = waitingRoomHelpUrlDraftIssue(value);
    const used = waitingRoomHelpUrlByteLength(value);
    const id = `method-copy-${row ?? "global"}-${copyLocale}-help_url`;
    const placeholder = row === null
      ? shared("copy.helpUrlPlaceholder")
      : inherited === "" ? shared("copy.inheritNone") : shared("copy.inheritPlaceholder", { value: inherited });
    return (
      <label className="field forced-copy-field" key={id}>
        <span>{shared("copy.fields.help_url")} · {shared(`copy.locales.${copyLocale}`)}</span>
        <input
          id={id}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={value}
          disabled={!editable}
          aria-invalid={issue !== null}
          placeholder={placeholder}
          onChange={(event) => patchCopy(row, copyLocale, "help_url", event.target.value)}
        />
        {issue
          ? <small className="field-error">{shared(`validation.${issue}`)}</small>
          : <small className={`field-hint forced-copy-counter${used > WAITING_ROOM_HELP_URL_MAX_BYTES ? " is-over" : ""}`}>{shared("copy.helpUrlBytes", { used, max: WAITING_ROOM_HELP_URL_MAX_BYTES })}</small>}
      </label>
    );
  }

  function methodSelect(row: RowKey, current: MandatoryMethod) {
    const id = `method-select-${row ?? "global"}`;
    return (
      <div className="method-cell">
        <select
          id={id}
          className="input"
          value={current}
          disabled={!editable}
          aria-label={t("columns.method")}
          onChange={(event) => {
            const next = event.target.value as MandatoryMethod;
            if (row === null) patch({ global: next }); else patchRow(row, { method: next });
          }}
        >
          {MANDATORY_METHODS.map((method) => (
            <option key={method} value={method} disabled={!methodSelectable(method, current)}>
              {t(`methods.${method}`)}
            </option>
          ))}
        </select>
        <ul className="method-availability">
          {VERIFICATION_START_METHODS.map((method) => {
            const entry = availability[method];
            return (
              <li key={method}>
                {t(`methods.${method}`)}: {entry.policy_enable_allowed
                  ? t("methodAvailable")
                  : t("methodUnavailable", { reason: entry.reason === null ? "" : methodReason(entry.reason) })}
                {method === "photo" && entry.reason === "catalogue_insufficient"
                  ? <> <Link href={VERIFICATION_METHOD_PHOTO_CATALOGUE_HREF}>{t("photoBlocked.openCatalogue")}</Link></>
                  : null}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  function copyEditor(row: RowKey) {
    const overrideDraft = row === null
      ? null
      : draft!.overrides.find((entry) => entry.storefront === row)?.copy[previewLocale] ?? null;
    const preview = previewWaitingRoomCopy(
      overrideDraft,
      draft!.copy_default[previewLocale],
      previewLocale,
      data!.compiled_defaults.waiting_room_copy,
    );
    const method = row === null ? draft!.global : draft!.overrides.find((entry) => entry.storefront === row)?.method ?? "none";
    const storefrontLabel = row === null
      ? shared("preview.globalShort")
      : `${forcedStorefrontName(row, previewLocale)} · ${row}`;
    return (
      <div className="method-row-detail form-stack">
        <p className="field-hint">{row === null ? shared("copyCopy") : t("copyInherits")}</p>
        <div className="forced-copy-grid">
          {WAITING_ROOM_COPY_FIELDS.map((field) => WAITING_ROOM_LOCALES.map((copyLocale) => copyField(row, copyLocale, field)))}
          {WAITING_ROOM_LOCALES.map((copyLocale) => helpUrlField(row, copyLocale))}
        </div>
        <small className="field-hint">{shared("copy.helpUrlHint")}</small>
        {row === null ? (
          <div className="row-actions">
            <button
              type="button"
              className="button button-ghost button-small"
              disabled={!editable}
              onClick={() => patch({
                copy_default: {
                  en: waitingRoomCopyDraft(data!.compiled_defaults.waiting_room_copy.en),
                  hu: waitingRoomCopyDraft(data!.compiled_defaults.waiting_room_copy.hu),
                },
              })}
            >
              {shared("resetCompiled")}
            </button>
          </div>
        ) : null}
        <div className="forced-section-heading">
          <h4 className="forced-subheading">{shared("previewTitle")}</h4>
          <div className="row-actions" role="group" aria-label={shared("preview.locale")}>
            {WAITING_ROOM_LOCALES.map((entry) => (
              <button
                type="button"
                key={entry}
                className={`button button-small ${previewLocale === entry ? "button-primary" : "button-secondary"}`}
                aria-pressed={previewLocale === entry}
                onClick={() => setPreviewLocale(entry)}
              >
                {shared(`copy.locales.${entry}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="forced-phone-grid">
          {(["light", "dark"] as const).map((mode) => (
            <PhoneFrame
              key={mode}
              mode={mode}
              storefrontLabel={storefrontLabel}
              copy={preview.copy}
              method={method}
              labels={{
                persona: shared("preview.primaryPersona"),
                video: shared("preview.primaryVideo"),
                photo: shared("preview.primaryPhoto"),
                footer: [shared("preview.footerEdit"), shared("preview.footerSupport"), shared("preview.footerSignOut"), shared("preview.footerDelete")],
                notForced: shared("preview.notForced"),
                help: shared("preview.help"),
                modeLabel: shared(`preview.${mode}`),
              }}
            />
          ))}
        </div>
        {preview.compiledFields.length > 0 ? (
          <p className="field-hint" role="status">
            <strong>{shared("preview.compiledCopy", { fields: preview.compiledFields.map((field) => shared(`copy.fields.${field}`)).join(", ") })}</strong>
          </p>
        ) : null}
        <p className="field-hint forced-help-url-note">
          {preview.copy.help_url !== null ? shared("preview.helpUrl", { url: preview.copy.help_url }) : shared("preview.noHelpUrl")}
        </p>
        <small className="field-hint">{shared("preview.nonInteractive")}</small>
      </div>
    );
  }

  /** `method` is the row's effective method: `none` shows Off and locks the control; only Persona allows Explore. */
  function gateModeCell(row: RowKey, method: MandatoryMethod) {
    if (gate === null || recommendedMode === null) return null;
    return (
      <td>
        <VerificationGateModeControl
          id={`gate-mode-${row ?? "global"}`}
          gate={gate}
          storefront={row}
          scopeLabel={row === null ? shared("globalRow") : `${forcedStorefrontName(row, locale)} (${row})`}
          method={method}
          inheritedBy={row === null ? globalInheritors.map((code) => `${forcedStorefrontName(code, locale)} (${code})`) : undefined}
          followersAllowExplore={row === null && followersAllowExplore}
          pinDroppedOnSave={row !== null && pinsDroppedOnSave.includes(row)}
          flagged={refusedScopes.includes(row ?? "global")}
          recommended={recommendedMode}
          disabled={!editable}
          onChange={(choice) => patch({ gate_mode: withGateModeChoice(gate, row, choice) })}
        />
      </td>
    );
  }

  /** A storefront Core serves with a mode but no method row (contract §8.1 keeps the maps independent). */
  function modeOnlyRow(storefront: string) {
    return (
      <tr
        key={`mode-only-${storefront}`}
        data-gate-mode-only={storefront}
        className={conflictScopes.has(storefront) ? "gate-mode-conflict-row" : undefined}
      >
        <th scope="row">
          <span className="method-row-title"><strong>{forcedStorefrontName(storefront, locale)}</strong><small>{storefront}</small></span>
        </th>
        <td>
          <div className="method-cell">
            <span>{gt("methodInherited", { method: t(`methods.${draft!.global}`) })}</span>
            <small className="field-hint">{gt("modeOnlyHint")}</small>
          </div>
        </td>
        {gateModeCell(storefront, draft!.global)}
        <td />
        <td>
          <button
            type="button"
            className="button button-ghost button-danger button-small"
            disabled={!editable || gate === null}
            onClick={() => { if (gate) patch({ gate_mode: withGateModeChoice(gate, storefront, "inherit") }); }}
          >
            {shared("removeOverride")}
          </button>
        </td>
      </tr>
    );
  }

  function methodRow(row: RowKey, method: MandatoryMethod) {
    const key = row ?? "global";
    const open = expanded === row;
    return [
      <tr
        key={key}
        className={[
          row === null ? "forced-global-row" : "",
          conflictScopes.has(row ?? "global") ? "gate-mode-conflict-row" : "",
        ].filter(Boolean).join(" ") || undefined}
      >
        <th scope="row">
          <span className="method-row-title">
            {row === null
              ? <><strong>{shared("globalRow")}</strong><small>{shared("globalRowHint")}</small></>
              : <><strong>{forcedStorefrontName(row, locale)}</strong><small>{row}</small></>}
          </span>
        </th>
        <td>{methodSelect(row, method)}</td>
        {gateModeCell(row, method)}
        <td>
          <button
            type="button"
            className="button button-secondary button-small"
            aria-expanded={open}
            aria-controls={`method-row-detail-${key}`}
            onClick={() => setExpanded(open ? undefined : row)}
          >
            {open ? t("hideCopy") : t("showCopy")}
          </button>
        </td>
        <td>
          {row === null ? null : (
            <button type="button" className="button button-ghost button-danger button-small" disabled={!editable} onClick={() => removeOverride(row)}>
              {shared("removeOverride")}
            </button>
          )}
        </td>
      </tr>,
      open ? (
        <tr key={`${key}-detail`} className="method-row-expanded">
          <td colSpan={columnCount} id={`method-row-detail-${key}`}>{copyEditor(row)}</td>
        </tr>
      ) : null,
    ];
  }

  return (
    <div className="forced-workspace">
      {!access.editable ? <div className="alert alert-info page-alert">{t("readOnly")}</div> : null}
      {pending ? (
        <div className="alert alert-info page-alert">
          <strong>{t("pendingMutation")}</strong> {pending.action}
          <button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => void executeMutation(pending)}>{t("retryExact")}</button>
        </div>
      ) : null}
      {notice ? <div className={`alert alert-${notice.tone} page-alert`} role="status">{notice.text}</div> : null}
      {gateModeHidden && data?.contract_version === 1 ? (
        <div className="alert alert-warning page-alert" data-gate-mode-hidden="true">{gt("hiddenStored")}</div>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <div><h2>{t("tableTitle")}</h2><p>{t("tableCopy")}</p></div>
          <div className="row-actions">
            <span className="status-badge neutral">{t("draftRevision", { revision: data.policy.revision })}</span>
            {dirty ? <span className="status-badge status-pending">{columnCount === 5 ? t("unsavedWithMode") : t("unsaved")}</span> : null}
          </div>
        </div>
        <div className="panel-body form-stack">
          {columnCount === 5
            ? <VerificationGateModeLegend storesModes={verificationMethodPolicyStoresGateMode(data.policy)} closedMode={closedMode !== null} />
            : null}
          {closedMode !== null ? (
            <VerificationClosedModeControl
              id="closed-mode-threshold"
              value={closedMode.value}
              live={closedMode.live}
              catalogue={closedMode.catalogue}
              applies={closedModeThresholdApplies(gate)}
              storesThreshold={verificationMethodPolicyStoresClosedThreshold(data.policy)}
              disabled={!editable}
              onChange={(value) => { if (gate) patch({ gate_mode: withClosedBelowEvents(gate, value) }); }}
            />
          ) : null}
          <div className="table-wrap">
            <table className={`data-table method-policy-table${columnCount === 5 ? " method-policy-table-gate" : ""}`}>
              <thead>
                <tr>
                  <th>{t("columns.storefront")}</th>
                  <th>{t("columns.method")}</th>
                  {columnCount === 5 ? <th>{gt("column")}</th> : null}
                  <th>{t("columns.copy")}</th>
                  <th>{t("columns.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {methodRow(null, draft.global)}
                {sortedRows.map((row) => methodRow(row.storefront, row.method))}
                {columnCount === 5 ? modeOnlyRows.map((storefront) => modeOnlyRow(storefront)) : null}
              </tbody>
            </table>
          </div>
          <div className="row-actions">
            <select
              className="input"
              value={storefrontToAdd}
              disabled={!editable || draft.overrides.length >= VERIFICATION_METHOD_MAX_OVERRIDES}
              aria-label={shared("selectStorefront")}
              onChange={(event) => setStorefrontToAdd(event.target.value)}
            >
              <option value="">{shared("selectStorefront")}</option>
              {countries.map((country) => (
                <option key={country.alpha3} value={country.alpha3} disabled={usedStorefronts.has(country.alpha3)}>
                  {country.name} · {country.alpha3}
                </option>
              ))}
            </select>
            <button type="button" className="button button-secondary" disabled={!editable || !storefrontToAdd} onClick={addOverride}>
              {shared("addOverride")}
            </button>
          </div>
          {draftIssue ? <p className="field-error" role="alert">{shared(`validation.${draftIssue}`)}</p> : null}
          {draftUsesPhoto ? (
            <div className="alert alert-warning" data-verification-method-photo-rollout="true">
              <strong>{t("photoRollout.title")}</strong> {t("photoRollout.copy")}
            </div>
          ) : null}
          {photoBlocked ? photoBlockedAlert() : null}
          {otherConsoleBlockers.map((code) => (
            <div className="alert alert-warning" key={code}>{t("publishBlocked", { code })}</div>
          ))}
          {closedMode !== null && closedModeThresholdResetOnSave(gate) ? (
            // Lead ruling Q10: every scope is back on Full block, so Core drops
            // gate_mode on this save and the threshold returns to the default.
            <div className="alert alert-warning" role="status" data-closed-mode-save-preview="true">
              {gt("closedMode.savePreview", { value: thresholdLabel(closedMode.catalogue.default) })}
            </div>
          ) : null}
          <div className="forced-save-bar">
            <div className="row-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={busy || locked}
                onClick={() => {
                  // Review round 2: an explicit reload asks for the preferred wire
                  // again, so a session that fell back picks the gate modes (and the
                  // Closed mode threshold) up once Core speaks them.
                  wireRef.current = VERIFICATION_METHOD_PREFERRED_CONTRACT_VERSION;
                  void load(false);
                }}
              >
                {shared("reload")}
              </button>
              <button type="button" className="button button-primary" disabled={!editable || !dirty || draftIssue !== null} onClick={saveDraft}>
                {busy ? t("savingDraft") : t("saveDraft")}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div><h2>{t("publishTitle")}</h2><p>{t("publishCopy")}</p></div>
          <button
            type="button"
            className="button button-secondary"
            disabled={!access.previewable || busy || locked || pending !== null || dirty}
            onClick={() => void previewImpact()}
          >
            {t("previewImpact")}
          </button>
        </div>
        <div className="panel-body form-stack">
          {impact === null ? <p className="field-hint">{t("impactEmpty")}</p> : (
            <>
              {impactStale ? <div className="alert alert-warning">{t("impactStale")}</div> : null}
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t("impactColumns.storefront")}</th>
                      <th>{t("impactColumns.liveMethod")}</th>
                      <th>{t("impactColumns.draftMethod")}</th>
                      {impactModes ? <th>{gt("impactLiveMode")}</th> : null}
                      {impactModes ? <th>{gt("impactDraftMode")}</th> : null}
                      <th>{t("impactColumns.seen")}</th>
                      <th>{t("impactColumns.currentlyGated")}</th>
                      <th>{t("impactColumns.wouldBeGated")}</th>
                      <th>{t("impactColumns.satisfied")}</th>
                      <th>{t("impactColumns.newlyGated")}</th>
                      <th>{t("impactColumns.newlyReleased")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {impact.impact.by_storefront.map((row) => (
                      <tr key={row.storefront}>
                        <th scope="row">{forcedStorefrontName(row.storefront, locale)} · {row.storefront}</th>
                        <td>{t(`methods.${row.live_method}`)}</td>
                        <td>{t(`methods.${row.draft_method}`)}</td>
                        {impactModeCells(row)}
                        <td>{row.members_seen}</td>
                        <td>{row.currently_gated}</td>
                        <td>{row.would_be_gated}</td>
                        <td>{row.satisfied}</td>
                        <td>{row.newly_gated}</td>
                        <td>{row.newly_released}</td>
                      </tr>
                    ))}
                    <tr>
                      <th scope="row">{t("unknownStorefront")}</th>
                      <td>{t(`methods.${impact.impact.unknown_storefront.live_method}`)}</td>
                      <td>{t(`methods.${impact.impact.unknown_storefront.draft_method}`)}</td>
                      {impactModeCells(impact.impact.unknown_storefront)}
                      <td>{impact.impact.unknown_storefront.members_seen}</td>
                      <td>{impact.impact.unknown_storefront.currently_gated}</td>
                      <td>{impact.impact.unknown_storefront.would_be_gated}</td>
                      <td>{impact.impact.unknown_storefront.satisfied}</td>
                      <td>{impact.impact.unknown_storefront.newly_gated}</td>
                      <td>{impact.impact.unknown_storefront.newly_released}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {impactModes ? <p className="field-hint" data-gate-mode-impact-note="true">{gt("impactNote")}</p> : null}
              {impact.impact.closed_below_events
                ? <VerificationClosedModeImpact live={impact.impact.closed_below_events.live} draft={impact.impact.closed_below_events.draft} />
                : null}
              <small className="field-hint">{t("computedAt", { time: new Date(impact.evaluated_at * 1000).toISOString() })}</small>
              {impact.publish_guard.blocking_codes.filter((code) => code !== VERIFICATION_METHOD_PHOTO_UNAVAILABLE).map((code) => (
                <div className="alert alert-warning" key={code}>{t("publishBlocked", { code })}</div>
              ))}
              <label className="field">
                <span>{t("publishReason")}</span>
                <textarea
                  disabled={!access.publishable || busy || locked || pending !== null}
                  maxLength={VERIFICATION_METHOD_REASON_MAX}
                  placeholder={t("publishReasonPlaceholder")}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <label className="field">
                <span>{t("confirmation", { phrase: impact.confirmation_phrase })}</span>
                <input
                  disabled={!access.publishable || busy || locked || pending !== null}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
              <div className="row-actions">
                <button type="button" className="button button-danger" disabled={!publishReady} onClick={publish}>
                  {busy ? t("publishing") : t("publish")}
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
