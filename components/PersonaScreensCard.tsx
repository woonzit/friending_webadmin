"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import {
  PERSONA_SCREENS_UNAVAILABLE_ERROR,
  PERSONA_SCREEN_KEYS,
  PERSONA_SCREEN_LANGUAGES,
  PERSONA_SCREEN_SLOTS,
  PERSONA_SCREEN_SLOT_BYTE_LIMITS,
  decodePersonaScreensConsoleResponse,
  decodePersonaScreensSaveResponse,
  personaScreenFieldPath,
  personaScreenPreview,
  personaScreenSlotByteLength,
  personaScreenSlotIssue,
  personaScreensAccess,
  personaScreensDocumentFromDraft,
  personaScreensDocumentsEqual,
  personaScreensDraft,
  personaScreensDraftIssues,
  personaScreensDraftWithValue,
  personaScreensForLanguage,
  personaScreensPublishedBlock,
  personaScreensSlotCounts,
  type PersonaScreenKey,
  type PersonaScreenLanguage,
  type PersonaScreenPreview,
  type PersonaScreenSlot,
  type PersonaScreensAccess,
  type PersonaScreensConsole,
  type PersonaScreensDraft,
  type PersonaScreensProjection,
} from "@/lib/personaScreens";

type Props = {
  /**
   * Core's `admin_me.persona_screens` projection, parsed once by the page that
   * already read the membership. Nothing here grants anything it does not.
   */
  projection: PersonaScreensProjection;
  /** The parent console is busy or holds a pending receipt; nothing here may write meanwhile. */
  locked: boolean;
};

type LoadState = "loading" | "ready" | "closed" | "unavailable" | "error";
type Notice = { tone: "info" | "error" | "success"; text: string } | null;

/**
 * D-052 palette v3 (`reports/design/coloring-palette-v3.md`) plus the two
 * neutral roles these screens actually read: `App.primaryBackground`,
 * `App.textColor` and `VerificationPolicyPalette.muted` from the iOS tree. An
 * appearance rule can restyle the accent, so this frame shows the shipped
 * default rather than claiming to be a render of the member's own theme.
 */
const PHONE_PALETTE = {
  light: {
    surface: "#FEFEFE",
    text: "#000000",
    muted: "#6B6668",
    accent: "#007F91",
    onAccent: "#FFFFFF",
    faint: "#DDFBFC",
    error: "#B3261E",
    errorFill: "#FBE6E4",
    line: "#E8EAED",
  },
  dark: {
    surface: "#000000",
    text: "#FFFFFF",
    muted: "#8E8A93",
    accent: "#75F0F4",
    onAccent: "#071516",
    faint: "#12373B",
    error: "#FF7588",
    errorFill: "#371C22",
    line: "#2A2D31",
  },
} as const;

type PhoneMode = keyof typeof PHONE_PALETTE;

function MarkGlyph({ screen, color }: { screen: PersonaScreenKey; color: string }) {
  const common = {
    width: 34,
    height: 34,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (screen === "success") {
    return <svg {...common}><path d="M4 12.8 9.2 18 20 6.5" /></svg>;
  }
  if (screen === "failed") {
    return (
      <svg {...common}>
        <path d="M12 3.6 22 20.4H2Z" />
        <path d="M12 9.6v5" />
        <path d="M12 17.4h.01" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="2.6" y="5" width="18.8" height="14" rx="2.4" />
      <circle cx="8.4" cy="11" r="2.1" />
      <path d="M5.2 16.2c.7-1.5 1.9-2.2 3.2-2.2s2.5.7 3.2 2.2" />
      <path d="M14.8 10h4.2M14.8 13.4h4.2" />
    </svg>
  );
}

/**
 * One screen as a member sees it. Every string is the resolved preview slot, so
 * a slot the operator left blank shows the app's own compiled copy — which is
 * exactly what the member will get, and is why the caption under the frame says
 * which slots came from where.
 */
function PhoneFrame({
  mode,
  screen,
  preview,
  labels,
}: {
  mode: PhoneMode;
  screen: PersonaScreenKey;
  preview: PersonaScreenPreview;
  labels: { mode: string; furniture: string };
}) {
  const palette = PHONE_PALETTE[mode];
  const isError = screen === "failed";
  return (
    <figure
      className={`persona-screens-phone persona-screens-phone-${mode}`}
      style={{ background: palette.surface, color: palette.text, borderColor: palette.line }}
      aria-label={labels.mode}
    >
      <div className="persona-screens-phone-status" style={{ color: palette.muted }}>
        <span>9:41</span><span>{labels.mode}</span>
      </div>
      <div
        className="persona-screens-phone-mark"
        style={{ background: isError ? palette.errorFill : palette.faint }}
      >
        <MarkGlyph screen={screen} color={isError ? palette.error : palette.accent} />
      </div>
      <h4 className="persona-screens-phone-headline">{preview.headline.text}</h4>
      <p className="persona-screens-phone-subtitle" style={{ color: palette.muted }}>
        {preview.subtitle.text}
      </p>
      <div className="persona-screens-phone-actions">
        <span
          className="persona-screens-phone-cta"
          style={{ background: palette.accent, color: palette.onAccent }}
        >
          {preview.cta.text}
        </span>
      </div>
      <figcaption className="persona-screens-phone-furniture" style={{ color: palette.muted }}>
        {labels.furniture}
      </figcaption>
    </figure>
  );
}

/**
 * The Persona verification screens console (T-551, D-080, contract v1).
 *
 * Core owns the document, its revision, validation, the audit row and the
 * published block. This card edits one draft, previews what a member would see
 * and saves with the T-468 discipline: exact decoders, closed refusal maps,
 * conflict → reload and never replay, uncertain → authoritative reload before
 * any retry.
 *
 * THE ONE RULE THIS SURFACE CARRIES ALONE (contract §1, D-077): the editor
 * never pre-fills one language from another, and never pre-fills a save from
 * `compiled_reference`. Both guarantees live in `lib/personaScreens.ts`, whose
 * draft builder takes only the stored document and whose document builder takes
 * only the draft. Here they show up as three deliberate choices:
 *
 *   1. ONE LANGUAGE AT A TIME. The languages are tabs, not neighbouring
 *      columns, so English is not sitting beside an empty Hungarian box
 *      inviting a paste. Switching tabs changes nothing in either draft.
 *   2. NO "fill from the app's copy" AND NO "copy from the other language"
 *      control exists. The Waiting Room console has a reset-to-compiled button
 *      and is right to — its defaults live server-side. Here the app already
 *      holds a complete Hungarian screen, so the button would only ever turn
 *      "nothing stored" into "everything stored".
 *   3. AN EMPTY BOX IS A STATED, CORRECT STATE. Every empty control says so in
 *      words, in the operator's own language, so emptiness never reads as
 *      something waiting to be filled.
 */
export default function PersonaScreensCard({ projection, locked }: Props) {
  const t = useTranslations("personaAdmin.screens");
  const common = useTranslations("common");
  const [state, setState] = useState<LoadState>("loading");
  const [access, setAccess] = useState<PersonaScreensAccess>({ visible: false, editable: false });
  const [console_, setConsole] = useState<PersonaScreensConsole | null>(null);
  const [draft, setDraft] = useState<PersonaScreensDraft | null>(null);
  const [language, setLanguage] = useState<PersonaScreenLanguage>("en");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  /** The exact control Core refused, as its own field path. Cleared as soon as anything is typed. */
  const [refusedField, setRefusedField] = useState<string | null>(null);

  const load = useCallback(async (keepDraft: boolean) => {
    setState((current) => (current === "ready" ? current : "loading"));
    setRefusedField(null);
    const granted = personaScreensAccess(projection.kind === "ok" ? projection.value : null);
    setAccess(granted);
    if (!granted.visible) {
      setConsole(null);
      setDraft(null);
      setState(projection.kind === "unreadable" ? "error" : "closed");
      return;
    }
    const decoded = decodePersonaScreensConsoleResponse(await adminCall("persona_screens_console", {}));
    if (!decoded.ok) {
      setState(decoded.kind === "uncertain" && decoded.error === PERSONA_SCREENS_UNAVAILABLE_ERROR
        ? "unavailable"
        : "error");
      return;
    }
    setConsole(decoded.value);
    // The draft is built from the stored document and nothing else.
    setDraft((current) => (keepDraft && current ? current : personaScreensDraft(decoded.value.copy_default)));
    setState("ready");
  }, [projection]);

  useEffect(() => { void load(false); }, [load]);

  const document_ = useMemo(
    () => (draft ? personaScreensDocumentFromDraft(draft) : null),
    [draft],
  );
  const issues = useMemo(() => (draft ? personaScreensDraftIssues(draft) : []), [draft]);
  const dirty = console_ !== null
    && document_ !== null
    && !personaScreensDocumentsEqual(document_.copy_default, console_.copy_default);
  const editable = access.editable && !locked && !busy;

  function patch(screen: PersonaScreenKey, slot: PersonaScreenSlot, value: string) {
    setDraft((current) => (current
      ? personaScreensDraftWithValue(current, language, screen, slot, value)
      : current));
    setNotice(null);
    setRefusedField(null);
  }

  async function save() {
    if (!console_ || !document_ || !editable) return;
    if (issues.length > 0) {
      setNotice({ tone: "error", text: t("notices.validation") });
      return;
    }
    setBusy(true);
    setNotice(null);
    setRefusedField(null);
    const submitted = { expected_revision: console_.revision, document: document_ };
    const decoded = decodePersonaScreensSaveResponse(
      await adminCall("persona_screens_save", submitted),
      submitted,
    );
    if (decoded.ok) {
      setConsole({ ...console_, revision: decoded.value.revision, copy_default: decoded.value.copy_default });
      setDraft(personaScreensDraft(decoded.value.copy_default));
      setNotice({ tone: "success", text: t("notices.saved", { revision: decoded.value.revision }) });
      setBusy(false);
      return;
    }
    if (decoded.kind === "refused") {
      // A conflict RELOADS and never replays: a save replayed against a
      // document this console has not seen is how two operators silently
      // overwrite each other.
      if (decoded.error === "persona-screens-conflict") {
        setNotice({
          tone: "error",
          text: t("notices.conflict", { revision: decoded.currentRevision ?? console_.revision }),
        });
        setBusy(false);
        await load(false);
        return;
      }
      setRefusedField(decoded.field);
      setNotice({
        tone: "error",
        text: decoded.field
          ? t("notices.refusedField", { code: decoded.error, field: decoded.field })
          : t("notices.refused", { code: decoded.error }),
      });
      setBusy(false);
      return;
    }
    // The write may still have landed: read authoritative state before the
    // operator can press save a second time, and keep their draft to compare.
    setNotice({ tone: "error", text: t("notices.uncertain", { code: decoded.error }) });
    setBusy(false);
    await load(true);
  }

  if (state === "loading") return <LoadingPanel />;
  if (state === "closed") {
    return (
      <section className="panel persona-screens-panel">
        <div className="panel-header">
          <div><h2>{t("title")}</h2><p>{t("copy")}</p></div>
          <span className="badge badge-warning">{t("closed.badge")}</span>
        </div>
        <div className="panel-body"><div className="alert alert-info">{t("closed.detail")}</div></div>
      </section>
    );
  }
  if (state === "unavailable") {
    return (
      <section className="panel persona-screens-panel">
        <div className="panel-header">
          <div><h2>{t("title")}</h2><p>{t("unavailable.copy")}</p></div>
          <span className="badge badge-warning">{t("unavailable.badge")}</span>
        </div>
        <div className="panel-body form-stack">
          <div className="alert alert-warning" role="status">{t("unavailable.detail")}</div>
          <div className="row-actions">
            <button type="button" className="button button-secondary" onClick={() => void load(false)}>
              {common("refresh")}
            </button>
          </div>
        </div>
      </section>
    );
  }
  if (state === "error" || !console_ || !draft || !document_) {
    return <ErrorPanel message={t("loadError")} retry={() => void load(false)} />;
  }

  return (
    <PersonaScreensEditor
      access={access}
      console_={console_}
      draft={draft}
      language={language}
      busy={busy}
      locked={locked}
      notice={notice}
      refusedField={refusedField}
      onLanguage={(entry) => { setLanguage(entry); setRefusedField(null); }}
      onPatch={patch}
      onReload={() => void load(false)}
      onSave={() => void save()}
    />
  );
}

export type PersonaScreensEditorProps = {
  access: PersonaScreensAccess;
  console_: PersonaScreensConsole;
  draft: PersonaScreensDraft;
  language: PersonaScreenLanguage;
  busy: boolean;
  locked: boolean;
  notice: Notice;
  /** Core's own field path for the control it refused, e.g. `copy_default.hu.pre.headline`. */
  refusedField: string | null;
  onLanguage: (language: PersonaScreenLanguage) => void;
  onPatch: (screen: PersonaScreenKey, slot: PersonaScreenSlot, value: string) => void;
  onReload: () => void;
  onSave: () => void;
};

/**
 * The card's whole visible surface, with no state and no network of its own, so
 * `tests/personaScreensEditor.test.mts` can render it and assert what an
 * operator would actually see rather than scanning this file for the shapes it
 * is supposed to contain.
 */
export function PersonaScreensEditor({
  access,
  console_,
  draft,
  language,
  busy,
  locked,
  notice,
  refusedField,
  onLanguage,
  onPatch,
  onReload,
  onSave,
}: PersonaScreensEditorProps) {
  const t = useTranslations("personaAdmin.screens");
  const document_ = personaScreensDocumentFromDraft(draft);
  const issues = personaScreensDraftIssues(draft);
  const dirty = !personaScreensDocumentsEqual(document_.copy_default, console_.copy_default);
  const editable = access.editable && !locked && !busy;

  const reference = console_.compiled_reference;
  const counts = personaScreensSlotCounts(document_.copy_default);
  const totalSlots = PERSONA_SCREEN_KEYS.length * PERSONA_SCREEN_SLOTS.length;

  function slotField(screen: PersonaScreenKey, slot: PersonaScreenSlot) {
    const value = draft[language][screen][slot];
    const path = personaScreenFieldPath({ language, screen, slot });
    const limit = PERSONA_SCREEN_SLOT_BYTE_LIMITS[slot];
    const used = personaScreenSlotByteLength(value);
    const issue = personaScreenSlotIssue(value, slot);
    const refused = refusedField === path;
    const id = `persona-screens-${language}-${screen}-${slot}`;
    const shared = {
      id,
      value,
      disabled: !editable,
      spellCheck: true,
      "aria-invalid": issue !== null || refused,
      "aria-describedby": `${id}-hint`,
      // A REFERENCE, never a value: `compiled_reference` is what the app says
      // today, shown as ghost text so an operator can see it without the
      // console turning "nothing stored" into "everything stored".
      placeholder: reference[language][screen][slot],
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        onPatch(screen, slot, event.target.value),
    };
    return (
      <label className="field persona-screens-field" key={id}>
        <span>{t(`slots.${slot}`)}</span>
        {slot === "subtitle" ? <textarea rows={3} {...shared} /> : <input type="text" {...shared} />}
        {refused && !issue ? (
          <small className="field-error" role="alert">{t("refusedControl")}</small>
        ) : null}
        {issue ? (
          <small className="field-error" role="alert">{t(`issues.${issue}`)}</small>
        ) : null}
        <small
          id={`${id}-hint`}
          className={`field-hint persona-screens-counter${used > limit ? " is-over" : ""}`}
        >
          {value === ""
            ? t("emptyMeans", { language: t(`languages.${language}`) })
            : t("bytes", { used, max: limit })}
        </small>
      </label>
    );
  }

  return (
    <section className="panel persona-screens-panel">
      <div className="panel-header">
        <div><h2>{t("title")}</h2><p>{t("copy")}</p></div>
        <div className="row-actions">
          <span className="badge badge-active">{t("revision", { revision: console_.revision })}</span>
          <span className={`badge ${access.editable ? "badge-active" : "badge-inactive"}`}>
            {access.editable ? t("writer") : t("viewer")}
          </span>
          {dirty ? <span className="badge badge-warning">{t("unsaved")}</span> : null}
        </div>
      </div>

      <div className="panel-body form-stack">
        {notice ? (
          <div className={`alert alert-${notice.tone}`} role="status">{notice.text}</div>
        ) : null}
        {!access.editable ? <div className="alert alert-info">{t("readOnly")}</div> : null}

        <div className="alert alert-info persona-screens-rule">
          <strong>{t("rule.title")}</strong>
          <p>{t("rule.emptyIsCorrect")}</p>
          <p>{t("rule.perLanguage")}</p>
        </div>

        <div className="persona-screens-language" role="group" aria-label={t("languageGroup")}>
          {PERSONA_SCREEN_LANGUAGES.map((entry) => (
            <button
              type="button"
              key={entry}
              className={`button button-small ${language === entry ? "button-primary" : "button-secondary"}`}
              aria-pressed={language === entry}
              onClick={() => onLanguage(entry)}
            >
              {t(`languages.${entry}`)}
              <span className="persona-screens-language-count">
                {t("languageCount", { count: counts[entry], total: totalSlots })}
              </span>
            </button>
          ))}
        </div>

        <p className="field-hint">
          {t("editing", { language: t(`languages.${language}`) })}
        </p>

        {PERSONA_SCREEN_KEYS.map((screen) => {
          const preview = personaScreenPreview(draft, reference, language, screen);
          const operatorSlots = PERSONA_SCREEN_SLOTS
            .filter((slot) => preview[slot].source === "operator");
          return (
            <article className="persona-screens-screen" key={screen}>
              <div className="persona-screens-screen-heading">
                <div>
                  <h3>{t(`screens.${screen}.title`)}</h3>
                  <p className="field-hint">{t(`screens.${screen}.copy`)}</p>
                </div>
                <span className="badge badge-inactive">
                  {t("screenSource", {
                    operator: operatorSlots.length,
                    total: PERSONA_SCREEN_SLOTS.length,
                  })}
                </span>
              </div>
              <div className="persona-screens-screen-body">
                <div className="persona-screens-fields">
                  {PERSONA_SCREEN_SLOTS.map((slot) => slotField(screen, slot))}
                </div>
                <div className="persona-screens-phones">
                  {(["light", "dark"] as const).map((mode) => (
                    <PhoneFrame
                      key={mode}
                      mode={mode}
                      screen={screen}
                      preview={preview}
                      labels={{ mode: t(`appearance.${mode}`), furniture: t(`screens.${screen}.furniture`) }}
                    />
                  ))}
                </div>
              </div>
            </article>
          );
        })}

        <section className="persona-screens-published">
          <h3>{t("published.title")}</h3>
          <p className="field-hint">{t("published.copy")}</p>
          <ul>
            {PERSONA_SCREEN_LANGUAGES.map((entry) => {
              const block = personaScreensPublishedBlock(
                personaScreensForLanguage(document_.copy_default, entry),
                entry,
              );
              const published = PERSONA_SCREEN_KEYS.reduce(
                (total, screen) => total + Object.keys(block.screens[screen] ?? {}).length,
                0,
              );
              return (
                <li key={entry}>
                  {t("published.row", {
                    language: t(`languages.${entry}`),
                    published,
                    compiled: totalSlots - published,
                    total: totalSlots,
                  })}
                </li>
              );
            })}
          </ul>
          <p className="field-hint">{t("published.reference", { authority: console_.reference_authority })}</p>
        </section>

        <div className="persona-screens-save-bar">
          {issues.length > 0 ? (
            <p className="field-error" role="alert">
              {t("issueSummary", {
                count: issues.length,
                field: personaScreenFieldPath(issues[0]),
              })}
            </p>
          ) : null}
          <div className="row-actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={busy || locked}
              onClick={onReload}
            >
              {t("reload")}
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={!editable || !dirty || issues.length > 0}
              onClick={onSave}
            >
              {busy ? t("saving") : t("save")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
