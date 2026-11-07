"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  VERIFICATION_CLOSED_BELOW_EVENTS_OFF,
  VERIFICATION_GATE_MODES,
  gateModeChoice,
  gateModeExploreAllowed,
  gateModeStoredUnderNone,
  verificationClosedBelowEvents,
  type MandatoryMethod,
  type VerificationClosedModeCatalogue,
  type VerificationGateMode,
  type VerificationGateModeChoice,
  type VerificationGateModePolicy,
} from "@/lib/verificationMethod";

type Props = {
  id: string;
  /** The draft's gate modes; the control reads its own row from them. */
  gate: VerificationGateModePolicy;
  /** `null` is the Global row (no "Same as Global" choice); a code is that storefront's row. */
  storefront: string | null;
  /** How the operator reads this scope ("Global default", "Hungary (HUN)"); names the select. */
  scopeLabel: string;
  /**
   * The row's effective method. `none` means nobody in this scope itself is
   * gated: the control shows Off (contract §8.1, "Off" is the method `none`,
   * never a stored mode). Core still keeps a mode stored under None (review
   * round 1). Explore runs only under Persona (D-151 review), so for video and
   * photo the Explore choices are disabled.
   */
  method: MandatoryMethod;
  /**
   * Global row only: the forcing storefronts that follow Global's mode, as the
   * operator reads them. Under a Global None the mode is in effect for them
   * (review round 2), so the control stays a real choice and names them.
   */
  inheritedBy?: string[];
  /**
   * Global row under None: at least one follower forces Persona, so Explore
   * can stand there (review round 3). Without one, every follower would be
   * refused and the draft could never save, so Explore is not offered.
   */
  followersAllowExplore?: boolean;
  /** A storefront's explicit Full block that Core drops on save while every scope is Full block. */
  pinDroppedOnSave?: boolean;
  /** Core named this scope in an `explore_requires_persona` refusal. */
  flagged?: boolean;
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
  gate,
  storefront,
  scopeLabel,
  method,
  inheritedBy = [],
  followersAllowExplore = false,
  pinDroppedOnSave = false,
  flagged = false,
  recommended,
  disabled,
  onChange,
}: Props) {
  const t = useTranslations("verificationAdmin.methodPolicy.gateMode");
  const modeLabel = (mode: VerificationGateMode) => t(`modes.${mode}`);
  const scope = storefront === null ? "global" : "storefront";
  const choice = gateModeChoice(gate, storefront);
  const inherited = gate.global;
  const hintId = `${id}-hint`;
  const pinId = `${id}-pin`;
  const name = t("columnFor", { scope: scopeLabel });
  const change = (event: React.ChangeEvent<HTMLSelectElement>) => {
    if (isChoice(event.target.value)) onChange(event.target.value);
  };
  const appliesTo = storefront === null && method === "none" && inheritedBy.length > 0;

  if (method === "none" && !appliesTo) {
    const stored = gateModeStoredUnderNone(gate, storefront);
    if (stored === null) {
      return (
        <div className="method-cell gate-mode-cell" data-gate-mode-control={scope} data-gate-mode="off">
          <select id={id} className="input" value="off" disabled aria-label={name} aria-describedby={hintId}>
            <option value="off">{t("modes.off")}</option>
          </select>
          <small id={hintId} className="field-hint">{t("offHint")}</small>
        </div>
      );
    }
    // Off, nobody follows it, and a mode is still stored: Core keeps it, it
    // blocks the three-key rollback form, and it returns if the method
    // changes. Only clearing it is offered.
    return (
      <div className="method-cell gate-mode-cell" data-gate-mode-control={scope} data-gate-mode="off" data-gate-mode-stored={stored}>
        <select id={id} className="input" value={choice} disabled={disabled} aria-label={name} aria-describedby={hintId} onChange={change}>
          <option value={stored} disabled>{t("storedOption", { mode: modeLabel(stored) })}</option>
          <option value="full_block">{modeLabel("full_block")}</option>
          {scope === "storefront"
            ? <option value="inherit">{t("inheritOption", { mode: modeLabel(inherited) })}</option>
            : null}
        </select>
        <small id={hintId} className="field-hint" data-gate-mode-off-stored="true">
          {t("offStoredHint", { mode: modeLabel(stored) })}
        </small>
      </div>
    );
  }

  const effective = choice === "inherit" ? inherited : choice;
  // A Global None that storefronts follow: the mode is theirs, so Explore
  // stands only if one of them forces Persona; a video or photo follower is
  // flagged on its own row, as Core flags that storefront.
  const exploreAllowed = appliesTo ? followersAllowExplore : gateModeExploreAllowed(method);
  /** Explore under video or photo: Core refuses the save, so the row says why and how to fix it. */
  const conflict = flagged || (!exploreAllowed && effective === "explore");
  const allowed = (mode: VerificationGateMode) => mode !== "explore" || exploreAllowed;
  const hint = conflict
    ? <small id={hintId} className="field-error" data-gate-mode-persona-only="true">{t("personaOnlyConflict")}</small>
    : appliesTo
      ? (
        <small id={hintId} className="field-hint" data-gate-mode-applies-to={inheritedBy.join(",")}>
          {t("appliesTo", { storefronts: inheritedBy.join(", ") })}
          {exploreAllowed ? null : <> {t("personaOnly")}</>}
        </small>
      )
      : !exploreAllowed
        ? <small id={hintId} className="field-hint" data-gate-mode-persona-only="true">{t("personaOnly")}</small>
        : effective === recommended
          ? null
          : (
            <small id={hintId} className="field-hint gate-mode-recommended" data-gate-mode-recommended={recommended}>
              {t("recommendedHint", { mode: modeLabel(recommended) })}
            </small>
          );
  const pin = pinDroppedOnSave && choice === "full_block"
    ? <small id={pinId} className="field-hint" data-gate-mode-pin-dropped="true">{t("pinDroppedOnSave")}</small>
    : null;
  const describedBy = [hint ? hintId : null, pin ? pinId : null].filter(Boolean).join(" ") || undefined;
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
        aria-label={name}
        aria-describedby={describedBy}
        aria-invalid={conflict || undefined}
        onChange={change}
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
      {hint}
      {pin}
    </div>
  );
}

/**
 * One line per mode, the client note, and the rollback rule, above the table.
 * `storesModes`: the saved draft or the live document holds a mode other than
 * Full block, so Core stores `gate_mode`. A Core older than D-151 normalizes
 * both documents on every gated request and would fail closed for everybody.
 * Core drops the whole key only when every scope is Full block.
 * `closedMode` (D-152, console v3 only): the Explore line points at the
 * Closed mode control below it; v1/v2 keep the released line.
 */
export function VerificationGateModeLegend({ storesModes, closedMode = false }: { storesModes: boolean; closedMode?: boolean }) {
  const t = useTranslations("verificationAdmin.methodPolicy.gateMode");
  return (
    <div className="gate-mode-legend" data-gate-mode-legend="true">
      <strong>{t("legend.title")}</strong>
      <ul>
        <li data-gate-mode-legend-explore={closedMode ? "closed-mode" : undefined}>
          <strong>{t("modes.explore")}</strong> · {closedMode ? t("legend.exploreClosedMode") : t("legend.explore")}
        </li>
        <li><strong>{t("modes.full_block")}</strong> · {t("legend.full_block")}</li>
        <li><strong>{t("modes.off")}</strong> · {t("legend.off")}</li>
      </ul>
      <small className="field-hint">{t("legend.clients")}</small>
      <p className="gate-mode-rollback" data-gate-mode-rollback="true">
        <strong>{t("rollbackTitle")}</strong> {t("rollback")}
      </p>
      <p className="gate-mode-rollback" data-gate-mode-stored={storesModes ? "true" : "false"}>
        {storesModes ? t("storedModes") : t("noStoredModes")}
      </p>
    </div>
  );
}

/** A threshold as the operator reads it: 0 is "Never close (always Explore)", otherwise "N events". */
export function useClosedModeLabel() {
  const t = useTranslations("verificationAdmin.methodPolicy.gateMode.closedMode");
  return (value: number) => (value === VERIFICATION_CLOSED_BELOW_EVENTS_OFF ? t("never") : t("option", { count: value }));
}

type ClosedModeProps = {
  id: string;
  /** The draft's threshold (contract v3 `gate_mode.closed_below_events`). */
  value: number;
  /** The live document's threshold. */
  live: number;
  /** Core's `gate_mode_catalogue.closed_below_events`: the bounds, the default and the fixed radius. */
  catalogue: VerificationClosedModeCatalogue;
  /**
   * Some scope is not Full block, so Core keeps the threshold. Otherwise Core
   * stores no gate mode at all and the control is disabled (spec §4).
   */
  applies: boolean;
  /** The saved draft or the live document stores a threshold other than the default (rollback recipe §10). */
  storesThreshold: boolean;
  disabled: boolean;
  onChange: (value: number) => void;
};

/**
 * D-152 (contract §6, §7): the one Closed mode threshold of the gate-mode
 * console. A member who explores gets Closed mode — only the profile open —
 * while their sign-up area holds fewer than N events within 100 mi. An
 * integer 0..50, 3 by default; 0 never closes. Presentation only: the table
 * owns the draft, and the value changes only through `onChange`.
 */
export function VerificationClosedModeControl({
  id,
  value,
  live,
  catalogue,
  applies,
  storesThreshold,
  disabled,
  onChange,
}: ClosedModeProps) {
  const t = useTranslations("verificationAdmin.methodPolicy.gateMode");
  const label = useClosedModeLabel();
  const options = Array.from(
    { length: catalogue.maximum - catalogue.minimum + 1 },
    (_, index) => catalogue.minimum + index,
  );
  const ids = {
    applies: `${id}-applies`,
    live: `${id}-live`,
  };
  // Lead ruling Q10 (a save that returns the value to 3) is shown once, in
  // the table's save preview next to the Save button, not here.
  const notes = [
    applies ? null : ids.applies,
    live !== value ? ids.live : null,
  ].filter(Boolean).join(" ") || undefined;
  const change = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const next = verificationClosedBelowEvents(Number(event.target.value));
    if (next !== null) onChange(next);
  };
  return (
    <div
      className="gate-mode-legend closed-mode-control"
      data-closed-mode-control="true"
      data-closed-mode-value={value}
      data-closed-mode-applies={applies ? "true" : "false"}
    >
      <strong>{t("closedMode.title")}</strong>
      <p className="closed-mode-line" data-closed-mode-what="true">{t("closedMode.what")}</p>
      <label className="field closed-mode-field" htmlFor={id}>
        <span>{t("closedMode.field", { radius: catalogue.radius_miles })}</span>
        <select
          id={id}
          className="input"
          value={String(value)}
          disabled={disabled || !applies}
          aria-describedby={notes}
          onChange={change}
        >
          {options.map((option) => (
            <option key={option} value={String(option)}>
              {option === catalogue.default ? t("closedMode.defaultOption", { option: label(option) }) : label(option)}
            </option>
          ))}
        </select>
      </label>
      {applies ? null : (
        <small id={ids.applies} className="field-hint" data-closed-mode-not-applicable="true">{t("closedMode.notApplicable")}</small>
      )}
      {live !== value ? (
        <small id={ids.live} className="field-hint" data-closed-mode-live={live}>{t("closedMode.live", { value: label(live) })}</small>
      ) : null}
      <p className="closed-mode-line" data-closed-mode-one-way="true">{t("closedMode.oneWay")}</p>
      <small className="field-hint">{t("closedMode.clients")}</small>
      <p className="gate-mode-rollback" data-closed-mode-rollback="true">
        <strong>{t("rollbackTitle")}</strong> {t("closedMode.rollback")}
      </p>
      {storesThreshold ? (
        <p className="gate-mode-rollback" data-closed-mode-stored="true">{t("closedMode.stored")}</p>
      ) : null}
    </div>
  );
}

/**
 * The impact preview's stored thresholds (contract §7.3): live and draft, the
 * draft in bold when it differs. The counts above it do not depend on it.
 */
export function VerificationClosedModeImpact({ live, draft }: { live: number; draft: number }) {
  const t = useTranslations("verificationAdmin.methodPolicy.gateMode.closedMode");
  const label = useClosedModeLabel();
  const changed = live !== draft;
  const draftText = t("impactDraft", { value: label(draft) });
  return (
    <div className="closed-mode-impact" data-closed-mode-impact="true" data-closed-mode-changed={changed ? "true" : undefined}>
      <strong>{t("impactTitle")}</strong>
      <span data-closed-mode-impact-live={live}>{t("impactLive", { value: label(live) })}</span>
      <span data-closed-mode-impact-draft={draft}>{changed ? <strong>{draftText}</strong> : draftText}</span>
      <small className="field-hint">{t("impactNote")}</small>
    </div>
  );
}
