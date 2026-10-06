"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { adminCall, type AdminResponse } from "@/lib/adminClient";
import {
  FEATURE_SWITCHES,
  FEATURE_SWITCHES_PENDING_STORAGE_KEY,
  FEATURE_SWITCHES_REASON_MAX,
  featureSwitchesAdminMe,
  featureSwitchesConflictResponse,
  featureSwitchesConflictSatisfiesPending,
  featureSwitchesError,
  featureSwitchesErrorKey,
  featureSwitchesMutationConverged,
  featureSwitchesMutationResponse,
  featureSwitchesPendingFrom,
  featureSwitchesPendingMutation,
  featureSwitchesPersistBeforeMutation,
  featureSwitchesProvenance,
  featureSwitchesReasonIsValid,
  featureSwitchesShouldRetainMutation,
  featureSwitchesStateConverged,
  featureSwitchesStateResponse,
  featureSwitchesTarget,
  featureSwitchesValue,
  type FeatureSwitch,
  type FeatureSwitchesAction,
  type FeatureSwitchesErrorKey,
  type FeatureSwitchesPendingMutation,
  type FeatureSwitchesState,
} from "@/lib/featureSwitches";

type Notice = { tone: "info" | "error" | "success"; text: string } | null;

type FeatureSwitchesCardGridProps = {
  current: FeatureSwitchesState;
  canEdit: boolean;
  reasons: Record<FeatureSwitch, string>;
  pending: FeatureSwitchesPendingMutation | null;
  busy: boolean;
  onReasonChange: (selectedSwitch: FeatureSwitch, value: string) => void;
  onSubmit: (selectedSwitch: FeatureSwitch, nextEnabled: boolean) => void;
};

function formatTimestamp(locale: string, seconds: number, fallback: string): string {
  const milliseconds = seconds * 1000;
  if (!Number.isFinite(milliseconds) || milliseconds > 8_640_000_000_000_000) return fallback;
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) return fallback;
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
  } catch {
    return fallback;
  }
}

function newRequestId(): string | null {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return null;
  }
}

/** Renderable separately so served and pre-T-659 Core states stay covered without network effects. */
export function FeatureSwitchesCardGrid({
  current,
  canEdit,
  reasons,
  pending,
  busy,
  onReasonChange,
  onSubmit,
}: FeatureSwitchesCardGridProps) {
  const t = useTranslations("featureSwitches");
  const common = useTranslations("common");
  const locale = useLocale();
  const reasonValidity: Record<FeatureSwitch, boolean> = {
    hey: featureSwitchesReasonIsValid(reasons.hey),
    footprints: featureSwitchesReasonIsValid(reasons.footprints),
    likes: featureSwitchesReasonIsValid(reasons.likes),
  };
  const reasonLengths: Record<FeatureSwitch, number> = {
    hey: [...reasons.hey].length,
    footprints: [...reasons.footprints].length,
    likes: [...reasons.likes].length,
  };

  return (
    <div className="feature-switches-grid">
      {FEATURE_SWITCHES.map((selectedSwitch) => {
        const enabled = featureSwitchesValue(current, selectedSwitch);
        const provenance = featureSwitchesProvenance(current, selectedSwitch);
        const pendingForSwitch = pending?.payload.switch === selectedSwitch;
        const target = enabled === null ? false : !enabled;
        return (
          <article
            className="feature-switch-card"
            data-feature-switch={selectedSwitch}
            data-served={enabled === null ? "false" : "true"}
            key={selectedSwitch}
          >
            <div className="feature-switch-heading">
              <div>
                <h3>{t(`switches.${selectedSwitch}.title`)}</h3>
                <p>{t(`switches.${selectedSwitch}.summary`)}</p>
              </div>
              <b className={enabled === null
                ? "status-badge status-pending"
                : enabled ? "status-badge status-accepted" : "status-badge status-denied"}>
                {enabled === null ? t("notServed") : t(enabled ? "stateOn" : "stateOff")}
              </b>
            </div>

            <dl className="feature-switch-provenance">
              <div>
                <dt>{t("lastChange")}</dt>
                <dd>{provenance === null
                  ? t("notServedDetail")
                  : provenance.updated_at === 0
                    ? t("neverSet")
                    : t("lastChanged", {
                      actor: provenance.updated_by,
                      when: formatTimestamp(locale, provenance.updated_at, String(provenance.updated_at)),
                    })}</dd>
              </div>
            </dl>

            <p className="feature-switch-consequence">
              {enabled === null
                ? t("notServedDescription")
                : t(`switches.${selectedSwitch}.${enabled ? "consequenceOff" : "consequenceOn"}`)}
            </p>

            {canEdit ? (
              <div className="feature-switch-form">
                <label className="field">
                  <span>{t("reason")}</span>
                  <input
                    type="text"
                    value={reasons[selectedSwitch]}
                    aria-invalid={reasons[selectedSwitch] !== "" && !reasonValidity[selectedSwitch]}
                    disabled={enabled === null || busy || pending !== null}
                    onChange={(event) => onReasonChange(selectedSwitch, event.target.value)}
                  />
                  <small>{t("reasonHint", {
                    count: reasonLengths[selectedSwitch],
                    max: FEATURE_SWITCHES_REASON_MAX,
                  })}</small>
                </label>
                <button
                  type="button"
                  className={enabled === null
                    ? "button button-secondary"
                    : target ? "button button-primary" : "button button-danger"}
                  disabled={enabled === null || busy || (pending
                    ? !pendingForSwitch
                    : !reasonValidity[selectedSwitch])}
                  onClick={() => onSubmit(
                    selectedSwitch,
                    pendingForSwitch ? pending.payload.enabled === "true" : target,
                  )}
                >
                  {enabled === null
                    ? t("notServed")
                    : busy && pendingForSwitch
                      ? common("saving")
                      : pendingForSwitch
                        ? t("retry")
                        : t(`switches.${selectedSwitch}.${target ? "enable" : "disable"}`)}
                </button>
              </div>
            ) : (
              <p className="panel-lead">{t("readOnly")}</p>
            )}
          </article>
        );
      })}
    </div>
  );
}

export default function FeatureSwitchesPanel() {
  const t = useTranslations("featureSwitches");
  const common = useTranslations("common");

  const [state, setState] = useState<"loading" | "ready" | "error" | "forbidden">("loading");
  const [loadFailure, setLoadFailure] = useState<FeatureSwitchesErrorKey | null>(null);
  const [current, setCurrent] = useState<FeatureSwitchesState | null>(null);
  const [actions, setActions] = useState<FeatureSwitchesAction[]>([]);
  const [reasons, setReasons] = useState<Record<FeatureSwitch, string>>({
    hey: "",
    footprints: "",
    likes: "",
  });
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, setPending] = useState<FeatureSwitchesPendingMutation | null>(null);
  const pendingRef = useRef<FeatureSwitchesPendingMutation | null>(null);
  const [busy, setBusy] = useState(false);
  const loadSequenceRef = useRef(0);

  const canEdit = actions.includes("feature_switches_set");
  const reasonValidity = useMemo(() => ({
    hey: featureSwitchesReasonIsValid(reasons.hey),
    footprints: featureSwitchesReasonIsValid(reasons.footprints),
    likes: featureSwitchesReasonIsValid(reasons.likes),
  }), [reasons]);

  const clearPending = useCallback((): boolean => {
    try {
      window.sessionStorage.removeItem(FEATURE_SWITCHES_PENDING_STORAGE_KEY);
    } catch {
      return false;
    }
    pendingRef.current = null;
    setPending(null);
    return true;
  }, []);

  const load = useCallback(async () => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    setLoadFailure(null);
    const [meResponse, stateResponse] = await Promise.all([
      adminCall("admin_me", {}),
      adminCall("feature_switches_get", { contract_version: 1 }),
    ]);
    if (sequence !== loadSequenceRef.current) return;
    const adminMe = featureSwitchesAdminMe(meResponse?.feature_switches);
    if (!adminMe?.contract_ready || !adminMe.actions.includes("feature_switches_get")) {
      setActions(adminMe?.actions ?? []);
      setCurrent(null);
      setState(adminMe ? "forbidden" : "error");
      return;
    }
    const parsed = featureSwitchesStateResponse(stateResponse);
    if (sequence !== loadSequenceRef.current) return;
    if (!parsed) {
      const error = featureSwitchesError(stateResponse);
      setLoadFailure(error ? featureSwitchesErrorKey(error) : null);
      // A malformed read is an error, never two proven "off" switches.
      setCurrent(null);
      setState("error");
      return;
    }
    setActions(adminMe.actions);
    setCurrent(parsed);
    const candidate = pendingRef.current;
    if (candidate && featureSwitchesStateConverged(candidate, parsed)) {
      const selectedSwitch = candidate.payload.switch;
      const cleared = clearPending();
      if (cleared) {
        setReasons((value) => ({ ...value, [selectedSwitch]: "" }));
      }
      setNotice({
        tone: cleared ? "success" : "error",
        text: cleared ? t("live.converged") : t("live.persistenceCleanupFailed"),
      });
    }
    setState("ready");
  }, [clearPending, t]);

  useEffect(() => {
    try {
      const serialized = window.sessionStorage.getItem(FEATURE_SWITCHES_PENDING_STORAGE_KEY);
      if (serialized) {
        const restored = featureSwitchesPendingFrom(JSON.parse(serialized));
        if (restored) {
          pendingRef.current = restored;
          setPending(restored);
        } else {
          window.sessionStorage.removeItem(FEATURE_SWITCHES_PENDING_STORAGE_KEY);
        }
      }
    } catch {
      setNotice({ tone: "error", text: t("live.persistenceUnavailable") });
    }
    void load();
  }, [load, t]);

  async function submit(selectedSwitch: FeatureSwitch, nextEnabled: boolean) {
    if (busy || !current || featureSwitchesValue(current, selectedSwitch) === null) return;
    const existing = pendingRef.current;
    let command: FeatureSwitchesPendingMutation | null = existing;
    if (!command) {
      if (!reasonValidity[selectedSwitch]) return;
      const requestId = newRequestId();
      if (!requestId) {
        setNotice({ tone: "error", text: t("live.requestIdUnavailable") });
        return;
      }
      command = featureSwitchesPendingMutation(featureSwitchesTarget(selectedSwitch), {
        contract_version: 1,
        switch: selectedSwitch,
        // Core accepts this exact string vocabulary, not a JSON boolean.
        enabled: nextEnabled ? "true" : "false",
        expected_revision: current.revision,
        reason: reasons[selectedSwitch],
        request_id: requestId,
      });
      if (!command) {
        setNotice({ tone: "error", text: t("live.draftInvalid") });
        return;
      }
    }

    setBusy(true);
    setNotice(null);
    let response: AdminResponse | null;
    if (existing) {
      response = await adminCall(existing.action, existing.payload);
    } else {
      const persisted = await featureSwitchesPersistBeforeMutation(
        window.sessionStorage,
        command,
        () => {
          pendingRef.current = command;
          setPending(command);
          return adminCall(command!.action, command!.payload);
        },
      );
      if (!persisted.ok) {
        setBusy(false);
        setNotice({ tone: "error", text: t("live.persistenceUnavailable") });
        return;
      }
      response = persisted.response;
    }

    const result = featureSwitchesMutationResponse(response);
    if (result && featureSwitchesMutationConverged(command, result)) {
      const commandSwitch = command.payload.switch;
      const cleared = clearPending();
      if (cleared) {
        setReasons((value) => ({ ...value, [commandSwitch]: "" }));
        // A completed replay contains historical canonical bytes. A fresh GET
        // is the authority after every success and cannot regress later state.
        await load();
      }
      setNotice({
        tone: cleared ? "success" : "error",
        text: cleared
          ? t(result.replayed ? "live.replayed" : result.no_change ? "live.noChange" : "live.saved")
          : t("live.persistenceCleanupFailed"),
      });
      setBusy(false);
      return;
    }

    const conflict = featureSwitchesConflictResponse(response);
    if (conflict) {
      const commandSwitch = command.payload.switch;
      const satisfied = featureSwitchesConflictSatisfiesPending(command, conflict);
      setCurrent(conflict.current);
      const cleared = clearPending();
      if (cleared) setReasons((value) => ({ ...value, [commandSwitch]: "" }));
      setNotice({
        tone: cleared ? (satisfied ? "info" : "error") : "error",
        text: cleared
          ? t(satisfied ? "live.conflictAlreadyApplied" : "live.conflict")
          : t("live.persistenceCleanupFailed"),
      });
      setBusy(false);
      return;
    }

    // B1: a malformed conflict and any illegal data-bearing refusal decode as
    // unknown, so this branch retains the exact durable identity.
    const error = featureSwitchesError(response);
    if (!featureSwitchesShouldRetainMutation(error)) {
      const commandSwitch = command.payload.switch;
      if (!clearPending()) {
        setNotice({ tone: "error", text: t("live.persistenceCleanupFailed") });
        setBusy(false);
        return;
      }
      setReasons((value) => ({ ...value, [commandSwitch]: "" }));
    }
    setNotice({
      tone: "error",
      text: error
        ? t("live.errorCode", { message: t(`errors.${featureSwitchesErrorKey(error)}`) })
        : t("live.unknownError"),
    });
    setBusy(false);
  }

  if (state === "loading") {
    return (
      <section className="panel feature-switches-panel" id="feature-switches">
        <div className="panel-header"><div><h2>{t("title")}</h2><p>{common("loading")}</p></div></div>
      </section>
    );
  }

  if (state === "forbidden") {
    return (
      <section className="panel feature-switches-panel" id="feature-switches">
        <div className="panel-header"><div><h2>{t("title")}</h2><p>{t("unavailable")}</p></div></div>
      </section>
    );
  }

  if (state === "error" || !current) {
    return (
      <section className="panel feature-switches-panel" id="feature-switches">
        <div className="panel-header"><div><h2>{t("title")}</h2><p className="feature-switches-error" role="alert">{loadFailure ? t(`errors.${loadFailure}`) : t("live.unknownError")}</p></div></div>
        <div className="panel-body"><button type="button" className="button button-secondary" onClick={() => void load()}>{common("retry")}</button></div>
      </section>
    );
  }

  return (
    <section className="panel feature-switches-panel" id="feature-switches">
      <div className="panel-header">
        <div>
          <h2>{t("title")}</h2>
          <p>{t("lead")}</p>
        </div>
        <span className="badge">{t("revision", { revision: current.revision })}</span>
      </div>
      <div className="panel-body">
        <p className="feature-switches-family-note">{t("familyRevisionNote")}</p>
        <p className="feature-switches-launch-note">{t("launchPosture")}</p>

        {notice ? (
          <p className={`feature-switches-notice feature-switches-notice-${notice.tone}`} role="status">
            {notice.text}
          </p>
        ) : null}

        {pending ? (
          <p className="feature-switches-notice feature-switches-notice-info" role="status">
            {t("live.pendingRetry", { feature: t(`switches.${pending.payload.switch}.title`) })}
          </p>
        ) : null}

        <FeatureSwitchesCardGrid
          current={current}
          canEdit={canEdit}
          reasons={reasons}
          pending={pending}
          busy={busy}
          onReasonChange={(selectedSwitch, value) => {
            setReasons((currentReasons) => ({ ...currentReasons, [selectedSwitch]: value }));
          }}
          onSubmit={(selectedSwitch, nextEnabled) => void submit(selectedSwitch, nextEnabled)}
        />
      </div>
    </section>
  );
}
