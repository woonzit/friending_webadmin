"use client";

// T-218: the dormant consumer for the T-123 Footprints visits switch.
//
// The switch governs the VISITS half of Footprints only — visit recording, the
// visitors feed and the iOS Visits tab. Badges, the photo-likes collector and
// the chat gate on this same page are unaffected, which is the distinction the
// panel copy has to make unmissable before anyone flips it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { adminCall, type AdminResponse } from "@/lib/adminClient";
import {
  FOOTPRINT_VISITS_PENDING_STORAGE_KEY,
  FOOTPRINT_VISITS_REASON_MAX,
  FOOTPRINT_VISITS_TARGET,
  footprintVisitsAdminMe,
  footprintVisitsConflictResponse,
  footprintVisitsConflictSatisfiesPending,
  footprintVisitsError,
  footprintVisitsErrorKey,
  footprintVisitsMutationConverged,
  footprintVisitsMutationResponse,
  footprintVisitsPendingFrom,
  footprintVisitsPendingMutation,
  footprintVisitsPersistBeforeMutation,
  footprintVisitsReasonIsValid,
  footprintVisitsShouldRetainMutation,
  footprintVisitsStateResponse,
  type FootprintVisitsAction,
  type FootprintVisitsErrorKey,
  type FootprintVisitsPendingMutation,
  type FootprintVisitsState,
} from "@/lib/footprintVisits";

type Notice = { tone: "info" | "error" | "success"; text: string } | null;

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

export default function FootprintsVisitsPanel() {
  const t = useTranslations("footprintVisits");
  const common = useTranslations("common");
  const locale = useLocale();

  const [state, setState] = useState<"loading" | "ready" | "error" | "forbidden">("loading");
  const [loadFailure, setLoadFailure] = useState<FootprintVisitsErrorKey | null>(null);
  const [current, setCurrent] = useState<FootprintVisitsState | null>(null);
  const [actions, setActions] = useState<FootprintVisitsAction[]>([]);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, setPending] = useState<FootprintVisitsPendingMutation | null>(null);
  const pendingRef = useRef<FootprintVisitsPendingMutation | null>(null);
  const [busy, setBusy] = useState(false);
  const loadSequenceRef = useRef(0);

  const canEdit = actions.includes("footprints_visits_set");
  const validReason = useMemo(() => footprintVisitsReasonIsValid(reason), [reason]);
  const reasonLength = useMemo(() => [...reason].length, [reason]);

  const load = useCallback(async () => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    setLoadFailure(null);
    const [meResponse, stateResponse] = await Promise.all([
      adminCall("admin_me", {}),
      adminCall("footprints_visits_get", { contract_version: 1 }),
    ]);
    if (sequence !== loadSequenceRef.current) return;
    const adminMe = footprintVisitsAdminMe(meResponse?.footprints_visits);
    if (!adminMe?.contract_ready || !adminMe.actions.includes("footprints_visits_get")) {
      setActions(adminMe?.actions ?? []);
      setState(adminMe ? "forbidden" : "error");
      return;
    }
    const parsed = footprintVisitsStateResponse(stateResponse);
    if (sequence !== loadSequenceRef.current) return;
    if (!parsed) {
      const error = footprintVisitsError(stateResponse);
      setLoadFailure(error ? footprintVisitsErrorKey(error) : null);
      // A read that could not be decoded is an error, never a rendered "off".
      setCurrent(null);
      setState("error");
      return;
    }
    setActions(adminMe.actions);
    setCurrent(parsed);
    setState("ready");
  }, []);

  useEffect(() => {
    try {
      const serialized = window.sessionStorage.getItem(FOOTPRINT_VISITS_PENDING_STORAGE_KEY);
      if (serialized) {
        const restored = footprintVisitsPendingFrom(JSON.parse(serialized));
        if (restored) {
          pendingRef.current = restored;
          setPending(restored);
        } else {
          window.sessionStorage.removeItem(FOOTPRINT_VISITS_PENDING_STORAGE_KEY);
        }
      }
    } catch {
      setNotice({ tone: "error", text: t("live.persistenceUnavailable") });
    }
    void load();
  }, [load, t]);

  function clearPending(): boolean {
    try {
      window.sessionStorage.removeItem(FOOTPRINT_VISITS_PENDING_STORAGE_KEY);
    } catch {
      return false;
    }
    pendingRef.current = null;
    setPending(null);
    return true;
  }

  async function submit(nextEnabled: boolean) {
    if (busy || !current) return;
    const existing = pendingRef.current;
    let command: FootprintVisitsPendingMutation | null = existing;
    if (!command) {
      if (!validReason) return;
      const requestId = newRequestId();
      if (!requestId) {
        setNotice({ tone: "error", text: t("live.requestIdUnavailable") });
        return;
      }
      command = footprintVisitsPendingMutation(FOOTPRINT_VISITS_TARGET, {
        contract_version: 1,
        // The closed vocabulary is the exact strings, not a JSON boolean.
        visits_enabled: nextEnabled ? "true" : "false",
        expected_revision: current.revision,
        reason,
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
      // Reload/retry reuses the same UUID, revision, value and reason. It never
      // mints a second logical command.
      response = await adminCall(existing.action, existing.payload);
    } else {
      const persisted = await footprintVisitsPersistBeforeMutation(
        window.sessionStorage,
        command,
        () => adminCall(command!.action, command!.payload),
      );
      if (!persisted.ok) {
        setBusy(false);
        setNotice({ tone: "error", text: t("live.persistenceUnavailable") });
        return;
      }
      pendingRef.current = command;
      setPending(command);
      response = persisted.response;
    }

    const result = footprintVisitsMutationResponse(response);
    if (result && footprintVisitsMutationConverged(command, result)) {
      setReason("");
      const cleared = clearPending();
      setNotice({
        tone: cleared ? "success" : "error",
        text: cleared
          ? t(result.replayed ? "live.replayed" : result.no_change ? "live.noChange" : "live.saved")
          : t("live.persistenceCleanupFailed"),
      });
      if (cleared) await load();
      setBusy(false);
      return;
    }

    const conflict = footprintVisitsConflictResponse(response);
    if (conflict) {
      // Adopt the authoritative state. If it already holds what the operator
      // asked for, someone else got there first and the intent is satisfied;
      // otherwise they must decide again against what they can now see.
      const satisfied = footprintVisitsConflictSatisfiesPending(command, conflict);
      setCurrent(conflict.current);
      setReason("");
      const cleared = clearPending();
      setNotice({
        tone: cleared ? (satisfied ? "info" : "error") : "error",
        text: cleared
          ? t(satisfied ? "live.conflictAlreadyApplied" : "live.conflict")
          : t("live.persistenceCleanupFailed"),
      });
      if (cleared) await load();
      setBusy(false);
      return;
    }

    const error = footprintVisitsError(response);
    if (!footprintVisitsShouldRetainMutation(error)) {
      setReason("");
      if (!clearPending()) {
        setNotice({ tone: "error", text: t("live.persistenceCleanupFailed") });
        setBusy(false);
        return;
      }
    }
    setNotice({
      tone: "error",
      text: error
        ? t("live.errorCode", { message: t(`errors.${footprintVisitsErrorKey(error)}`) })
        : t("live.unknownError"),
    });
    setBusy(false);
  }

  if (state === "loading") {
    return (
      <section className="panel">
        <h2>{t("title")}</h2>
        <p className="panel-lead">{common("loading")}</p>
      </section>
    );
  }

  if (state === "forbidden") {
    return (
      <section className="panel">
        <h2>{t("title")}</h2>
        <p className="panel-lead">{t("unavailable")}</p>
      </section>
    );
  }

  if (state === "error" || !current) {
    return (
      <section className="panel">
        <h2>{t("title")}</h2>
        <p className="panel-lead footprint-visits-error" role="alert">
          {loadFailure ? t(`errors.${loadFailure}`) : t("live.unknownError")}
        </p>
        <button type="button" className="button button-secondary" onClick={() => void load()}>
          {common("retry")}
        </button>
      </section>
    );
  }

  const target = !current.visits_enabled;
  const provenance = current.updated_at === 0
    ? t("neverSet")
    : t("lastChanged", {
      actor: current.updated_by,
      when: formatTimestamp(locale, current.updated_at, String(current.updated_at)),
    });

  return (
    <section className="panel">
      <h2>{t("title")}</h2>
      <p className="panel-lead">{t("lead")}</p>
      <p className="panel-lead footprint-visits-scope">{t("scopeNote")}</p>

      {notice ? (
        <p className={`footprint-visits-notice footprint-visits-notice-${notice.tone}`} role="status">
          {notice.text}
        </p>
      ) : null}

      <dl className="footprint-visits-state">
        <div>
          <dt>{t("currentState")}</dt>
          <dd>
            <b className={current.visits_enabled ? "status-badge status-accepted" : "status-badge status-denied"}>
              {current.visits_enabled ? t("stateOn") : t("stateOff")}
            </b>
          </dd>
        </div>
        <div>
          <dt>{t("revision")}</dt>
          <dd>{current.revision}</dd>
        </div>
        <div>
          <dt>{t("provenance")}</dt>
          <dd>{provenance}</dd>
        </div>
      </dl>

      <p className="footprint-visits-consequence">
        {current.visits_enabled ? t("consequenceOff") : t("consequenceOn")}
      </p>

      {pending ? (
        <p className="footprint-visits-notice footprint-visits-notice-info" role="status">
          {t("live.pendingRetry")}
        </p>
      ) : null}

      {canEdit ? (
        <div className="footprint-visits-form">
          <label className="field">
            <span>{t("reason")}</span>
            <input
              type="text"
              value={reason}
              maxLength={FOOTPRINT_VISITS_REASON_MAX}
              disabled={busy || pending !== null}
              onChange={(event) => setReason(event.target.value)}
            />
            <small>{t("reasonHint", { count: reasonLength, max: FOOTPRINT_VISITS_REASON_MAX })}</small>
          </label>
          <button
            type="button"
            className={target ? "button button-primary" : "button button-danger"}
            disabled={busy || (pending === null && !validReason)}
            onClick={() => void submit(pending ? pending.payload.visits_enabled === "true" : target)}
          >
            {busy
              ? common("saving")
              : pending
                ? t("retry")
                : target ? t("enable") : t("disable")}
          </button>
        </div>
      ) : (
        <p className="panel-lead">{t("readOnly")}</p>
      )}
    </section>
  );
}
