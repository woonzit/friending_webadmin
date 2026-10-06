"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { adminCall, adminUploadProfileIcon, type AdminResponse } from "@/lib/adminClient";
import {
  MODE_CARDS,
  MODE_CARDS_ICON_MAX_DIMENSION,
  MODE_CARDS_PENDING_STORAGE_KEY,
  MODE_CARDS_SUBTITLE_MAX,
  MODE_CARDS_TARGET,
  MODE_CARDS_TITLE_MAX,
  MODE_CARD_LANGUAGES,
  modeCardIconFileError,
  modeCardTextIsValid,
  modeCardsConflictResponse,
  modeCardsConflictSatisfiesPending,
  modeCardsError,
  modeCardsErrorKey,
  modeCardsFieldPointer,
  modeCardsMutationConverged,
  modeCardsMutationResponse,
  modeCardsPendingFrom,
  modeCardsPendingMutation,
  modeCardsPersistBeforeMutation,
  modeCardsShouldRetainMutation,
  modeCardsStateConverged,
  modeCardsStateResponse,
  type ModeCard,
  type ModeCardIcon,
  type ModeCardKey,
  type ModeCardLanguage,
  type ModeCardsPendingMutation,
  type ModeCardsState,
} from "@/lib/modeCards";

type Notice = { tone: "info" | "error" | "success"; text: string } | null;

export type ModeCardDraft = {
  title: Record<ModeCardLanguage, string>;
  subtitle: Record<ModeCardLanguage, string>;
  icon: ModeCardIcon | null;
};

export type ModeCardsDraft = Record<ModeCardKey, ModeCardDraft>;

type ModeCardsEditorProps = {
  draft: ModeCardsDraft;
  busy: boolean;
  pending: boolean;
  /** The leaf Core's last 422 named, so the operator sees WHICH input is wrong. */
  invalidField: string | null;
  onTextChange: (
    card: ModeCardKey,
    slot: "title" | "subtitle",
    language: ModeCardLanguage,
    value: string,
  ) => void;
  onIconChange: (card: ModeCardKey, icon: ModeCardIcon | null) => void;
  onIconError: (card: ModeCardKey, message: string) => void;
  iconErrors: Partial<Record<ModeCardKey, string>>;
  uploading: ModeCardKey | null;
  onUploadingChange: (card: ModeCardKey | null) => void;
};

export function modeCardsDraftFrom(state: ModeCardsState): ModeCardsDraft {
  const draft = {} as ModeCardsDraft;
  for (const card of MODE_CARDS) {
    const served: ModeCard | undefined = state.cards.find((entry) => entry.key === card);
    draft[card] = {
      title: { en: served?.title.en ?? "", hu: served?.title.hu ?? "" },
      subtitle: { en: served?.subtitle.en ?? "", hu: served?.subtitle.hu ?? "" },
      icon: served?.icon ?? null,
    };
  }
  return draft;
}

export function modeCardsDraftIsValid(draft: ModeCardsDraft): boolean {
  return MODE_CARDS.every((card) => MODE_CARD_LANGUAGES.every((language) =>
    modeCardTextIsValid(draft[card].title[language], MODE_CARDS_TITLE_MAX)
    && modeCardTextIsValid(draft[card].subtitle[language], MODE_CARDS_SUBTITLE_MAX)));
}

/**
 * Renderable on its own so the two cards, the icon preview and the per-leaf
 * refusal pointer stay covered without network effects.
 *
 * The preview is the point of the section: D-115 asks for the BARE PNG, no
 * rounded background, as tall as the title+subtitle block, with equal top,
 * bottom and left insets. The markup therefore puts the icon and the text in
 * one row whose height the text defines, and `app/globals.css` gives the row a
 * single inset token so the three distances cannot drift apart.
 */
export function ModeCardsEditor({
  draft,
  busy,
  pending,
  invalidField,
  onTextChange,
  onIconChange,
  onIconError,
  iconErrors,
  uploading,
  onUploadingChange,
}: ModeCardsEditorProps) {
  const t = useTranslations("appearance.modeSwitcher");

  async function chooseIcon(card: ModeCardKey, file: File) {
    const problem = await modeCardIconFileError(file);
    if (problem) {
      onIconError(card, t(`icon.errors.${problem}`));
      return;
    }
    onIconError(card, "");
    onUploadingChange(card);
    const response = await adminUploadProfileIcon(file);
    onUploadingChange(null);
    if (!response?.success
      || typeof response.media_url !== "string"
      || response.mime !== "image/png") {
      onIconError(card, t("icon.errors.upload"));
      return;
    }
    onIconChange(card, { url: response.media_url, mime: "image/png" });
  }

  return (
    <div className="mode-card-list">
      {MODE_CARDS.map((card) => (
        <article className="mode-card-editor" key={card} data-mode-card={card}>
          <header className="mode-card-editor-header">
            <h3>{t(`cards.${card}`)}</h3>
            <p>{t(`cardsCopy.${card}`)}</p>
          </header>

          <div className="mode-card-preview" data-testid={`mode-card-preview-${card}`}>
            {draft[card].icon
              ? (
                <img
                  className="mode-card-preview-icon"
                  src={draft[card].icon!.url}
                  alt=""
                  aria-hidden="true"
                />
              )
              : <span className="mode-card-preview-icon mode-card-preview-empty" aria-hidden="true" />}
            <div className="mode-card-preview-text">
              <strong>{draft[card].title.hu || t("preview.untitled")}</strong>
              <span>{draft[card].subtitle.hu || t("preview.nosubtitle")}</span>
            </div>
          </div>
          <p className="mode-card-preview-note">{t("preview.note")}</p>

          <div className="mode-card-icon">
            <label className="field-label" htmlFor={`mode-card-icon-${card}`}>
              {t("icon.label")}
            </label>
            <p className="field-hint">
              {t("icon.hint", { max: MODE_CARDS_ICON_MAX_DIMENSION })}
            </p>
            <input
              id={`mode-card-icon-${card}`}
              type="file"
              accept="image/png"
              disabled={busy || uploading !== null}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void chooseIcon(card, file);
              }}
            />
            <button
              type="button"
              className="text-button"
              disabled={busy || uploading !== null || draft[card].icon === null}
              onClick={() => {
                onIconError(card, "");
                onIconChange(card, null);
              }}
            >
              {t("icon.remove")}
            </button>
            {uploading === card && <span className="field-hint">{t("icon.uploading")}</span>}
            {iconErrors[card]
              ? <small className="image-upload-error" role="alert">{iconErrors[card]}</small>
              : null}
          </div>

          {(["title", "subtitle"] as const).map((slot) => (
            <div className="mode-card-fields" key={slot}>
              {MODE_CARD_LANGUAGES.map((language) => {
                const field = `cards.${card}.${slot}.${language}`;
                const value = draft[card][slot][language];
                const max = slot === "title" ? MODE_CARDS_TITLE_MAX : MODE_CARDS_SUBTITLE_MAX;
                const invalid = invalidField === field
                  || invalidField === `cards.${card}.${slot}`
                  || !modeCardTextIsValid(value, max);
                return (
                  <div className="field" key={language}>
                    <label className="field-label" htmlFor={`mode-card-${card}-${slot}-${language}`}>
                      {t(`fields.${slot}.${language}`)}
                    </label>
                    <input
                      id={`mode-card-${card}-${slot}-${language}`}
                      type="text"
                      value={value}
                      disabled={busy || pending}
                      aria-invalid={invalid ? "true" : undefined}
                      onChange={(event) => onTextChange(card, slot, language, event.target.value)}
                    />
                    <span className="field-hint">
                      {t("fields.counter", { count: [...value].length, max })}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}

function newRequestId(): string | null {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return null;
  }
}

export default function ModeCardsPanel() {
  const t = useTranslations("appearance.modeSwitcher");
  const common = useTranslations("common");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [current, setCurrent] = useState<ModeCardsState | null>(null);
  const [draft, setDraft] = useState<ModeCardsDraft | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const [iconErrors, setIconErrors] = useState<Partial<Record<ModeCardKey, string>>>({});
  const [uploading, setUploading] = useState<ModeCardKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ModeCardsPendingMutation | null>(null);
  const pendingRef = useRef<ModeCardsPendingMutation | null>(null);
  const loadSequenceRef = useRef(0);

  const clearPending = useCallback((): boolean => {
    try {
      window.sessionStorage.removeItem(MODE_CARDS_PENDING_STORAGE_KEY);
    } catch {
      return false;
    }
    pendingRef.current = null;
    setPending(null);
    return true;
  }, []);

  const load = useCallback(async (keepDraft = false) => {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    const response = await adminCall("mode_cards_get", { contract_version: 1 });
    if (sequence !== loadSequenceRef.current) return;
    const parsed = modeCardsStateResponse(response);
    if (!parsed) {
      const error = modeCardsError(response);
      // A malformed read is an error, never two proven empty cards.
      setCurrent(null);
      setState("error");
      setNotice({
        tone: "error",
        text: error
          ? t("live.errorCode", { message: t(`errors.${modeCardsErrorKey(error)}`) })
          : t("live.unknownError"),
      });
      return;
    }
    setCurrent(parsed);
    if (!keepDraft) setDraft(modeCardsDraftFrom(parsed));
    const candidate = pendingRef.current;
    if (candidate && modeCardsStateConverged(candidate, parsed)) {
      const cleared = clearPending();
      if (cleared) setDraft(modeCardsDraftFrom(parsed));
      setNotice({
        tone: cleared ? "success" : "error",
        text: cleared ? t("live.converged") : t("live.persistenceCleanupFailed"),
      });
    }
    setState("ready");
  }, [clearPending, t]);

  useEffect(() => {
    try {
      const serialized = window.sessionStorage.getItem(MODE_CARDS_PENDING_STORAGE_KEY);
      if (serialized) {
        const restored = modeCardsPendingFrom(JSON.parse(serialized));
        if (restored) {
          pendingRef.current = restored;
          setPending(restored);
        } else {
          window.sessionStorage.removeItem(MODE_CARDS_PENDING_STORAGE_KEY);
        }
      }
    } catch {
      setNotice({ tone: "error", text: t("live.persistenceUnavailable") });
    }
    void load();
  }, [load, t]);

  async function submit() {
    if (busy || uploading !== null || !current || !draft) return;
    const existing = pendingRef.current;
    let command: ModeCardsPendingMutation | null = existing;
    if (!command) {
      if (!modeCardsDraftIsValid(draft)) {
        setNotice({ tone: "error", text: t("live.draftInvalid") });
        return;
      }
      const requestId = newRequestId();
      if (!requestId) {
        setNotice({ tone: "error", text: t("live.requestIdUnavailable") });
        return;
      }
      command = modeCardsPendingMutation(MODE_CARDS_TARGET, {
        contract_version: 1,
        cards: Object.fromEntries(MODE_CARDS.map((card) => [card, {
          title: { ...draft[card].title },
          subtitle: { ...draft[card].subtitle },
          icon: draft[card].icon,
        }])),
        expected_revision: current.revision,
        request_id: requestId,
      });
      if (!command) {
        setNotice({ tone: "error", text: t("live.draftInvalid") });
        return;
      }
    }

    setBusy(true);
    setNotice(null);
    setInvalidField(null);
    let response: AdminResponse | null;
    if (existing) {
      // Never mint a second request id: the retry is the SAME command.
      response = await adminCall(existing.action, existing.payload);
    } else {
      const issued = command;
      const persisted = await modeCardsPersistBeforeMutation(
        window.sessionStorage,
        issued,
        () => {
          pendingRef.current = issued;
          setPending(issued);
          return adminCall(issued.action, issued.payload);
        },
      );
      if (!persisted.ok) {
        setBusy(false);
        setNotice({ tone: "error", text: t("live.persistenceUnavailable") });
        return;
      }
      response = persisted.response;
    }

    const result = modeCardsMutationResponse(response);
    if (result && modeCardsMutationConverged(command, result)) {
      const cleared = clearPending();
      if (cleared) {
        // A completed replay carries historical canonical bytes. A fresh read
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

    const conflict = modeCardsConflictResponse(response);
    if (conflict) {
      const satisfied = modeCardsConflictSatisfiesPending(command, conflict);
      // The conflict body IS the authoritative state, so the reload costs no
      // round trip: adopt it and rebuild the draft from what is stored now.
      setCurrent(conflict.current);
      setDraft(modeCardsDraftFrom(conflict.current));
      const cleared = clearPending();
      setNotice({
        tone: cleared ? (satisfied ? "info" : "error") : "error",
        text: cleared
          ? t(satisfied ? "live.conflictAlreadyApplied" : "live.conflict")
          : t("live.persistenceCleanupFailed"),
      });
      setBusy(false);
      return;
    }

    // A malformed conflict and any illegal data-bearing refusal decode as
    // unknown, so this branch retains the exact durable identity.
    const error = modeCardsError(response);
    setInvalidField(modeCardsFieldPointer(response));
    if (!modeCardsShouldRetainMutation(error)) {
      if (!clearPending()) {
        setNotice({ tone: "error", text: t("live.persistenceCleanupFailed") });
        setBusy(false);
        return;
      }
    }
    setNotice({
      tone: "error",
      text: error
        ? t("live.errorCode", { message: t(`errors.${modeCardsErrorKey(error)}`) })
        : t("live.unknownError"),
    });
    setBusy(false);
  }

  return (
    <section className="panel mode-cards-panel" id="mode-switcher">
      <div className="panel-header">
        <div>
          <h2>{t("title")}</h2>
          <p>{t("subtitle")}</p>
        </div>
        {state === "ready" && (
          <button
            type="button"
            className="primary-button"
            disabled={busy || uploading !== null || draft === null}
            onClick={() => void submit()}
          >
            {pending ? t("retry") : common("save")}
          </button>
        )}
      </div>
      {state === "loading" && <p>{common("loading")}</p>}
      {state === "error" && (
        <div className="alert alert-warning" role="alert">
          <p>{t("loadError")}</p>
          <button type="button" className="text-button" onClick={() => void load()}>
            {common("retry")}
          </button>
        </div>
      )}
      {state === "ready" && draft && (
        <>
          {pending && <p className="field-hint">{t("live.pending")}</p>}
          <ModeCardsEditor
            draft={draft}
            busy={busy}
            pending={false}
            invalidField={invalidField}
            iconErrors={iconErrors}
            uploading={uploading}
            onUploadingChange={setUploading}
            onIconError={(card, message) =>
              setIconErrors((value) => ({ ...value, [card]: message }))}
            onIconChange={(card, icon) =>
              setDraft((value) => (value ? { ...value, [card]: { ...value[card], icon } } : value))}
            onTextChange={(card, slot, language, next) =>
              setDraft((value) => (value
                ? {
                  ...value,
                  [card]: {
                    ...value[card],
                    [slot]: { ...value[card][slot], [language]: next },
                  },
                }
                : value))}
          />
          <p className="field-hint">
            {t("revision", { revision: current?.revision ?? 0 })}
          </p>
        </>
      )}
      {notice && (
        <p
          className={`field-hint mode-cards-notice mode-cards-notice-${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      )}
    </section>
  );
}
