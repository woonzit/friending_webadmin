"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import {
  FORCED_VERIFICATION_METHODS,
  FORCED_VERIFICATION_UNAVAILABLE_ERROR,
  WAITING_ROOM_COPY_FIELDS,
  WAITING_ROOM_COPY_LIMITS,
  WAITING_ROOM_LOCALES,
  decodeForcedConsoleResponse,
  decodeForcedImpactResponse,
  decodeForcedSaveResponse,
  emptyWaitingRoomCopyOverrideDraft,
  forcedMethodList,
  forcedStorefrontName,
  forcedVerificationDocumentFromDraft,
  forcedVerificationDocumentsEqual,
  forcedVerificationDraft,
  forcedVerificationStorefronts,
  localizedForcedStorefronts,
  resolveForcedMethods,
  resolveWaitingRoomCopy,
  validateForcedVerificationDraft,
  waitingRoomTextLength,
  type ForcedMethods,
  type ForcedVerificationAccess,
  type ForcedVerificationConsole,
  type ForcedVerificationDocument,
  type ForcedVerificationDraft,
  type ForcedVerificationImpact,
  type ForcedVerificationMethod,
  type WaitingRoomCopyField,
  type WaitingRoomLocale,
} from "@/lib/forcedVerification";

type Props = {
  access: ForcedVerificationAccess;
  /** The parent console is busy or holds a pending mutation; nothing here may write meanwhile. */
  locked: boolean;
};

type LoadState = "loading" | "ready" | "unavailable" | "error";
type Notice = { tone: "info" | "error" | "success"; text: string } | null;

/** D-052 palette tokens (reports/design/coloring-palette-v3.md) — the Waiting Room frames use exactly these. */
const PHONE_PALETTE = {
  light: { accent: "#007F91", accentPressed: "#006776", faint: "#DDFBFC", onAccent: "#FFFFFF", inactive: "#6B7478", surface: "#F7F8FA", text: "#1C1C1E", line: "#E8EAED" },
  dark: { accent: "#75F0F4", accentPressed: "#8DFDFF", faint: "#12373B", onAccent: "#071516", inactive: "#8A9497", surface: "#1C1C1E", text: "#F7F8FA", line: "#2A2D31" },
} as const;

function methodsSummaryKey(methods: ForcedMethods): "none" | "persona" | "video" | "any" {
  const list = forcedMethodList(methods);
  if (list.length === 0) return "none";
  return list.length === 2 ? "any" : list[0];
}

function MethodSwitch({ checked, disabled, label, onChange }: { checked: boolean; disabled: boolean; label: string; onChange: (value: boolean) => void }) {
  return (
    <label className="switch forced-switch">
      <input type="checkbox" checked={checked} disabled={disabled} aria-label={label} onChange={(event) => onChange(event.target.checked)} />
      <span className="switch-track" />
    </label>
  );
}

function PhoneFrame({
  mode,
  storefrontLabel,
  copy,
  methods,
  labels,
}: {
  mode: "light" | "dark";
  storefrontLabel: string;
  copy: { title: string; subtitle: string; description: string };
  methods: ForcedVerificationMethod[];
  labels: { persona: string; video: string; footer: string[]; notForced: string; modeLabel: string };
}) {
  const palette = PHONE_PALETTE[mode];
  return (
    <figure className={`forced-phone forced-phone-${mode}`} style={{ background: palette.surface, color: palette.text, borderColor: palette.line }} aria-label={labels.modeLabel}>
      <div className="forced-phone-status" style={{ color: palette.inactive }}><span>9:41</span><span>{storefrontLabel}</span></div>
      <div className="forced-phone-illustration" style={{ background: palette.faint, color: palette.accent }} aria-hidden="true">
        <span style={{ background: palette.accent }} />
      </div>
      <h4 className="forced-phone-title">{copy.title}</h4>
      <p className="forced-phone-subtitle" style={{ color: palette.accent }}>{copy.subtitle}</p>
      <p className="forced-phone-description">{copy.description}</p>
      <div className="forced-phone-actions">
        {methods.length === 0 ? (
          <span className="forced-phone-note" style={{ color: palette.inactive }}>{labels.notForced}</span>
        ) : methods.map((method, index) => (
          <span
            key={method}
            className="forced-phone-button"
            style={index === 0
              ? { background: palette.accent, color: palette.onAccent, borderColor: palette.accent }
              : { background: "transparent", color: palette.accent, borderColor: palette.accent }}
          >
            {method === "persona" ? labels.persona : labels.video}
          </span>
        ))}
      </div>
      <figcaption className="forced-phone-footer" style={{ color: palette.inactive }}>
        {labels.footer.map((item) => <span key={item}>{item}</span>)}
      </figcaption>
    </figure>
  );
}

/**
 * Verification console → "Forced & waiting room" (contract v1 §4). Core owns
 * the document, its revision, validation, audit and the gate; this tab edits
 * one draft, previews what the app would render and saves with the T-468
 * discipline: exact decoders, closed refusal maps, conflict → reload never
 * replay, uncertain → authoritative reload before any retry.
 */
export default function ForcedVerificationTab({ access, locked }: Props) {
  const t = useTranslations("verificationAdmin.forced");
  const locale = useLocale() === "hu" ? "hu" : "en";
  const [state, setState] = useState<LoadState>("loading");
  const [console_, setConsole] = useState<ForcedVerificationConsole | null>(null);
  const [draft, setDraft] = useState<ForcedVerificationDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [impact, setImpact] = useState<{ result: ForcedVerificationImpact; document: ForcedVerificationDocument } | null>(null);
  const [copyStorefrontToAdd, setCopyStorefrontToAdd] = useState("");
  const [previewStorefront, setPreviewStorefront] = useState("");
  const [previewLocale, setPreviewLocale] = useState<WaitingRoomLocale>(locale);

  const countries = useMemo(() => localizedForcedStorefronts(locale), [locale]);
  const editable = access.editable && !locked && !busy;

  const load = useCallback(async (keepDraft: boolean) => {
    setState((current) => (current === "ready" ? current : "loading"));
    const decoded = decodeForcedConsoleResponse(await adminCall("verification_forced_console", {}));
    if (!decoded.ok) {
      setState(decoded.kind === "uncertain" && decoded.error === FORCED_VERIFICATION_UNAVAILABLE_ERROR ? "unavailable" : "error");
      return;
    }
    setConsole(decoded.value);
    setDraft((current) => (keepDraft && current ? current : forcedVerificationDraft(decoded.value.document)));
    setState("ready");
  }, []);

  useEffect(() => { void load(false); }, [load]);

  const draftDocument = useMemo(() => (draft ? forcedVerificationDocumentFromDraft(draft) : null), [draft]);
  const draftIssue = useMemo(() => (draft ? validateForcedVerificationDraft(draft) : null), [draft]);
  const dirty = console_ !== null && (draftDocument === null || !forcedVerificationDocumentsEqual(draftDocument, console_.document));
  const impactStale = impact !== null && (draftDocument === null || !forcedVerificationDocumentsEqual(impact.document, draftDocument));

  function patch(next: Partial<ForcedVerificationDraft>) {
    setDraft((current) => (current ? { ...current, ...next } : current));
  }

  function patchOverride(index: number, next: Partial<ForcedVerificationDraft["overrides"][number]>) {
    if (!draft) return;
    patch({ overrides: draft.overrides.map((row, candidate) => (candidate === index ? { ...row, ...next } : row)) });
  }

  function patchCopy(storefront: string | null, copyLocale: WaitingRoomLocale, field: WaitingRoomCopyField, value: string) {
    if (!draft) return;
    if (storefront === null) {
      patch({ copy_default: { ...draft.copy_default, [copyLocale]: { ...draft.copy_default[copyLocale], [field]: value } } });
      return;
    }
    const current = draft.copy_overrides[storefront] ?? emptyWaitingRoomCopyOverrideDraft();
    patch({ copy_overrides: { ...draft.copy_overrides, [storefront]: { ...current, [copyLocale]: { ...current[copyLocale], [field]: value } } } });
  }

  function addCopyOverride() {
    if (!draft || !copyStorefrontToAdd || draft.copy_overrides[copyStorefrontToAdd]) return;
    patch({ copy_overrides: { ...draft.copy_overrides, [copyStorefrontToAdd]: emptyWaitingRoomCopyOverrideDraft() } });
    setCopyStorefrontToAdd("");
  }

  function removeCopyOverride(storefront: string) {
    if (!draft) return;
    const next = { ...draft.copy_overrides };
    delete next[storefront];
    patch({ copy_overrides: next });
  }

  async function save() {
    if (!console_ || !draft || !editable) return;
    if (draftIssue || !draftDocument) {
      setNotice({ tone: "error", text: t(`validation.${draftIssue ?? "storefront"}`) });
      return;
    }
    setBusy(true);
    setNotice(null);
    const submitted = { expected_revision: console_.revision, document: draftDocument };
    const decoded = decodeForcedSaveResponse(await adminCall("verification_forced_save", submitted), submitted);
    if (decoded.ok) {
      setConsole({ ...console_, revision: decoded.value.revision, document: decoded.value.document });
      setDraft(forcedVerificationDraft(decoded.value.document));
      setImpact(null);
      setNotice({ tone: "success", text: t("saved", { revision: decoded.value.revision }) });
      setBusy(false);
      return;
    }
    if (decoded.kind === "refused") {
      if (decoded.error === "verification-forced-conflict") {
        setNotice({ tone: "error", text: t("conflict") });
        setBusy(false);
        await load(false);
        return;
      }
      setNotice({ tone: "error", text: t(decoded.status === 422 ? "invalid" : "refused", { code: decoded.error }) });
      setBusy(false);
      return;
    }
    setNotice({ tone: "error", text: t("uncertain", { code: decoded.error }) });
    setBusy(false);
    await load(true);
  }

  async function runImpact() {
    if (!draft || !editable) return;
    if (draftIssue || !draftDocument) {
      setNotice({ tone: "error", text: t(`validation.${draftIssue ?? "storefront"}`) });
      return;
    }
    setBusy(true);
    setNotice(null);
    const document = draftDocument;
    const decoded = decodeForcedImpactResponse(await adminCall("verification_forced_impact_preview", { document }));
    setImpact(decoded.ok ? { result: decoded.value, document } : null);
    setNotice(decoded.ok ? { tone: "info", text: t("impactReady") } : { tone: "error", text: t("impactFailed", { code: decoded.ok ? "" : decoded.error }) });
    setBusy(false);
  }

  if (state === "loading") return <LoadingPanel />;
  if (state === "unavailable") {
    return (
      <section className="panel">
        <div className="panel-header"><div><h2>{t("unavailableTitle")}</h2><p>{t("unavailableCopy")}</p></div></div>
        <div className="panel-body"><button type="button" className="button button-secondary" onClick={() => void load(false)}>{t("retry")}</button></div>
      </section>
    );
  }
  if (state === "error" || !console_ || !draft) return <ErrorPanel message={t("loadError")} retry={() => void load(false)} />;

  const usedOverrideStorefronts = new Set(draft.overrides.map((row) => row.storefront));
  const previewDocument = draftDocument ?? console_.document;
  const previewStorefrontOrNull = previewStorefront === "" ? null : previewStorefront;
  const previewMethods = forcedMethodList(resolveForcedMethods(previewDocument, previewStorefrontOrNull));
  const previewCopy = resolveWaitingRoomCopy(previewDocument, previewStorefrontOrNull, previewLocale);
  const previewStorefronts = [...new Set([...forcedVerificationStorefronts(previewDocument), ...(previewStorefront ? [previewStorefront] : [])])].sort();
  const previewLabels = {
    persona: t("preview.primaryPersona"),
    video: t("preview.primaryVideo"),
    footer: [t("preview.footerEdit"), t("preview.footerSupport"), t("preview.footerSignOut"), t("preview.footerDelete")],
    notForced: t("preview.notForced"),
    modeLabel: "",
  };
  const storefrontLabel = previewStorefrontOrNull ? `${forcedStorefrontName(previewStorefrontOrNull, previewLocale)} · ${previewStorefrontOrNull}` : t("preview.globalShort");

  function copyField(storefront: string | null, copyLocale: WaitingRoomLocale, field: WaitingRoomCopyField) {
    const value = storefront === null ? draft!.copy_default[copyLocale][field] : (draft!.copy_overrides[storefront]?.[copyLocale][field] ?? "");
    const inherited = storefront === null ? console_!.compiled_defaults.copy[copyLocale][field] : draft!.copy_default[copyLocale][field];
    const limit = WAITING_ROOM_COPY_LIMITS[field];
    const used = waitingRoomTextLength(value.trim());
    const id = `forced-copy-${storefront ?? "default"}-${copyLocale}-${field}`;
    const common = {
      id,
      value,
      disabled: !editable,
      "aria-invalid": used > limit,
      placeholder: storefront === null ? inherited : t("copy.inheritPlaceholder", { value: inherited }),
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => patchCopy(storefront, copyLocale, field, event.target.value),
    };
    return (
      <label className="field forced-copy-field" key={id}>
        <span>{t(`copy.fields.${field}`)} · {t(`copy.locales.${copyLocale}`)}</span>
        {field === "description" ? <textarea rows={4} {...common} /> : <input {...common} />}
        <small className={`field-hint forced-copy-counter${used > limit ? " is-over" : ""}`}>{t("copy.limit", { used, max: limit })}</small>
      </label>
    );
  }

  return (
    <div className="forced-workspace">
      {!access.editable ? <div className="alert alert-info page-alert">{t("readOnly")}</div> : null}
      {notice ? <div className={`alert alert-${notice.tone} page-alert`} role="status">{notice.text}</div> : null}

      <section className="panel">
        <div className="panel-header">
          <div><h2>{t("rulesTitle")}</h2><p>{t("rulesCopy")}</p></div>
          <div className="row-actions">
            <span className="status-badge neutral">{t("revision", { revision: console_.revision })}</span>
            {dirty ? <span className="status-badge status-pending">{t("unsaved")}</span> : null}
          </div>
        </div>
        <div className="panel-body form-stack">
          <div className="table-wrap">
            <table className="data-table forced-rule-table">
              <thead><tr><th>{t("columns.region")}</th><th>{t("columns.persona")}</th><th>{t("columns.video")}</th><th>{t("columns.summary")}</th><th>{t("columns.actions")}</th></tr></thead>
              <tbody>
                <tr className="forced-global-row">
                  <th><strong>{t("globalRow")}</strong><small>{t("globalRowHint")}</small></th>
                  {FORCED_VERIFICATION_METHODS.map((method) => (
                    <td key={method}>
                      <MethodSwitch checked={draft.default[method]} disabled={!editable} label={`${t("globalRow")} · ${t(`methods.${method}`)}`} onChange={(value) => patch({ default: { ...draft.default, [method]: value } })} />
                    </td>
                  ))}
                  <td><span className={`status-badge ${methodsSummaryKey(draft.default) === "none" ? "neutral" : "status-accepted"}`}>{t(`summary.${methodsSummaryKey(draft.default)}`)}</span></td>
                  <td />
                </tr>
                {draft.overrides.map((row, index) => (
                  <tr key={`${row.storefront || "new"}-${index}`}>
                    <th>
                      <select className="input" value={row.storefront} disabled={!editable} aria-invalid={!row.storefront} onChange={(event) => patchOverride(index, { storefront: event.target.value })}>
                        <option value="">{t("selectStorefront")}</option>
                        {countries.map((country) => (
                          <option key={country.alpha3} value={country.alpha3} disabled={country.alpha3 !== row.storefront && usedOverrideStorefronts.has(country.alpha3)}>{country.name} · {country.alpha3}</option>
                        ))}
                      </select>
                    </th>
                    {FORCED_VERIFICATION_METHODS.map((method) => (
                      <td key={method}>
                        <MethodSwitch checked={row[method]} disabled={!editable} label={`${row.storefront || t("selectStorefront")} · ${t(`methods.${method}`)}`} onChange={(value) => patchOverride(index, { [method]: value })} />
                      </td>
                    ))}
                    <td><span className={`status-badge ${methodsSummaryKey(row) === "none" ? "neutral" : "status-accepted"}`}>{t(`summary.${methodsSummaryKey(row)}`)}</span></td>
                    <td><button type="button" className="button button-ghost button-danger button-small" disabled={!editable} onClick={() => patch({ overrides: draft.overrides.filter((_, candidate) => candidate !== index) })}>{t("removeOverride")}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row-actions">
            <button type="button" className="button button-secondary" disabled={!editable || draft.overrides.some((row) => !row.storefront) || draft.overrides.length >= countries.length} onClick={() => patch({ overrides: [...draft.overrides, { storefront: "", ...draft.default }] })}>{t("addOverride")}</button>
            <small className="field-hint">{t("overrideHint")}</small>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h2>{t("copyTitle")}</h2><p>{t("copyCopy")}</p></div></div>
        <div className="panel-body form-stack">
          <h3 className="forced-subheading">{t("defaultsTitle")}</h3>
          <div className="forced-copy-grid">
            {WAITING_ROOM_COPY_FIELDS.map((field) => WAITING_ROOM_LOCALES.map((copyLocale) => copyField(null, copyLocale, field)))}
          </div>
          <div className="row-actions">
            <button type="button" className="button button-ghost button-small" disabled={!editable} onClick={() => patch({ copy_default: { en: { ...console_.compiled_defaults.copy.en }, hu: { ...console_.compiled_defaults.copy.hu } } })}>{t("resetCompiled")}</button>
          </div>

          <div className="forced-section-heading">
            <div><h3 className="forced-subheading">{t("overridesTitle")}</h3><p className="field-hint">{t("overridesCopy")}</p></div>
            <div className="row-actions">
              <select className="input" value={copyStorefrontToAdd} disabled={!editable} onChange={(event) => setCopyStorefrontToAdd(event.target.value)}>
                <option value="">{t("selectStorefront")}</option>
                {countries.map((country) => (
                  <option key={country.alpha3} value={country.alpha3} disabled={Boolean(draft.copy_overrides[country.alpha3])}>{country.name} · {country.alpha3}</option>
                ))}
              </select>
              <button type="button" className="button button-secondary" disabled={!editable || !copyStorefrontToAdd} onClick={addCopyOverride}>{t("addCopyOverride")}</button>
            </div>
          </div>
          {Object.keys(draft.copy_overrides).length === 0 ? <p className="field-hint">{t("noCopyOverrides")}</p> : null}
          {Object.keys(draft.copy_overrides).sort().map((storefront) => (
            <article className="forced-copy-override" key={storefront}>
              <div className="forced-section-heading">
                <strong>{forcedStorefrontName(storefront, locale)} · {storefront}</strong>
                <button type="button" className="button button-ghost button-danger button-small" disabled={!editable} onClick={() => removeCopyOverride(storefront)}>{t("removeCopyOverride")}</button>
              </div>
              <div className="forced-copy-grid">
                {WAITING_ROOM_COPY_FIELDS.map((field) => WAITING_ROOM_LOCALES.map((copyLocale) => copyField(storefront, copyLocale, field)))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div><h2>{t("previewTitle")}</h2><p>{t("previewCopy")}</p></div>
          <div className="row-actions">
            <label className="field forced-inline-field">
              <span>{t("preview.storefront")}</span>
              <select className="input" value={previewStorefront} onChange={(event) => setPreviewStorefront(event.target.value)}>
                <option value="">{t("preview.global")}</option>
                {previewStorefronts.map((storefront) => <option key={storefront} value={storefront}>{forcedStorefrontName(storefront, locale)} · {storefront}</option>)}
                {countries.filter((country) => !previewStorefronts.includes(country.alpha3)).map((country) => <option key={country.alpha3} value={country.alpha3}>{country.name} · {country.alpha3}</option>)}
              </select>
            </label>
            <div className="row-actions" role="group" aria-label={t("preview.locale")}>
              {WAITING_ROOM_LOCALES.map((entry) => <button type="button" key={entry} className={`button button-small ${previewLocale === entry ? "button-primary" : "button-secondary"}`} aria-pressed={previewLocale === entry} onClick={() => setPreviewLocale(entry)}>{t(`copy.locales.${entry}`)}</button>)}
            </div>
          </div>
        </div>
        <div className="panel-body">
          <div className="forced-phone-grid">
            <PhoneFrame mode="light" storefrontLabel={storefrontLabel} copy={previewCopy} methods={previewMethods} labels={{ ...previewLabels, modeLabel: t("preview.light") }} />
            <PhoneFrame mode="dark" storefrontLabel={storefrontLabel} copy={previewCopy} methods={previewMethods} labels={{ ...previewLabels, modeLabel: t("preview.dark") }} />
          </div>
          <small className="field-hint">{t("preview.nonInteractive")}</small>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div><h2>{t("impactTitle")}</h2><p>{t("impactCopy")}</p></div>
          <button type="button" className="button button-secondary" disabled={!editable || draftIssue !== null} onClick={() => void runImpact()}>{busy ? t("working") : t("runImpact")}</button>
        </div>
        <div className="panel-body form-stack">
          {impact ? (
            <>
              {impactStale ? <div className="alert alert-warning">{t("impactStale")}</div> : null}
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>{t("impactColumns.storefront")}</th><th>{t("impactColumns.seen")}</th><th>{t("impactColumns.gated")}</th><th>{t("impactColumns.satisfied")}</th></tr></thead>
                  <tbody>
                    {impact.result.by_storefront.map((row) => (
                      <tr key={row.storefront}><th>{forcedStorefrontName(row.storefront, locale)} · {row.storefront}</th><td>{row.members_seen}</td><td>{row.would_be_gated}</td><td>{row.satisfied}</td></tr>
                    ))}
                    <tr><th>{t("impactUnknown")}</th><td>{impact.result.unknown_storefront.members_seen}</td><td>{impact.result.unknown_storefront.would_be_gated}</td><td>{impact.result.unknown_storefront.satisfied}</td></tr>
                  </tbody>
                </table>
              </div>
              <small className="field-hint">{t("impactComputedAt", { time: impact.result.computed_at })}</small>
            </>
          ) : <p className="field-hint">{t("impactEmpty")}</p>}
        </div>
      </section>

      <div className="forced-save-bar">
        {draftIssue ? <p className="field-error" role="alert">{t(`validation.${draftIssue}`)}</p> : null}
        <div className="row-actions">
          <button type="button" className="button button-secondary" disabled={busy || locked} onClick={() => void load(false)}>{t("reload")}</button>
          <button type="button" className="button button-primary" disabled={!editable || !dirty || draftIssue !== null} onClick={() => void save()}>{busy ? t("saving") : t("save")}</button>
        </div>
      </div>
    </div>
  );
}
