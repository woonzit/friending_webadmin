"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  VERIFICATION_GATE_MODES,
  type VerificationGateMode,
  type VerificationGateModeChoice,
} from "@/lib/verificationMethod";

type Props = {
  id: string;
  /** The global row has no "same as Global" choice; a storefront row does. */
  scope: "global" | "storefront";
  /**
   * False when the row's effective method is `none`. There is then nothing to
   * gate: the control shows Off and cannot change (contract §8.1, "Off" is the
   * method `none`, never a stored mode).
   */
  forced: boolean;
  choice: VerificationGateModeChoice;
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
  forced,
  choice,
  inherited,
  recommended,
  disabled,
  onChange,
}: Props) {
  const t = useTranslations("verificationAdmin.methodPolicy.gateMode");
  const modeLabel = (mode: VerificationGateMode) => t(`modes.${mode}`);

  if (!forced) {
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
  return (
    <div className="method-cell gate-mode-cell" data-gate-mode-control={scope} data-gate-mode={effective}>
      <select
        id={id}
        className="input"
        value={choice}
        disabled={disabled}
        aria-label={t("column")}
        onChange={(event) => {
          if (isChoice(event.target.value)) onChange(event.target.value);
        }}
      >
        {scope === "storefront"
          ? <option value="inherit">{t("inheritOption", { mode: modeLabel(inherited) })}</option>
          : null}
        {VERIFICATION_GATE_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {mode === recommended ? t("recommendedOption", { mode: modeLabel(mode) }) : modeLabel(mode)}
          </option>
        ))}
      </select>
      {effective === recommended ? null : (
        <small className="field-hint gate-mode-recommended" data-gate-mode-recommended={recommended}>
          {t("recommendedHint", { mode: modeLabel(recommended) })}
        </small>
      )}
    </div>
  );
}

/** One line per mode, the client note, and the rollback rule, above the table. */
export function VerificationGateModeLegend() {
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
    </div>
  );
}
