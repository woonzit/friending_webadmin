"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { adminCall, type AdminResponse } from "@/lib/adminClient";
import {
  SECTION_TEASERS_DESCRIPTION_MAX,
  SECTION_TEASERS_TITLE_MAX,
  SECTION_TEASER_LANGUAGES,
  SECTION_TEASER_SECTIONS,
  sectionTeaserCopyIsValid,
  sectionTeaserPreview,
  sectionTeaserTextLength,
  sectionTeasersAuditReasonIsValid,
  sectionTeasersConflictResponse,
  sectionTeasersDraftAfterConflict,
  sectionTeasersDraftFrom,
  sectionTeasersDraftIssue,
  sectionTeasersDraftWithSection,
  sectionTeasersError,
  sectionTeasersErrorKey,
  sectionTeasersFieldPointer,
  sectionTeasersMutationConverged,
  sectionTeasersMutationResponse,
  sectionTeasersSavePayload,
  sectionTeasersShouldRetainMutation,
  sectionTeasersStateConverged,
  sectionTeasersStateResponse,
  type SectionTeaserKey,
  type SectionTeasersDraft,
  type SectionTeasersSavePayload,
  type SectionTeasersState,
} from "@/lib/sectionTeasers";

type Notice = { tone: "info" | "error" | "success"; text: string } | null;

/**
 * The teaser console (D-120), rendered INSIDE the section-availability
 * configuration card but transacting on its own.
 *
 * It deliberately does not join the `set_settings` transaction the card's
 * on/off switches use: `hidden` and the copy live in Core's own receipted
 * `section_teasers` singleton with its own revision, so this panel owns one
 * load, one save button and one conflict path of its own.
 *
 * It lives in its own module so the card file keeps exactly one
 * `type="checkbox"` source — the global availability switch — which
 * `tests/sectionAvailability.test.mts` pins.
 */
export type SectionTeasersConsole = {
  state: "loading" | "ready" | "error";
  draft: SectionTeasersDraft | null;
  current: SectionTeasersState | null;
  notice: Notice;
  invalidField: string | null;
  auditReason: string;
  busy: boolean;
  /** A command whose outcome is unknown; the retry replays the SAME id. */
  pending: boolean;
  setAuditReason: (value: string) => void;
  patch: (section: SectionTeaserKey, changes: Partial<SectionTeasersDraft[SectionTeaserKey]>) => void;
  save: () => void;
  reload: () => void;
};

function newRequestId(): string | null {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return null;
  }
}

export function useSectionTeasers(): SectionTeasersConsole {
  const t = useTranslations("configuration.sectionAvailability.teaser");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [current, setCurrent] = useState<SectionTeasersState | null>(null);
  const [draft, setDraft] = useState<SectionTeasersDraft | null>(null);
  const [auditReason, setAuditReason] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef<SectionTeasersSavePayload | null>(null);
  const loadSequenceRef = useRef(0);

  const clearPending = useCallback(() => {
    pendingRef.current = null;
    setPending(false);
  }, []);

  const load = useCallback(async () => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    const response = await adminCall("section_teasers_get", { contract_version: 1 });
    if (sequence !== loadSequenceRef.current) return;
    const parsed = sectionTeasersStateResponse(response);
    if (!parsed) {
      const error = sectionTeasersError(response);
      // A malformed read is an error, never two proven blank teasers.
      setCurrent(null);
      setState("error");
      setNotice({
        tone: "error",
        text: error
          ? t("live.errorCode", { message: t(`errors.${sectionTeasersErrorKey(error)}`) })
          : t("live.unknownError"),
      });
      return;
    }
    setCurrent(parsed);
    setDraft(sectionTeasersDraftFrom(parsed));
    const candidate = pendingRef.current;
    if (candidate && sectionTeasersStateConverged(candidate, parsed)) {
      clearPending();
      setNotice({ tone: "success", text: t("live.converged") });
    }
    setState("ready");
  }, [clearPending, t]);

  useEffect(() => { void load(); }, [load]);

  const patch = useCallback((
    section: SectionTeaserKey,
    changes: Partial<SectionTeasersDraft[SectionTeaserKey]>,
  ) => {
    setDraft((value) => (value ? sectionTeasersDraftWithSection(value, section, changes) : value));
    setNotice(null);
    setInvalidField(null);
  }, []);

  const save = useCallback(() => {
    void (async () => {
      if (busy || !current || !draft) return;
      let command = pendingRef.current;
      if (!command) {
        if (sectionTeasersDraftIssue(draft)) {
          setNotice({ tone: "error", text: t("live.draftInvalid") });
          return;
        }
        if (!sectionTeasersAuditReasonIsValid(auditReason)) {
          setNotice({ tone: "error", text: t("live.reasonRequired") });
          return;
        }
        const requestId = newRequestId();
        if (!requestId) {
          setNotice({ tone: "error", text: t("live.requestIdUnavailable") });
          return;
        }
        command = sectionTeasersSavePayload(draft, current.revision, requestId, auditReason);
        if (!command) {
          setNotice({ tone: "error", text: t("live.draftInvalid") });
          return;
        }
      }

      setBusy(true);
      setNotice(null);
      setInvalidField(null);
      // Never mint a second request id: a retry is the SAME logical command,
      // which is what makes Core's receipt answer `replayed` instead of writing
      // twice.
      pendingRef.current = command;
      setPending(true);
      const response: AdminResponse | null = await adminCall("save_section_teasers", command);

      const result = sectionTeasersMutationResponse(response);
      if (result && sectionTeasersMutationConverged(command, result)) {
        clearPending();
        setCurrent(result);
        setDraft(sectionTeasersDraftFrom(result));
        setAuditReason("");
        setNotice({
          tone: "success",
          text: t(result.replayed
            ? "live.replayed"
            : result.no_change ? "live.noChange" : "live.saved"),
        });
        setBusy(false);
        return;
      }

      const conflict = sectionTeasersConflictResponse(response);
      if (conflict) {
        // The conflict body IS the authoritative state, so the reload costs no
        // round trip: adopt it and rebuild the draft from what is stored now.
        const rebased = sectionTeasersDraftAfterConflict(conflict, command);
        setCurrent(rebased.state);
        setDraft(rebased.draft);
        clearPending();
        setNotice({
          tone: rebased.satisfied ? "info" : "error",
          text: t(rebased.satisfied ? "live.conflictAlreadyApplied" : "live.conflict", {
            revision: rebased.state.revision,
          }),
        });
        setBusy(false);
        return;
      }

      // A malformed conflict and any illegal data-bearing refusal decode as
      // unknown, so this branch retains the exact pending command.
      const error = sectionTeasersError(response);
      setInvalidField(sectionTeasersFieldPointer(response));
      if (!sectionTeasersShouldRetainMutation(error)) clearPending();
      setNotice({
        tone: "error",
        text: error
          ? t("live.errorCode", { message: t(`errors.${sectionTeasersErrorKey(error)}`) })
          : t("live.unknownError"),
      });
      setBusy(false);
    })();
  }, [auditReason, busy, clearPending, current, draft, t]);

  return {
    state,
    draft,
    current,
    notice,
    invalidField,
    auditReason,
    busy,
    pending,
    setAuditReason,
    patch,
    save,
    reload: () => { void load(); },
  };
}

type ControlsProps = {
  section: SectionTeaserKey;
  teasers: SectionTeasersConsole;
  /** The section's global availability switch; a teaser only shows when OFF. */
  sectionEnabled: boolean;
  disabled: boolean;
};

/**
 * The per-section block, rendered under the section's global switch. Pure: it
 * reads the console object and calls back, so a static render covers the on,
 * off-and-hidden and off-and-teased states without a network effect.
 */
export function SectionTeaserControls({
  section,
  teasers,
  sectionEnabled,
  disabled,
}: ControlsProps) {
  const t = useTranslations("configuration.sectionAvailability.teaser");
  const draft = teasers.draft;
  if (teasers.state === "loading" || !draft) {
    return (
      <div className="section-teaser" data-section-teaser={section}>
        <p className="field-hint">
          {teasers.state === "error" ? t("loadError") : t("loading")}
        </p>
      </div>
    );
  }
  const row = draft[section];
  const busy = disabled || teasers.busy;

  return (
    <div className="section-teaser" data-section-teaser={section}>
      <label className="section-teaser-hidden">
        <span>
          <strong>{t("hiddenTitle")}</strong>
          <small>{t("hiddenCopy")}</small>
        </span>
        <span className="switch">
          <input
            type="checkbox"
            checked={row.hidden}
            disabled={busy}
            aria-invalid={teasers.invalidField === `sections.${section}.hidden` ? "true" : undefined}
            onChange={(event) => teasers.patch(section, { hidden: event.target.checked })}
          />
          <span className="switch-track" />
        </span>
      </label>

      {row.hidden ? (
        <p className="field-hint section-teaser-note">{t("hiddenActive")}</p>
      ) : (
        <div className="section-teaser-copy">
          <p className="field-hint section-teaser-note">
            {sectionEnabled ? t("onlyWhenOff") : t("blankFallback")}
          </p>
          {(["title", "description"] as const).map((slot) => (
            <div className="section-teaser-fields" key={slot}>
              {SECTION_TEASER_LANGUAGES.map((language) => {
                const max = slot === "title"
                  ? SECTION_TEASERS_TITLE_MAX
                  : SECTION_TEASERS_DESCRIPTION_MAX;
                const field = `sections.${section}.${slot}.${language}`;
                const value = row[slot][language];
                const invalid = teasers.invalidField === field
                  || teasers.invalidField === `sections.${section}.${slot}`
                  || !sectionTeaserCopyIsValid(value, max);
                const id = `section-teaser-${section}-${slot}-${language}`;
                return (
                  <div className="field" key={language}>
                    <label className="field-label" htmlFor={id}>
                      {t(`fields.${slot}`)} · {t(`languages.${language}`)}
                    </label>
                    {slot === "title" ? (
                      <input
                        id={id}
                        type="text"
                        className="input"
                        value={value}
                        disabled={busy}
                        aria-invalid={invalid ? "true" : undefined}
                        onChange={(event) => teasers.patch(section, {
                          title: { ...row.title, [language]: event.target.value },
                        })}
                      />
                    ) : (
                      <textarea
                        id={id}
                        className="input"
                        rows={3}
                        value={value}
                        disabled={busy}
                        aria-invalid={invalid ? "true" : undefined}
                        onChange={(event) => teasers.patch(section, {
                          description: { ...row.description, [language]: event.target.value },
                        })}
                      />
                    )}
                    <span className="field-hint">
                      {t("counter", { count: sectionTeaserTextLength(value), max })}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}

          <div className="section-teaser-preview">
            <span className="field-label">{t("previewTitle")}</span>
            {SECTION_TEASER_LANGUAGES.map((language) => {
              const preview = sectionTeaserPreview(row, language);
              return (
                <p
                  className="field-hint section-teaser-preview-line"
                  data-teaser-preview={`${section}-${language}`}
                  key={language}
                >
                  {t("languages." + language)}: <strong>{preview.title}</strong>
                  {" — "}
                  {preview.description}
                </p>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The teaser family's OWN save row: its own reason, its own revision line and
 * its own notice, so an operator can never mistake it for the availability
 * transaction that shares the card.
 */
export function SectionTeasersSaveRow({
  teasers,
  disabled,
}: { teasers: SectionTeasersConsole; disabled: boolean }) {
  const t = useTranslations("configuration.sectionAvailability.teaser");
  const draft = teasers.draft;
  const anyVisible = draft !== null
    && SECTION_TEASER_SECTIONS.some((section) => !draft[section].hidden);

  return (
    <div className="section-teaser-actions">
      <div className="section-teaser-actions-heading">
        <div>
          <h4>{t("title")}</h4>
          <p>{t("copy")}</p>
        </div>
        {teasers.current ? (
          <span className="status-badge neutral">
            {t("revision", { revision: teasers.current.revision })}
          </span>
        ) : null}
      </div>

      {teasers.state === "error" ? (
        <div className="alert alert-error" role="alert">
          <p>{t("loadError")}</p>
          <button type="button" className="text-button" onClick={teasers.reload}>
            {t("reload")}
          </button>
        </div>
      ) : null}

      {teasers.state === "ready" ? (
        <>
          {anyVisible ? null : (
            <p className="field-hint section-teaser-note">{t("allHidden")}</p>
          )}
          <div className="field">
            <label className="field-label" htmlFor="section-teaser-reason">
              {t("reasonLabel")}
            </label>
            <input
              id="section-teaser-reason"
              type="text"
              className="input"
              value={teasers.auditReason}
              disabled={disabled || teasers.busy}
              aria-invalid={teasers.invalidField === "audit_reason" ? "true" : undefined}
              onChange={(event) => teasers.setAuditReason(event.target.value)}
            />
            <span className="field-hint">{t("reasonHint")}</span>
          </div>
          {teasers.pending ? (
            <p className="field-hint section-teaser-note">{t("live.pending")}</p>
          ) : null}
          <button
            type="button"
            className="button button-secondary"
            disabled={disabled || teasers.busy || teasers.current === null}
            onClick={teasers.save}
          >
            {teasers.busy ? t("saving") : teasers.pending ? t("retry") : t("save")}
          </button>
        </>
      ) : null}

      {teasers.notice ? (
        <p
          className={`field-hint section-teaser-notice section-teaser-notice-${teasers.notice.tone}`}
          role={teasers.notice.tone === "error" ? "alert" : "status"}
        >
          {teasers.notice.text}
        </p>
      ) : null}
    </div>
  );
}
