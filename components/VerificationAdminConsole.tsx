"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import PageHeader from "@/components/PageHeader";
import {
  MAX_VERIFICATION_BADGE_BYTES,
  VERIFICATION_FEATURE_KEYS,
  VERIFICATION_GATE_VARIANTS,
  VERIFICATION_LEVELS,
  VERIFICATION_METHODS,
  VERIFICATION_METHOD_STATUSES,
  VERIFICATION_REQUIREMENTS,
  VERIFICATION_SCOPE_STATES,
  VERIFICATION_TAB_KEYS,
  verificationBadgeFileError,
  verificationBadgeFixtures,
  verificationDerivedLevel,
  verificationEffectiveMethods,
  verificationEffectiveRequirement,
  verificationGateCopyErrors,
  verificationIsoCountry,
  verificationMaxLevel,
  verificationScopeFixtures,
  verificationTextLength,
  verificationTierLanguageEnabled,
  type VerificationBadgeSlot,
  type VerificationFeatureKey,
  type VerificationGateCopyLocale,
  type VerificationGateCopyPair,
  type VerificationGateVariant,
  type VerificationLevel,
  type VerificationMethod,
  type VerificationMethodStatus,
  type VerificationRequirement,
  type VerificationScope,
  type VerificationScopeState,
  type VerificationTabKey,
} from "@/lib/verificationAdmin";

type Notice = { tone: "info" | "error" | "success"; text: string } | null;
type CopyLocale = "en" | "hu";
type VerificationPreviewLocaleCopy = {
  label: string;
  emptyTitle: string;
  emptyAction: string;
  emptyCancel: string;
  nonInteractive: string;
  steps: { video: string; persona: string };
  pending: { wait: string; longer: string };
  rejected: { reason: string; attempt: string; manualReview: string };
};
type VerificationPreviewCopyPair = Record<CopyLocale, VerificationPreviewLocaleCopy>;
type BadgeDraft = {
  slot: VerificationBadgeSlot;
  previewUrl: string | null;
  fileName: string | null;
  error: "empty" | "size" | "type" | null;
};

const COUNTRY_OPTIONS = ["HU", "AT", "DE", "PL", "RS", "US", "CA"] as const;
const CITY_OPTIONS = [
  { id: "fixture-budapest-place", country: "HU", cityKey: "budapest" },
  { id: "fixture-szeged-place", country: "HU", cityKey: "szeged" },
  { id: "fixture-miami-place", country: "US", cityKey: "miami" },
  { id: "fixture-toronto-place", country: "CA", cityKey: "toronto" },
] as const;

function cloneCopyPairs(pairs: readonly VerificationGateCopyPair[]): VerificationGateCopyPair[] {
  return pairs.map((pair) => ({ ...pair, en: { ...pair.en }, hu: { ...pair.hu } }));
}

function requirementRank(value: Exclude<VerificationRequirement, "inherit">): number {
  return value === "strong" ? 2 : value === "light" ? 1 : 0;
}

function levelRank(value: VerificationLevel): number {
  return value === "strong" ? 2 : value === "light" ? 1 : 0;
}

function copyPairVariant(pair: VerificationGateCopyPair): VerificationGateVariant {
  return pair.key.slice("default.".length) as VerificationGateVariant;
}

function formatPreviewCopy(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replace(`{${key}}`, String(value)),
    template,
  );
}

function useScopeLabel() {
  const t = useTranslations("verificationAdmin");
  return (scope: VerificationScope): string => {
    if (scope.kind === "global") return t("scopes.global");
    if (scope.kind === "city" && scope.cityKey) {
      return `${t(`cities.${scope.cityKey}`)} · ${scope.country ?? ""}`;
    }
    return scope.country ? `${t(`countries.${scope.country}`)} · ${scope.country}` : scope.display;
  };
}

function VerificationScopeTab({
  scopes,
  onScopes,
  onNotice,
}: {
  scopes: VerificationScope[];
  onScopes: (scopes: VerificationScope[]) => void;
  onNotice: (notice: Notice) => void;
}) {
  const t = useTranslations("verificationAdmin");
  const scopeLabel = useScopeLabel();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<"country" | "city">("country");
  const [country, setCountry] = useState<(typeof COUNTRY_OPTIONS)[number]>("HU");
  const [placeId, setPlaceId] = useState("");
  const cityChoices = CITY_OPTIONS.filter((city) => city.country === country);

  function replaceScope(next: VerificationScope) {
    onScopes(scopes.map((scope) => scope.id === next.id ? next : scope));
    onNotice({ tone: "info", text: t("localDraftNotice") });
  }

  function toggleMethod(scope: VerificationScope, method: VerificationMethod) {
    const effective = verificationEffectiveMethods(scope, scopes);
    const configured = scope.enabledMethods ?? effective;
    const nextMethods = configured.includes(method)
      ? configured.filter((candidate) => candidate !== method)
      : VERIFICATION_METHODS.filter((candidate) => configured.includes(candidate) || candidate === method);
    replaceScope({
      ...scope,
      enabledMethods: nextMethods,
      defaultLevel: nextMethods.length === 0 ? "none" : scope.defaultLevel,
    });
  }

  function setDefaultLevel(scope: VerificationScope, defaultLevel: VerificationLevel) {
    replaceScope({ ...scope, defaultLevel });
  }

  function setPublishState(scope: VerificationScope, publishState: VerificationScopeState) {
    replaceScope({
      ...scope,
      publishState,
      defaultLevel: publishState === "off" ? "none" : scope.defaultLevel,
    });
  }

  function addScope() {
    const iso = verificationIsoCountry(country);
    if (!iso) return;
    let next: VerificationScope;
    if (kind === "country") {
      const id = `country:${iso}`;
      if (scopes.some((scope) => scope.id === id)) {
        onNotice({ tone: "error", text: t("scopes.duplicate") });
        return;
      }
      next = {
        id,
        kind,
        country: iso,
        placeId: null,
        cityKey: null,
        display: iso,
        publishState: "draft",
        enabledMethods: null,
        defaultLevel: "light",
        featureRequirements: Object.fromEntries(
          VERIFICATION_FEATURE_KEYS.map((feature) => [feature, "inherit"]),
        ) as Record<VerificationFeatureKey, VerificationRequirement>,
        revision: 0,
      };
    } else {
      const city = cityChoices.find((candidate) => candidate.id === placeId);
      if (!city) {
        onNotice({ tone: "error", text: t("scopes.cityRequired") });
        return;
      }
      const id = `city:${city.country}:${city.cityKey}`;
      if (scopes.some((scope) => scope.id === id)) {
        onNotice({ tone: "error", text: t("scopes.duplicate") });
        return;
      }
      next = {
        id,
        kind,
        country: city.country,
        placeId: city.id,
        cityKey: city.cityKey,
        display: city.cityKey,
        publishState: "draft",
        enabledMethods: null,
        defaultLevel: "light",
        featureRequirements: Object.fromEntries(
          VERIFICATION_FEATURE_KEYS.map((feature) => [feature, "inherit"]),
        ) as Record<VerificationFeatureKey, VerificationRequirement>,
        revision: 0,
      };
    }
    onScopes([...scopes, next]);
    setAdding(false);
    setPlaceId("");
    onNotice({ tone: "success", text: t("scopes.addedDraft") });
  }

  return (
    <div className="verification-scopes-workspace">
      <section className="panel verification-regional-panel">
        <div className="panel-header">
          <div><h2>{t("scopes.listTitle")}</h2><p>{t("scopes.listCopy")}</p></div>
          <span className="badge">{scopes.length}</span>
        </div>
        <div className="panel-body">
          <div className="table-wrap verification-scope-table-wrap">
            <table className="data-table verification-scope-table">
              <thead><tr><th>{t("scopes.columns.region")}</th><th>{t("methods.video")}</th><th>{t("methods.persona")}</th><th>{t("scopes.columns.defaultLevel")}</th><th>{t("scopes.columns.status")}</th></tr></thead>
              <tbody>
                {scopes.map((scope) => {
                  const methods = verificationEffectiveMethods(scope, scopes);
                  const tierLanguage = verificationTierLanguageEnabled(methods);
                  const code = scope.kind === "global" ? t("scopes.globalCode") : scope.country ?? "";
                  return (
                    <tr key={scope.id} className={scope.publishState === "off" ? "verification-scope-off" : ""}>
                      <th>
                        <span className="verification-region-cell"><b>{code}</b><span><strong>{scopeLabel(scope)}</strong><small>{t(`scopes.kinds.${scope.kind}`)}{scope.enabledMethods === null ? ` · ${t("scopes.inherited")}` : ""}</small></span></span>
                      </th>
                      {VERIFICATION_METHODS.map((method) => (
                        <td key={method} data-label={t(`methods.${method}`)}>
                          <label className="switch verification-method-switch">
                            <input type="checkbox" checked={methods.includes(method)} aria-label={t("scopes.toggleMethod", { method: t(`methods.${method}`), scope: scopeLabel(scope) })} onChange={() => toggleMethod(scope, method)} />
                            <span className="switch-track" />
                          </label>
                        </td>
                      ))}
                      <td data-label={t("scopes.columns.defaultLevel")}>
                        <select value={scope.defaultLevel} disabled={methods.length === 0 || scope.publishState === "off"} aria-label={t("scopes.defaultLevelFor", { scope: scopeLabel(scope) })} onChange={(event) => setDefaultLevel(scope, event.target.value as VerificationLevel)}>
                          {VERIFICATION_LEVELS.map((level) => <option key={level} value={level}>{t(`levels.${level}`)}</option>)}
                        </select>
                        {!tierLanguage && methods.length === 1 ? <small>{t("scopes.noTierLanguage")}</small> : null}
                      </td>
                      <td data-label={t("scopes.columns.status")}>
                        <select value={scope.publishState} disabled={scope.kind === "global"} aria-label={t("scopes.statusFor", { scope: scopeLabel(scope) })} className={`verification-state-select state-${scope.publishState}`} onChange={(event) => setPublishState(scope, event.target.value as VerificationScopeState)}>
                          {VERIFICATION_SCOPE_STATES.map((state) => <option key={state} value={state}>{t(`scopes.states.${state}`)}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="row-actions verification-scope-actions">
            <button type="button" className="button button-primary" onClick={() => setAdding((value) => !value)}>{adding ? t("scopes.cancelAdd") : t("scopes.addRegion")}</button>
            <button type="button" className="button button-secondary" onClick={() => onNotice({ tone: "info", text: t("scopes.importPreview") })}>{t("scopes.importMembers")}</button>
          </div>
          {adding ? (
            <div className="verification-add-scope">
              <div className="segmented-tabs" role="tablist" aria-label={t("scopes.kindLabel")}>
                {(["country", "city"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={kind === value} className={kind === value ? "active" : ""} onClick={() => { setKind(value); setPlaceId(""); }}>{t(`scopes.kinds.${value}`)}</button>)}
              </div>
              <label className="field"><span>{t("scopes.country")}</span><select value={country} onChange={(event) => { setCountry(event.target.value as typeof country); setPlaceId(""); }}>{COUNTRY_OPTIONS.map((codeValue) => <option value={codeValue} key={codeValue}>{t(`countries.${codeValue}`)} · {codeValue}</option>)}</select></label>
              {kind === "city" ? (
                <div className="verification-city-picker">
                  <label className="field"><span>{t("scopes.citySearch")}</span><input type="search" value="" readOnly placeholder={t("scopes.citySearchPlaceholder")} aria-describedby="verification-city-search-hint" /><small id="verification-city-search-hint" className="field-hint">{t("scopes.citySearchHint")}</small></label>
                  <label className="field"><span>{t("scopes.city")}</span><select value={placeId} onChange={(event) => setPlaceId(event.target.value)}><option value="">{t("scopes.cityPlaceholder")}</option>{cityChoices.map((city) => <option value={city.id} key={city.id}>{t(`cities.${city.cityKey}`)} · {city.country}</option>)}</select><small className="field-hint">{t("scopes.canonicalSelection")}</small></label>
                </div>
              ) : null}
              <button type="button" className="button button-primary" onClick={addScope}>{t("scopes.addDraft")}</button>
            </div>
          ) : null}
        </div>
      </section>

      <aside className="verification-scope-sidecards">
        <section className="panel verification-guardrails-card">
          <div className="panel-header"><div><h2>{t("scopes.guardrails.title")}</h2><p>{t("scopes.guardrails.copy")}</p></div></div>
          <div className="panel-body">
            {(["bothOff", "oneOn", "liveDisable"] as const).map((rule) => <article key={rule}><strong>{t(`scopes.guardrails.${rule}.title`)}</strong><p>{t(`scopes.guardrails.${rule}.copy`)}</p></article>)}
          </div>
        </section>
        <section className="panel verification-queue-card">
          <div className="panel-header"><div><h2>{t("scopes.queue.title")}</h2><p>{t("scopes.queue.copy")}</p></div></div>
          <div className="panel-body">
            <div className="verification-queue-metric"><strong>128</strong><span>{t("scopes.queue.average", { minutes: 4 })}</span></div>
            <div className="verification-queue-bar" aria-label={t("scopes.queue.progressLabel", { minutes: 4, threshold: 30 })}><span style={{ width: `${Math.round((4 / 30) * 100)}%` }} /></div>
            <p>{t("scopes.queue.threshold", { minutes: 30 })}</p>
          </div>
        </section>
      </aside>
    </div>
  );
}

function VerificationRequirementsTab({ scopes, onScopes, onNotice }: { scopes: VerificationScope[]; onScopes: (scopes: VerificationScope[]) => void; onNotice: (notice: Notice) => void }) {
  const t = useTranslations("verificationAdmin");
  const scopeLabel = useScopeLabel();
  const [compactScope, setCompactScope] = useState(scopes[0]?.id ?? "global");

  function update(scopeId: string, feature: VerificationFeatureKey, value: VerificationRequirement) {
    onScopes(scopes.map((scope) => scope.id === scopeId ? { ...scope, featureRequirements: { ...scope.featureRequirements, [feature]: value } } : scope));
  }

  return (
    <section className="panel verification-matrix-panel">
      <div className="panel-header"><div><h2>{t("requirements.title")}</h2><p>{t("requirements.copy")}</p></div><button type="button" className="button button-primary button-small" onClick={() => onNotice({ tone: "info", text: t("localDraftNotice") })}>{t("reviewDraft")}</button></div>
      <div className="panel-body">
        <label className="field verification-compact-scope"><span>{t("requirements.compactScope")}</span><select value={compactScope} onChange={(event) => setCompactScope(event.target.value)}>{scopes.map((scope) => <option key={scope.id} value={scope.id}>{scopeLabel(scope)}</option>)}</select></label>
        <div className="table-wrap verification-matrix-wrap">
          <table className="data-table verification-matrix">
            <thead><tr><th>{t("requirements.feature")}</th>{scopes.map((scope) => <th key={scope.id} data-scope-id={scope.id} className={compactScope === scope.id ? "compact-active" : ""}>{scopeLabel(scope)}</th>)}</tr></thead>
            <tbody>
              {VERIFICATION_FEATURE_KEYS.map((feature) => (
                <tr key={feature}>
                  <th><strong>{t(`features.${feature}.title`)}</strong><small>{feature}</small></th>
                  {scopes.map((scope) => {
                    const methods = verificationEffectiveMethods(scope, scopes);
                    const guarded = methods.length === 0;
                    const effective = verificationEffectiveRequirement(scope, feature, scopes);
                    const source = scopes.find((candidate) => candidate.id === effective?.sourceId);
                    return (
                      <td key={scope.id} data-scope-id={scope.id} className={compactScope === scope.id ? "compact-active" : ""}>
                        <select aria-label={`${t(`features.${feature}.title`)} · ${scopeLabel(scope)}`} value={guarded ? "none" : scope.featureRequirements[feature]} disabled={guarded} onChange={(event) => update(scope.id, feature, event.target.value as VerificationRequirement)}>
                          {VERIFICATION_REQUIREMENTS.filter((value) => scope.kind !== "global" || value !== "inherit").map((value) => <option key={value} value={value}>{t(`requirements.values.${value}`)}</option>)}
                        </select>
                        {guarded ? <small>{t("requirements.guardrailNone")}</small> : scope.featureRequirements[feature] === "inherit" && effective ? <small>{t("requirements.effective", { value: t(`requirements.values.${effective.value}`), source: source ? scopeLabel(source) : t("scopes.global") })}</small> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function VerificationGatePreview({ copy, locale, previewCopy, variant }: { copy: VerificationGateCopyLocale; locale: CopyLocale; previewCopy: VerificationPreviewCopyPair; variant: VerificationGateVariant }) {
  const preview = previewCopy[locale];
  const icon = variant === "pending" ? "◷" : variant === "rejected" ? "!" : variant === "both" ? "1·2" : "✓";
  return (
    <aside className={`verification-gate-preview preview-${variant}`} aria-label={preview.label}>
      <div className="verification-phone-status"><span>9:41</span><span>{locale.toUpperCase()}</span></div>
      <div className="verification-gate-sheet">
        <span className="verification-gate-icon" aria-hidden="true">{icon}</span>
        <h3>{copy.title || preview.emptyTitle}</h3>
        {copy.subtitle ? <strong>{copy.subtitle}</strong> : null}
        {variant === "both" ? <div className="verification-stepper"><span><b>1</b>{preview.steps.video}</span><span><b>2</b>{preview.steps.persona}</span></div> : null}
        {variant === "rejected" ? <div className="verification-rejection-preview"><strong>{preview.rejected.reason}</strong><span>{formatPreviewCopy(preview.rejected.attempt, { attempt: 2, maximum: 5 })}</span><small>{preview.rejected.manualReview}</small></div> : null}
        {variant === "pending" ? <div className="verification-pending-preview"><strong>{formatPreviewCopy(preview.pending.wait, { minutes: 4 })}</strong><small>{formatPreviewCopy(preview.pending.longer, { minutes: 30 })}</small></div> : null}
        {copy.description ? <p>{copy.description}</p> : null}
        <button type="button" tabIndex={-1} aria-disabled="true">{copy.actionLabel || preview.emptyAction}</button>
        <button type="button" className="verification-preview-secondary" tabIndex={-1} aria-disabled="true">{copy.cancelLabel || preview.emptyCancel}</button>
      </div>
      <small>{preview.nonInteractive}</small>
    </aside>
  );
}

function VerificationMessagesTab({ pairs, previewCopy, onPairs, onNotice }: { pairs: VerificationGateCopyPair[]; previewCopy: VerificationPreviewCopyPair; onPairs: (pairs: VerificationGateCopyPair[]) => void; onNotice: (notice: Notice) => void }) {
  const t = useTranslations("verificationAdmin");
  const [variant, setVariant] = useState<VerificationGateVariant>("video");
  const [locale, setLocale] = useState<CopyLocale>("en");
  const pairIndex = pairs.findIndex((pair) => copyPairVariant(pair) === variant);
  const pair = pairs[pairIndex] ?? pairs[0];
  const copy = pair[locale];
  const errors = verificationGateCopyErrors(copy);

  function update<K extends keyof VerificationGateCopyLocale>(field: K, value: VerificationGateCopyLocale[K]) {
    const next = cloneCopyPairs(pairs);
    next[pairIndex] = { ...pair, [locale]: { ...copy, [field]: value } };
    onPairs(next);
  }

  function fieldCount(field: "title" | "subtitle" | "description" | "actionLabel" | "cancelLabel", maximum: number) {
    return <small className={errors.includes(field) ? "field-error" : "field-hint"}>{verificationTextLength(copy[field])}/{maximum}</small>;
  }

  return (
    <div className="verification-message-workspace">
      <section className="panel">
        <div className="panel-header"><div><h2>{t("messages.title")}</h2><p>{t("messages.copy")}</p></div><span className="badge badge-warning">{t("fixtureBadge")}</span></div>
        <div className="panel-body verification-message-editor">
          <div className="segmented-tabs verification-message-kind-tabs" role="tablist" aria-label={t("messages.defaultLabel")}>{VERIFICATION_GATE_VARIANTS.map((value) => <button type="button" role="tab" aria-selected={variant === value} className={variant === value ? "active" : ""} key={value} onClick={() => setVariant(value)}>{t(`messages.variants.${value}`)}</button>)}</div>
          {variant === "both" ? <div className="alert alert-info">{t("messages.bothMeaning")}</div> : null}
          {variant === "pending" ? <div className="alert alert-info">{t("messages.pendingMeaning")}</div> : null}
          {variant === "rejected" ? <div className="alert alert-info">{t("messages.rejectedMeaning")}</div> : null}
          <div className="segmented-tabs verification-locale-tabs" role="tablist" aria-label={t("messages.localeLabel")}>{(["en", "hu"] as const).map((value) => <button type="button" role="tab" aria-selected={locale === value} className={locale === value ? "active" : ""} key={value} onClick={() => setLocale(value)}>{t(`messages.locales.${value}`)}</button>)}</div>
          <div className="verification-copy-grid">
            <label className="field"><span>{t("messages.fields.icon")}</span><select value={copy.iconValue} onChange={(event) => update("iconValue", event.target.value)}><option value="video.fill">video.fill</option><option value="person.text.rectangle.fill">person.text.rectangle.fill</option><option value="checkmark.shield.fill">checkmark.shield.fill</option><option value="clock.fill">clock.fill</option><option value="exclamationmark.triangle.fill">exclamationmark.triangle.fill</option></select></label>
            <label className="field"><span>{t("messages.fields.title")}</span><input maxLength={80} value={copy.title} onChange={(event) => update("title", event.target.value)} />{fieldCount("title", 80)}</label>
            <label className="field"><span>{t("messages.fields.subtitle")}</span><input maxLength={120} value={copy.subtitle} onChange={(event) => update("subtitle", event.target.value)} />{fieldCount("subtitle", 120)}</label>
            <label className="field verification-copy-wide"><span>{t("messages.fields.description")}</span><textarea maxLength={600} rows={6} value={copy.description} onChange={(event) => update("description", event.target.value)} />{fieldCount("description", 600)}</label>
            <label className="field"><span>{t("messages.fields.actionKind")}</span><select value={copy.actionKind} onChange={(event) => update("actionKind", event.target.value as VerificationGateCopyLocale["actionKind"])}><option value="start_video">{t("messages.actions.start_video")}</option><option value="start_persona">{t("messages.actions.start_persona")}</option><option value="open_verification_center">{t("messages.actions.open_verification_center")}</option><option value="dismiss">{t("messages.actions.dismiss")}</option><option value="url">{t("messages.actions.url")}</option></select></label>
            <label className="field"><span>{t("messages.fields.actionLabel")}</span><input maxLength={40} value={copy.actionLabel} onChange={(event) => update("actionLabel", event.target.value)} />{fieldCount("actionLabel", 40)}</label>
            {copy.actionKind === "url" ? <label className="field verification-copy-wide"><span>{t("messages.fields.actionUrl")}</span><input inputMode="url" value={copy.actionUrl} onChange={(event) => update("actionUrl", event.target.value)} />{errors.includes("actionUrl") ? <small className="field-error">{t("messages.invalidUrl")}</small> : null}</label> : null}
            <label className="field"><span>{t("messages.fields.cancelLabel")}</span><input maxLength={40} value={copy.cancelLabel} onChange={(event) => update("cancelLabel", event.target.value)} />{fieldCount("cancelLabel", 40)}</label>
          </div>
          <button type="button" className="button button-primary" disabled={errors.length > 0} onClick={() => onNotice({ tone: "info", text: t("localDraftNotice") })}>{t("reviewDraft")}</button>
        </div>
      </section>
      <VerificationGatePreview copy={copy} locale={locale} previewCopy={previewCopy} variant={variant} />
    </div>
  );
}

function badgeSymbol(slot: VerificationBadgeSlot): string {
  return slot === "verified" ? "✓" : slot === "pending" ? "◷" : "!";
}

function VerificationBadgesTab({ onNotice }: { onNotice: (notice: Notice) => void }) {
  const t = useTranslations("verificationAdmin");
  const [badges, setBadges] = useState<BadgeDraft[]>(() => verificationBadgeFixtures().map((badge) => ({ ...badge, previewUrl: badge.managedUrl, fileName: null, error: null })));
  const urls = useRef<string[]>([]);

  useEffect(() => () => {
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current = [];
  }, []);

  function choose(slot: VerificationBadgeSlot, file: File | null) {
    if (!file) return;
    const error = verificationBadgeFileError(file);
    let previewUrl: string | null = null;
    if (!error) {
      previewUrl = URL.createObjectURL(file);
      urls.current.push(previewUrl);
    }
    setBadges((current) => current.map((badge) => badge.slot === slot ? { ...badge, previewUrl, fileName: file.name, error } : badge));
  }

  return (
    <section className="panel">
      <div className="panel-header"><div><h2>{t("badges.title")}</h2><p>{t("badges.copy")}</p></div><span className="badge badge-warning">{t("fixtureBadge")}</span></div>
      <div className="panel-body verification-badges-body">
        <div className="verification-tier-specimens"><div><span className="verification-level-pill level-light">{t("levels.light")}</span><small>{t("badges.tierInsideOnly")}</small></div><div><span className="verification-level-pill level-strong">{t("levels.strong")}</span><small>{t("badges.tierInsideOnly")}</small></div></div>
        <div className="alert alert-info">{t("badges.placementRule")}</div>
        <div className="verification-badge-grid">
          {badges.map((badge) => (
            <article className="verification-badge-card" key={badge.slot}>
              <header><div><h3>{t(`badges.slots.${badge.slot}.title`)}</h3><p>{t(`badges.slots.${badge.slot}.copy`)}</p></div><span className={`verification-badge-fallback slot-${badge.slot}`} aria-hidden="true">{badgeSymbol(badge.slot)}</span></header>
              <label className="field"><span>{t("badges.file")}</span><input type="file" accept="image/png" onChange={(event) => choose(badge.slot, event.target.files?.[0] ?? null)} /><small className="field-hint">{t("badges.limit", { size: Math.floor(MAX_VERIFICATION_BADGE_BYTES / 1024 / 1024) })}</small></label>
              {badge.error ? <div className="alert alert-error">{t(`badges.errors.${badge.error}`)}</div> : null}
              {badge.fileName ? <p className="verification-file-name">{badge.fileName}</p> : null}
              <div className="verification-badge-previews">{([16, 24, 40] as const).map((size) => <div key={size}><span className="verification-badge-stage stage-dark">{badge.previewUrl ? <img src={badge.previewUrl} width={size} height={size} alt="" /> : <b className={`slot-${badge.slot}`} style={{ width: size, height: size }}>{badgeSymbol(badge.slot)}</b>}</span><span className="verification-badge-stage stage-light">{badge.previewUrl ? <img src={badge.previewUrl} width={size} height={size} alt="" /> : <b className={`slot-${badge.slot}`} style={{ width: size, height: size }}>{badgeSymbol(badge.slot)}</b>}</span><small>{size}px</small></div>)}</div>
              <div className="verification-badge-placements">{(["people", "profile", "chat"] as const).map((placement) => <span key={placement} className={badge.slot !== "verified" && placement !== "profile" ? "is-private" : ""}>{t(`badges.placements.${placement}`)}<small>{badge.slot !== "verified" && placement !== "profile" ? t("badges.selfOnly") : t("badges.visibleHere")}</small></span>)}</div>
              <button type="button" className="button button-secondary" disabled={!badge.previewUrl || Boolean(badge.error)} onClick={() => onNotice({ tone: "info", text: t("badges.noManifest") })}>{t("badges.review")}</button>
            </article>
          ))}
        </div>
        <p className="field-hint">{t("badges.privacy")}</p>
      </div>
    </section>
  );
}

function VerificationSimulatorTab({ scopes }: { scopes: VerificationScope[] }) {
  const t = useTranslations("verificationAdmin");
  const scopeLabel = useScopeLabel();
  const [scopeId, setScopeId] = useState(scopes[0]?.id ?? "global");
  const [video, setVideo] = useState<VerificationMethodStatus>("rejected");
  const [persona, setPersona] = useState<VerificationMethodStatus>("pending");
  const [imported, setImported] = useState<VerificationLevel>("none");
  const [grant, setGrant] = useState<VerificationLevel>("none");
  const [badgeVisible, setBadgeVisible] = useState(true);
  const scope = scopes.find((candidate) => candidate.id === scopeId) ?? scopes[0];
  const methods = verificationEffectiveMethods(scope, scopes);
  const statuses = { video, persona };
  const derived = verificationDerivedLevel(methods, statuses);
  const effective = verificationMaxLevel(derived, imported, grant);
  const source = effective === grant && grant !== "none" ? "granted" : effective === imported && imported !== "none" ? "imported" : "derived";
  const tierLanguage = verificationTierLanguageEnabled(methods);
  const ownState = video === "rejected" || persona === "rejected" ? "rejected" : video === "pending" || persona === "pending" ? "pending" : effective !== "none" ? "verified" : "none";
  const publicBadge = badgeVisible && effective !== "none";

  return (
    <div className="verification-simulator-layout">
      <section className="panel">
        <div className="panel-header"><div><h2>{t("simulator.inputsTitle")}</h2><p>{t("simulator.inputsCopy")}</p></div><span className="badge badge-warning">{t("fixtureBadge")}</span></div>
        <div className="panel-body form-stack">
          <div className="alert alert-info">{t("simulator.localOnly")}</div>
          <label className="field"><span>{t("simulator.scope")}</span><select value={scopeId} onChange={(event) => setScopeId(event.target.value)}>{scopes.map((candidate) => <option key={candidate.id} value={candidate.id}>{scopeLabel(candidate)}</option>)}</select></label>
          <label className="field"><span>{t("simulator.video")}</span><select value={video} onChange={(event) => setVideo(event.target.value as VerificationMethodStatus)}>{VERIFICATION_METHOD_STATUSES.map((status) => <option key={status} value={status}>{t(`statuses.${status}`)}</option>)}</select></label>
          <label className="field"><span>{t("simulator.persona")}</span><select value={persona} onChange={(event) => setPersona(event.target.value as VerificationMethodStatus)}>{VERIFICATION_METHOD_STATUSES.map((status) => <option key={status} value={status}>{t(`statuses.${status}`)}</option>)}</select></label>
          {(video === "rejected" || persona === "rejected") ? <div className="verification-rejection-input"><strong>{t("simulator.rejectedFixture")}</strong><span>{t("simulator.rejectedReason")}</span><small>{t("simulator.rejectedAttempt", { attempt: 2, maximum: 5 })} · {t("simulator.manualReview")}</small></div> : null}
          <label className="field"><span>{t("simulator.imported")}</span><select value={imported} onChange={(event) => setImported(event.target.value as VerificationLevel)}>{VERIFICATION_LEVELS.map((level) => <option key={level} value={level}>{t(`levels.${level}`)}</option>)}</select></label>
          <label className="field"><span>{t("simulator.grant")}</span><select value={grant} onChange={(event) => setGrant(event.target.value as VerificationLevel)}>{VERIFICATION_LEVELS.map((level) => <option key={level} value={level}>{t(`levels.${level}`)}</option>)}</select></label>
          <label className="checkbox-field"><input type="checkbox" checked={badgeVisible} onChange={(event) => setBadgeVisible(event.target.checked)} /><span>{t("simulator.badgeVisible")}</span></label>
        </div>
      </section>
      <section className="panel">
        <div className="panel-header"><div><h2>{t("simulator.outputTitle")}</h2><p>{t("simulator.outputCopy")}</p></div>{tierLanguage ? <span className={`verification-level-pill level-${effective}`}>{t(`levels.${effective}`)}</span> : <span className="badge">{t("simulator.tierLanguageHidden")}</span>}</div>
        <div className="panel-body">
          <dl className="detail-list verification-simulator-summary"><div className="detail-row"><dt>{t("simulator.derived")}</dt><dd>{t(`levels.${derived}`)}</dd></div><div className="detail-row"><dt>{t("simulator.effective")}</dt><dd>{t(`levels.${effective}`)} · {t(`sources.${source}`)}</dd></div><div className="detail-row"><dt>{t("simulator.chain")}</dt><dd>{scopeLabel(scope)} → {t("scopes.global")}</dd></div><div className="detail-row"><dt>{t("simulator.publicBadge")}</dt><dd>{publicBadge ? t("simulator.pinkSeal") : t("simulator.hiddenSeal")}</dd></div><div className="detail-row"><dt>{t("simulator.ownState")}</dt><dd>{t(`simulator.ownStates.${ownState}`)}</dd></div></dl>
          <div className="verification-simulator-features">{VERIFICATION_FEATURE_KEYS.map((feature) => {
            const requirement = verificationEffectiveRequirement(scope, feature, scopes);
            const required = requirement?.value ?? "none";
            const allowed = levelRank(effective) >= requirementRank(required);
            const nextMethod = required === "strong" ? (methods.includes("persona") ? "persona" : methods[0]) : methods.includes("video") ? "video" : methods[0];
            return <article key={feature}><div><strong>{t(`features.${feature}.title`)}</strong><small>{feature}</small></div><span className={`status-badge ${allowed ? "status-accepted" : "status-denied"}`}>{allowed ? t("simulator.allowed") : t("simulator.blocked")}</span><small>{t("simulator.requirement", { value: t(`requirements.values.${required}`) })}{!allowed && nextMethod ? ` · ${t("simulator.next", { method: t(`methods.${nextMethod}`) })}` : ""}</small></article>;
          })}</div>
        </div>
      </section>
    </div>
  );
}

export default function VerificationAdminConsole({ seedCopy, previewCopy, initialTab }: { seedCopy: VerificationGateCopyPair[]; previewCopy: VerificationPreviewCopyPair; initialTab: VerificationTabKey }) {
  const t = useTranslations("verificationAdmin");
  const [tab, setTab] = useState<VerificationTabKey>(initialTab);
  const [scopes, setScopes] = useState<VerificationScope[]>(verificationScopeFixtures);
  const [copyPairs, setCopyPairs] = useState<VerificationGateCopyPair[]>(() => cloneCopyPairs(seedCopy));
  const [notice, setNotice] = useState<Notice>(null);
  const tabIndex = VERIFICATION_TAB_KEYS.indexOf(tab);

  function selectTab(value: VerificationTabKey) {
    setTab(value);
    setNotice(null);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    window.history.replaceState(window.history.state, "", url);
  }

  const activePanel = useMemo(() => {
    if (tab === "scopes") return <VerificationScopeTab scopes={scopes} onScopes={setScopes} onNotice={setNotice} />;
    if (tab === "requirements") return <VerificationRequirementsTab scopes={scopes} onScopes={setScopes} onNotice={setNotice} />;
    if (tab === "messages") return <VerificationMessagesTab pairs={copyPairs} previewCopy={previewCopy} onPairs={setCopyPairs} onNotice={setNotice} />;
    if (tab === "badges") return <VerificationBadgesTab onNotice={setNotice} />;
    return <VerificationSimulatorTab scopes={scopes} />;
  }, [copyPairs, previewCopy, scopes, tab]);

  function tabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? VERIFICATION_TAB_KEYS.length - 1 : (tabIndex + (event.key === "ArrowRight" ? 1 : -1) + VERIFICATION_TAB_KEYS.length) % VERIFICATION_TAB_KEYS.length;
    const next = VERIFICATION_TAB_KEYS[nextIndex];
    selectTab(next);
    document.getElementById(`verification-tab-${next}`)?.focus();
  }

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} actions={<span className="badge badge-warning verification-staging-badge">{t("staging")}</span>} />
      <div className="alert alert-info page-alert verification-readiness" role="status"><strong>{t("readinessTitle")}</strong> {t("readinessCopy")}</div>
      {notice ? <div className={`alert alert-${notice.tone} page-alert`} role="status">{notice.text}</div> : null}
      <div className="verification-tabs" role="tablist" aria-label={t("tabs.label")}>{VERIFICATION_TAB_KEYS.map((value) => <button id={`verification-tab-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls={`verification-panel-${value}`} tabIndex={tab === value ? 0 : -1} className={tab === value ? "active" : ""} key={value} onKeyDown={tabKeyDown} onClick={() => selectTab(value)}>{t(`tabs.${value}`)}</button>)}</div>
      <div id={`verification-panel-${tab}`} role="tabpanel" aria-labelledby={`verification-tab-${tab}`}>{activePanel}</div>
    </>
  );
}
