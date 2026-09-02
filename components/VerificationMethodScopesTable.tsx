"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall, type AdminResponse } from "@/lib/adminClient";
import {
  WAITING_ROOM_COPY_FIELDS,
  WAITING_ROOM_COPY_LIMITS,
  WAITING_ROOM_HELP_URL_MAX_BYTES,
  WAITING_ROOM_LOCALES,
  emptyWaitingRoomCopyOverrideDraft,
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
  VERIFICATION_METHOD_REASON_MAX,
  VERIFICATION_METHOD_UNAVAILABLE_ERROR,
  VERIFICATION_START_METHODS,
  validateVerificationMethodDraft,
  verificationMethodConflictResponse,
  verificationMethodConsoleResponse,
  verificationMethodDocumentFromDraft,
  verificationMethodDocumentsEqual,
  verificationMethodDraft,
  verificationMethodErrorResponse,
  verificationMethodImpactResponse,
  verificationMethodMutationResponse,
  verificationMethodPendingFrom,
  verificationMethodPendingMutation,
  verificationMethodPersistBeforeMutation,
  verificationMethodReason,
  verificationMethodShouldRetainMutation,
  type MandatoryMethod,
  type VerificationMethodAccess,
  type VerificationMethodAvailabilityMap,
  type VerificationMethodConsoleData,
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
  labels: { persona: string; video: string; footer: string[]; notForced: string; help: string; modeLabel: string };
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
            {method === "persona" ? labels.persona : labels.video}
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
 * `persona | video | none` and, beneath it, that row's bilingual Waiting Room
 * copy. Core owns the document, its single revision over `{draft, live}`,
 * availability, validation, the impact scan, publication and audit.
 *
 * Discipline: exact decoders, closed refusal vocabulary, CAS on the observed
 * revision, and one durable retained command in `sessionStorage` that is
 * replayed byte-for-byte after an uncertain answer — never a second logical
 * action.
 */
export default function VerificationMethodScopesTable({ access, locked }: Props) {
  const t = useTranslations("verificationAdmin.methodPolicy");
  const shared = useTranslations("verificationAdmin.forced");
  /** Contract §8.1: the availability reason reuses the existing live vocabulary unchanged. */
  const methodReason = useTranslations("verificationAdmin.live.methodReasons");
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
  const [pending, setPending] = useState<VerificationMethodPendingMutation | null>(null);
  const pendingRef = useRef<VerificationMethodPendingMutation | null>(null);

  const countries = useMemo(() => localizedForcedStorefronts(locale), [locale]);
  const editable = access.editable && !locked && !busy && pending === null;

  const adopt = useCallback((policy: VerificationMethodPolicy, keepDraft: boolean) => {
    setData((current) => (current ? { ...current, policy } : current));
    setDraft((current) => (keepDraft && current ? current : verificationMethodDraft(policy.draft.document)));
    setImpact(null);
    setConfirmation("");
  }, []);

  const load = useCallback(async (keepDraft: boolean) => {
    setState((current) => (current === "ready" ? current : "loading"));
    const response = await adminCall("verification_method_console", { contract_version: 1 });
    const parsed = verificationMethodConsoleResponse(response);
    if (!parsed) {
      const error = verificationMethodErrorResponse(response);
      setState(error === VERIFICATION_METHOD_UNAVAILABLE_ERROR ? "unavailable" : "error");
      return;
    }
    setData(parsed);
    setDraft((current) => (keepDraft && current ? current : verificationMethodDraft(parsed.policy.draft.document)));
    setImpact(null);
    setConfirmation("");
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

  function refusalNotice(error: ReturnType<typeof verificationMethodErrorResponse>): Notice {
    if (error === null) return { tone: "error", text: t("uncertain") };
    if (error === "verification-method-video-unavailable" || error === "verification-method-persona-unavailable") {
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
    const success = verificationMethodMutationResponse(response);
    if (success) {
      const cleared = clearPending();
      if (!cleared) {
        setNotice({ tone: "error", text: t("persistenceCleanupFailed") });
        setBusy(false);
        return;
      }
      adopt(success.policy, false);
      setData((current) => (current
        ? { ...current, policy: success.policy, method_availability: success.method_availability }
        : current));
      setNotice(success.replayed
        ? { tone: "info", text: t("replayed") }
        : durable.action === "verification_method_save"
          ? { tone: "success", text: t("draftSaved", { revision: success.policy.revision }) }
          : { tone: "success", text: t("published", { revision: success.policy.revision }) });
      setBusy(false);
      return;
    }
    const conflict = verificationMethodConflictResponse(response);
    if (conflict) {
      const cleared = clearPending();
      adopt(conflict.data.policy, false);
      setData((current) => (current
        ? { ...current, policy: conflict.data.policy, method_availability: conflict.data.method_availability }
        : current));
      setNotice({ tone: "error", text: cleared ? t("conflict") : t("persistenceCleanupFailed") });
      setBusy(false);
      return;
    }
    const error = verificationMethodErrorResponse(response);
    if (!verificationMethodShouldRetainMutation(error)) clearPending();
    setNotice(refusalNotice(error));
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
      contract_version: 1,
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
    const response = await adminCall("verification_method_impact", {
      contract_version: 1,
      expected_revision: expected,
    });
    const parsed = verificationMethodImpactResponse(response);
    const bound = parsed?.expected_revision === expected ? parsed : null;
    setImpact(bound);
    setConfirmation("");
    if (bound) {
      setNotice({ tone: "info", text: t("impactReady", { revision: expected }) });
      setBusy(false);
      return;
    }
    const conflict = verificationMethodConflictResponse(response);
    if (conflict) {
      adopt(conflict.data.policy, false);
      setNotice({ tone: "error", text: t("conflict") });
      setBusy(false);
      return;
    }
    const error = verificationMethodErrorResponse(response);
    setNotice({ tone: "error", text: t("impactFailed", { code: error ?? "invalid-core-response" }) });
    setBusy(false);
  }

  function publish() {
    if (!impact || !impactBound || !access.publishable || locked || busy || pending !== null) return;
    const normalizedReason = verificationMethodReason(reason);
    if (!normalizedReason || confirmation !== VERIFICATION_METHOD_CONFIRMATION_PHRASE) return;
    startMutation("verification_method_apply", {
      contract_version: 1,
      expected_revision: impact.expected_revision,
      normalized_fingerprint: impact.normalized_fingerprint,
      confirmation_phrase: impact.confirmation_phrase,
      reason: normalizedReason,
      request_id: crypto.randomUUID(),
    });
  }

  function patch(next: Partial<VerificationMethodDraft>) {
    setDraft((current) => (current ? { ...current, ...next } : current));
    setNotice(null);
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
    if (!draft || !storefrontToAdd || draft.overrides.some((row) => row.storefront === storefrontToAdd)) return;
    patch({
      overrides: [...draft.overrides, {
        storefront: storefrontToAdd,
        // A new row starts from the value it currently inherits, so adding it changes nothing by itself.
        method: draft.global,
        copy: emptyWaitingRoomCopyOverrideDraft(),
      }],
    });
    setExpanded(storefrontToAdd);
    setStorefrontToAdd("");
  }

  function removeOverride(storefront: string) {
    if (!draft) return;
    // Contract §7.1: removing a row removes its method AND its copy override together.
    patch({ overrides: draft.overrides.filter((row) => row.storefront !== storefront) });
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
  const usedStorefronts = new Set(draft.overrides.map((row) => row.storefront));
  const sortedRows = [...draft.overrides].sort((left, right) => (
    forcedStorefrontName(left.storefront, locale).localeCompare(forcedStorefrontName(right.storefront, locale), locale)
    || left.storefront.localeCompare(right.storefront)
  ));
  const normalizedReason = verificationMethodReason(reason);
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

  function methodRow(row: RowKey, method: MandatoryMethod) {
    const key = row ?? "global";
    const open = expanded === row;
    return [
      <tr key={key} className={row === null ? "forced-global-row" : undefined}>
        <th scope="row">
          {row === null
            ? <><strong>{shared("globalRow")}</strong><small>{shared("globalRowHint")}</small></>
            : <><strong>{forcedStorefrontName(row, locale)}</strong><small>{row}</small></>}
        </th>
        <td>{methodSelect(row, method)}</td>
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
          <td colSpan={4} id={`method-row-detail-${key}`}>{copyEditor(row)}</td>
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

      <section className="panel">
        <div className="panel-header">
          <div><h2>{t("tableTitle")}</h2><p>{t("tableCopy")}</p></div>
          <div className="row-actions">
            <span className="status-badge neutral">{t("draftRevision", { revision: data.policy.revision })}</span>
            {dirty ? <span className="status-badge status-pending">{t("unsaved")}</span> : null}
          </div>
        </div>
        <div className="panel-body form-stack">
          <div className="table-wrap">
            <table className="data-table method-policy-table">
              <thead>
                <tr>
                  <th>{t("columns.storefront")}</th>
                  <th>{t("columns.method")}</th>
                  <th>{t("columns.copy")}</th>
                  <th>{t("columns.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {methodRow(null, draft.global)}
                {sortedRows.map((row) => methodRow(row.storefront, row.method))}
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
          <div className="forced-save-bar">
            <div className="row-actions">
              <button type="button" className="button button-secondary" disabled={busy || locked} onClick={() => void load(false)}>{shared("reload")}</button>
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
              <small className="field-hint">{t("computedAt", { time: new Date(impact.evaluated_at * 1000).toISOString() })}</small>
              {impact.publish_guard.blocking_codes.map((code) => (
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
