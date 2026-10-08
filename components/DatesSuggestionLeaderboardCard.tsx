"use client";

// The default import keeps the component renderable where JSX compiles to React.createElement (the test runner).
import React, { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { adminCall } from "@/lib/adminClient";
import { authPolicyVocabularyResponse, localizedAuthPolicyStorefronts, type AuthPolicyVocabulary } from "@/lib/authPolicyConfiguration";
import { createAdminIdempotencyKey } from "@/lib/datesAdmin";
import {
  LEADERBOARD_EDITOR_INITIAL, LEADERBOARD_REASON_MAX, LEADERBOARD_REASON_MIN, LEADERBOARD_SCOPES, leaderboardEditorReducer, leaderboardHalfRows, leaderboardHold,
  leaderboardSaveBlock, leaderboardSaveQueue, leaderboardVerdict,
  type LeaderboardDraft, type LeaderboardEditorState, type LeaderboardRead, type LeaderboardRow, type LeaderboardScope,
} from "@/lib/datesSuggestionLeaderboard";

/** Core's storefront vocabulary (the countries a row may name): being read, not readable, or here. */
type Vocabulary = { status: "loading" } | { status: "error" } | { status: "ready"; vocabulary: AuthPolicyVocabulary };

/**
 * The submission leaderboard: where it is on and whose board a member sees.
 * One default row and one row per country; a country row carries both answers.
 * The four settings behind it are rows of the Dates configuration, read by the
 * page and saved here one command per changed row
 * (lib/datesSuggestionLeaderboard.ts holds the rules).
 */
export default function DatesSuggestionLeaderboardCard({ read, canManage, suggestionsOn, onReload, onHoldChange, initialState = LEADERBOARD_EDITOR_INITIAL, initialVocabulary }: {
  /** The four settings of the page's last successful configuration read. */
  read: LeaderboardRead;
  canManage: boolean;
  /** Whether member suggestions are on anywhere; the leaderboard shows only where they are. `null`: not known. */
  suggestionsOn: boolean | null;
  /** Reads the configuration again; the answer arrives as a new `read`. */
  onReload: () => void;
  /** Told whenever the card starts or stops holding unsaved edits or a save in doubt, so that the page does not unmount it. */
  onHoldChange?: (hold: boolean) => void;
  /** Only a server render (a test, a preview) gives these; the page starts empty and reads. */
  initialState?: LeaderboardEditorState;
  initialVocabulary?: AuthPolicyVocabulary;
}) {
  const t = useTranslations("datesAdmin.suggestionLeaderboard"), outcomes = useTranslations("datesAdmin.eventIcons"), common = useTranslations("common"), locale = useLocale();
  const [state, dispatch] = useReducer(leaderboardEditorReducer, initialState);
  const [vocabulary, setVocabulary] = useState<Vocabulary>(initialVocabulary ? { status: "ready", vocabulary: initialVocabulary } : { status: "loading" });
  const [saving, setSaving] = useState(false);
  // The operator asked for what is stored: the next read replaces the edits and a command in doubt.
  const forceNext = useRef(false);
  // One save at a time, also between two clicks that the same render answered.
  const saveInFlight = useRef(false);
  const id = useId();

  // The countries come from the shared settings read, as on Configuration -> Travel and AreYouIn.
  const loadVocabulary = useCallback(async () => {
    setVocabulary({ status: "loading" });
    let next: AuthPolicyVocabulary | null = null;
    try { next = authPolicyVocabularyResponse(await adminCall("get_settings")); } catch { next = null; }
    setVocabulary(next ? { status: "ready", vocabulary: next } : { status: "error" });
  }, []);
  useEffect(() => { if (!initialVocabulary) void loadVocabulary(); }, [initialVocabulary, loadVocabulary]);

  const authority = read.status === "ready" ? read.authority : null;
  useEffect(() => {
    if (authority === null) return;
    dispatch({ type: "authority", authority, force: forceNext.current });
    forceNext.current = false;
  }, [authority]);

  const hold = leaderboardHold(state);
  useEffect(() => { onHoldChange?.(hold); }, [hold, onHoldChange]);

  const storefronts = useMemo(() => vocabulary.status === "ready" ? localizedAuthPolicyStorefronts(vocabulary.vocabulary, locale) : [], [locale, vocabulary]);
  const known = useMemo(() => vocabulary.status === "ready" ? new Set(storefronts.map(storefront => storefront.alpha3)) : null, [storefronts, vocabulary.status]);
  const block = leaderboardSaveBlock(state, canManage, known);
  const pending = state.queue.length > 0 && !state.busy;
  const locked = !canManage || state.busy || state.queue.length > 0;
  // Without the vocabulary a country cannot be checked: the rows stay as they are stored.
  const rowsLocked = locked || known === null;

  function change(draft: LeaderboardDraft) {
    // An edit after a reload that did not answer: the next read is no longer one the operator asked to replace it with.
    forceNext.current = false;
    dispatch({ type: "edited", draft });
  }
  function reload() {
    if (state.queue.length > 0 ? !window.confirm(t("discardPending")) : hold && !window.confirm(t("discard"))) return;
    forceNext.current = true;
    onReload();
  }
  async function save() {
    if (saveInFlight.current) return;
    const queue = leaderboardSaveQueue(state, canManage, known, () => createAdminIdempotencyKey("leaderboard"));
    if (queue.length === 0) return;
    saveInFlight.current = true;
    forceNext.current = false;
    // A retained queue was sent before: its first command is a repeat, every later one a first attempt.
    let retrying = state.queue.length > 0, verdict = "success";
    setSaving(true);
    dispatch({ type: "saveStarted", queue });
    for (const command of queue) {
      // A call that fails without an answer is an answer that did not arrive: the outcome is unknown.
      let response: unknown = null;
      try { response = await adminCall("dates_configuration_save", command); } catch { response = null; }
      dispatch({ type: "commandAnswered", response });
      verdict = leaderboardVerdict(response, command, retrying).kind;
      if (verdict !== "success") break;
      retrying = false;
    }
    setSaving(false);
    saveInFlight.current = false;
    // An answered save is followed by a read of the page's configuration: the stored revisions after a save, the
    // current values after a refusal (the edits stay). An outcome in doubt is settled by its own command, not by a read.
    if (verdict !== "uncertain") onReload();
  }

  const body = state.draft !== null && state.authority !== null ? renderBody(state, state.draft) : null;

  function renderBody(loaded: LeaderboardEditorState, draft: LeaderboardDraft) {
    const field = (name: string) => `${id}-${name}`;
    const used = new Set(draft.rows.map(row => row.storefront).filter(Boolean));
    const unknown = known === null ? [] : [...used].filter(code => !known.has(code)).sort();
    const half = loaded.authority ? leaderboardHalfRows(loaded.authority.values) : [];
    const patchRow = (index: number, patch: Partial<LeaderboardRow>) => change({ ...draft, rows: draft.rows.map((row, at) => at === index ? { ...row, ...patch } : row) });
    const scopeOptions = LEADERBOARD_SCOPES.map(scope => <option key={scope} value={scope}>{t(`scopes.${scope}`)}</option>);
    const outcome = loaded.outcome;
    const settingName = (key: string) => t(`settings.${key}`);
    const savedBefore = (keys: readonly string[]) => keys.length > 0 ? ` ${t("savedBefore", { settings: keys.map(settingName).join(", ") })}` : "";
    const blockText = block === null ? null : block === "reason" ? t("blockReason", { min: LEADERBOARD_REASON_MIN }) : t(`block.${block}`);

    return (
      <div className="dates-leaderboard-body">
        {suggestionsOn === false && <p className="alert alert-info" role="status">{t("suggestionsOff")}</p>}
        {(loaded.authority?.invalid.length ?? 0) > 0 && <p className="alert alert-warning" role="status">{t("invalidStored", { settings: loaded.authority!.invalid.map(settingName).join(", ") })}</p>}
        {half.length > 0 && <p className="alert alert-warning" role="status">{t("halfRows", { codes: half.join(", ") })}</p>}
        {loaded.rebased && <p className="alert alert-warning" role="status">{t("rebased")}</p>}
        {unknown.length > 0 && <p className="alert alert-error" role="alert">{t("vocabularyWarning", { codes: unknown.join(", ") })}</p>}
        {vocabulary.status === "loading" && draft.rows.length > 0 && <p className="page-subtitle" role="status">{t("countriesLoading")}</p>}
        {vocabulary.status === "error" && (
          <p className="alert alert-error" role="alert">{t("countriesError")} <button type="button" className="dates-event-link" onClick={() => void loadVocabulary()}>{common("retry")}</button></p>
        )}

        <fieldset className="dates-leaderboard-fields" disabled={locked}>
          <div className="dates-leaderboard-row default">
            <div className="dates-leaderboard-name">
              <strong id={field("default")}>{t("defaultTitle")}</strong>
              <small>{t("defaultCopy")}</small>
            </div>
            <label className="dates-leaderboard-switch">
              <span className="switch">
                <input type="checkbox" checked={draft.enabled} aria-labelledby={field("default")} onChange={event => change({ ...draft, enabled: event.target.checked })} />
                <span className="switch-track" />
              </span>
              <span>{t(draft.enabled ? "on" : "off")}</span>
            </label>
            <label className="dates-leaderboard-select">
              <span>{t("scope")}</span>
              <select value={draft.scope} onChange={event => change({ ...draft, scope: event.target.value as LeaderboardScope })}>{scopeOptions}</select>
            </label>
          </div>

          <div className="dates-leaderboard-heading">
            <div><h3>{t("countriesTitle")}</h3><p>{t("countriesCopy")}</p></div>
            <button type="button" className="button button-secondary button-small"
              disabled={rowsLocked || draft.rows.some(row => !row.storefront) || storefronts.every(storefront => used.has(storefront.alpha3))}
              onClick={() => change({ ...draft, rows: [...draft.rows, { storefront: "", enabled: !draft.enabled, scope: draft.scope }] })}>
              {t("addCountry")}
            </button>
          </div>
          {draft.rows.length === 0 ? <p className="auth-policy-empty">{t("emptyCountries")}</p> : (
            <div className="dates-leaderboard-rows">
              {draft.rows.map((row, index) => {
                const isKnown = !row.storefront || known === null || known.has(row.storefront);
                const name = storefronts.find(storefront => storefront.alpha3 === row.storefront)?.name;
                return (
                  <div className="dates-leaderboard-row" key={`${row.storefront}-${index}`}>
                    <label className="dates-leaderboard-select country">
                      <span>{t("country")}</span>
                      <select value={row.storefront} disabled={rowsLocked} aria-invalid={!row.storefront || !isKnown}
                        aria-describedby={isKnown ? undefined : field(`unknown-${index}`)} onChange={event => patchRow(index, { storefront: event.target.value })}>
                        <option value="">{t("selectCountry")}</option>
                        {/* A stored country stays what it is while the list of countries is not here, or does not have it. */}
                        {row.storefront && name === undefined && <option value={row.storefront}>{isKnown ? row.storefront : t("unknownCountry", { code: row.storefront })}</option>}
                        {storefronts.map(storefront => (
                          <option key={storefront.alpha3} value={storefront.alpha3} disabled={storefront.alpha3 !== row.storefront && used.has(storefront.alpha3)}>
                            {storefront.name} · {storefront.alpha3}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="dates-leaderboard-switch">
                      <span className="switch">
                        <input type="checkbox" checked={row.enabled} disabled={rowsLocked} aria-label={t("rowSwitch", { country: name ?? (row.storefront || t("selectCountry")) })}
                          onChange={event => patchRow(index, { enabled: event.target.checked })} />
                        <span className="switch-track" />
                      </span>
                      <span>{t(row.enabled ? "on" : "off")}</span>
                    </label>
                    <label className="dates-leaderboard-select">
                      <span>{t("scope")}</span>
                      <select value={row.scope} disabled={rowsLocked} onChange={event => patchRow(index, { scope: event.target.value as LeaderboardScope })}>{scopeOptions}</select>
                    </label>
                    <button type="button" className="button button-ghost button-danger button-small" disabled={rowsLocked}
                      onClick={() => change({ ...draft, rows: draft.rows.filter((_, at) => at !== index) })}>{t("removeCountry")}</button>
                    {!isKnown && <small id={field(`unknown-${index}`)} className="field-error" role="alert">{t("unknownCountry", { code: row.storefront })}</small>}
                  </div>
                );
              })}
            </div>
          )}
        </fieldset>

        <div className="dates-leaderboard-help">
          {LEADERBOARD_SCOPES.map(scope => <p key={scope}><strong>{t(`scopes.${scope}`)}:</strong> {t(`scopeHelp.${scope}`)}</p>)}
        </div>

        <div className="dates-event-icon-save">
          <label htmlFor={field("reason")}>
            {outcomes("reason")} <span className="dates-event-required" aria-hidden="true">*</span><span className="sr-only"> ({outcomes("required")})</span>
          </label>
          <input id={field("reason")} value={loaded.reason} maxLength={LEADERBOARD_REASON_MAX} required aria-required="true" aria-describedby={field("reason-hint")}
            disabled={locked} onChange={event => dispatch({ type: "reason", value: event.target.value })} />
          <small id={field("reason-hint")} className="dates-event-icon-hint">{outcomes("reasonHint", { min: LEADERBOARD_REASON_MIN })}</small>

          {outcome?.kind === "saved" && <p className="alert alert-success" role="status">{t("saved")}</p>}
          {outcome?.kind === "refused" && (
            <p className="alert alert-error" role="alert">
              {outcome.error === "dates-admin-stale-revision" ? t("refusedStale", { setting: settingName(outcome.key) }) : t("refused", { setting: settingName(outcome.key), error: outcome.error })}
              {savedBefore(outcome.saved)}
            </p>
          )}
          {outcome?.kind === "unknown" && <p className="alert alert-error" role="alert">{t("unknown", { setting: settingName(outcome.key) })}{savedBefore(outcome.saved)}</p>}

          {blockText !== null && !loaded.busy && <p id={field("block")} className="dates-event-save-block">{blockText}</p>}
          <div className="dates-event-icon-save-actions">
            {pending && <button type="button" className="button button-secondary" onClick={reload}>{outcomes("reloadFromServer")}</button>}
            <button type="button" className="button button-primary" disabled={loaded.busy || block !== null}
              aria-describedby={blockText !== null && !loaded.busy ? field("block") : undefined} onClick={() => void save()}>
              {saving ? common("saving") : pending ? outcomes("retry") : common("save")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="panel dates-section dates-leaderboard">
      <div className="panel-header">
        <div><h2>{t("title")}</h2><p>{t("copy")}</p></div>
        <button type="button" className="button button-secondary" disabled={state.busy} onClick={reload}>{common("refresh")}</button>
      </div>
      {body === null && read.status === "absent" && <p className="alert alert-info dates-event-icons-notice" role="status">{t("absent")}</p>}
      {body === null && read.status === "unreadable" && <p className="alert alert-error dates-event-icons-notice" role="alert">{t("unreadable")}</p>}
      {body !== null && read.status !== "ready" && <p className="alert alert-error dates-event-icons-notice" role="alert">{t("unreadable")}</p>}
      {body}
    </section>
  );
}
