"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  VERIFICATION_GATE_MODES,
  gateModeExploreAllowed,
  type MandatoryMethod,
  type VerificationGateMode,
  type VerificationGateModeChoice,
} from "@/lib/verificationMethod";

type Props = {
  id: string;
  /** The global row has no "same as Global" choice; a storefront row does. */
  scope: "global" | "storefront";
  /**
   * The row's effective method. `none` means there is nothing to gate: the
   * control shows Off and cannot change (contract §8.1, "Off" is the method
   * `none`, never a stored mode). Explore runs only under Persona (D-151
   * review), so for video and photo the Explore choices are disabled.
   */
  method: MandatoryMethod;
  choice: VerificationGateModeChoice;
  /** Core named this scope in an `explore_requires_persona` refusal. */
  flagged?: boolean;
  /** The global mode an inheriting storefront row follows. */
  inherited: VerificationGateMode;
  /** Core's `gate_mode_catalogue.recommended`. */
  recommended: VerificationGateMode;
  disabled: boolean;
  onChange: (choice: VerificationGateModeChoice) => void;
};

function isChoice(value: string): value is VerificationGateModeChoice {
  return value === "inherit" || (VERIFICATION_GATE_MODES as readonly string[]).includes(value);
}

/**
 * D-151 gate mode for one scope of the verification-method table: Explore mode
 * (events open, people locked) or Full block (the Waiting Room). Presentation
 * only — the table owns the draft, and the draft changes only through
 * `onChange`, i.e. only when the operator picks a value.
 */
export default function VerificationGateModeControl({
  id,
  scope,
  method,
  choice,
  flagged = false,
  inherited,
  recommended,
  disabled,
  onChange,
}: Props) {
  const t = useTranslations("verificationAdmin.methodPolicy.gateMode");
  const modeLabel = (mode: VerificationGateMode) => t(`modes.${mode}`);

  if (method === "none") {
    return (
      <div className="method-cell gate-mode-cell" data-gate-mode-control={scope} data-gate-mode="off">
        <select id={id} className="input" value="off" disabled aria-label={t("column")}>
          <option value="off">{t("modes.off")}</option>
        </select>
        <small className="field-hint">{t("offHint")}</small>
      </div>
    );
  }

  const effective = choice === "inherit" ? inherited : choice;
  const exploreAllowed = gateModeExploreAllowed(method);
  /** Explore under video or photo: Core refuses the save, so the row says why and how to fix it. */
  const conflict = flagged || (!exploreAllowed && effective === "explore");
  const allowed = (mode: VerificationGateMode) => mode !== "explore" || exploreAllowed;
  return (
    <div
      className={`method-cell gate-mode-cell${conflict ? " is-conflict" : ""}`}
      data-gate-mode-control={scope}
      data-gate-mode={effective}
      data-gate-mode-conflict={conflict ? "true" : undefined}
    >
      <select
        id={id}
        className="input"
        value={choice}
        disabled={disabled}
        aria-label={t("column")}
        aria-invalid={conflict || undefined}
        onChange={(event) => {
          if (isChoice(event.target.value)) onChange(event.target.value);
        }}
      >
        {scope === "storefront"
          ? <option value="inherit" disabled={!allowed(inherited)}>{t("inheritOption", { mode: modeLabel(inherited) })}</option>
          : null}
        {VERIFICATION_GATE_MODES.map((mode) => (
          <option key={mode} value={mode} disabled={!allowed(mode)}>
            {mode === recommended && allowed(mode) ? t("recommendedOption", { mode: modeLabel(mode) }) : modeLabel(mode)}
          </option>
        ))}
      </select>
      {!exploreAllowed ? (
        <small className={conflict ? "field-error" : "field-hint"} data-gate-mode-persona-only="true">
          {conflict ? t("personaOnlyConflict") : t("personaOnly")}
        </small>
      ) : conflict ? (
        <small className="field-error" data-gate-mode-persona-only="true">{t("personaOnlyConflict")}</small>
      ) : effective === recommended ? null : (
        <small className="field-hint gate-mode-recommended" data-gate-mode-recommended={recommended}>
          {t("recommendedHint", { mode: modeLabel(recommended) })}
        </small>
      )}
    </div>
  );
}

/**
 * One line per mode, the client note, and the rollback rule, above the table.
 * `liveStoresModes`: the live document differs from the Full block default, so
 * Core stores `gate_mode` and a Core older than D-151 could not read it. Core
 * omits the key only for Global Full block with no storefront entry; a
 * storefront set explicitly to Full block is still stored.
 */
export function VerificationGateModeLegend({ liveStoresModes }: { liveStoresModes: boolean }) {
  const t = useTranslations("verificationAdmin.methodPolicy.gateMode");
  return (
    <div className="gate-mode-legend" data-gate-mode-legend="true">
      <strong>{t("legend.title")}</strong>
      <ul>
        <li><strong>{t("modes.explore")}</strong> · {t("legend.explore")}</li>
        <li><strong>{t("modes.full_block")}</strong> · {t("legend.full_block")}</li>
        <li><strong>{t("modes.off")}</strong> · {t("legend.off")}</li>
      </ul>
      <small className="field-hint">{t("legend.clients")}</small>
      <p className="gate-mode-rollback" data-gate-mode-rollback="true">
        <strong>{t("rollbackTitle")}</strong> {t("rollback")}
      </p>
      <p className="gate-mode-rollback" data-gate-mode-live-stored={liveStoresModes ? "true" : "false"}>
        {liveStoresModes ? t("liveStored") : t("liveNotStored")}
      </p>
    </div>
  );
}
