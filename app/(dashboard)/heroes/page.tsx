"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import ConfirmDialog from "@/components/ConfirmDialog";
import ImageUploadField from "@/components/ImageUploadField";
import PageHeader from "@/components/PageHeader";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import { adminCall } from "@/lib/adminClient";
import { isHttpsUrl } from "@/lib/format";

type Hero = {
  id: string;
  media_url: string;
  type: "image" | "video";
  forward_url: string;
  title_en: string;
  title_hu: string;
  subtitle_en: string;
  subtitle_hu: string;
  link_title_en: string;
  link_title_hu: string;
  title_size_web: number;
  title_color_web: string;
  title_weight_web: string;
  subtitle_size_web: number;
  subtitle_color_web: string;
  subtitle_weight_web: string;
  title_size_mobile: number;
  title_color_mobile: string;
  title_weight_mobile: string;
  subtitle_size_mobile: number;
  subtitle_color_mobile: string;
  subtitle_weight_mobile: string;
  sort_order: number;
  active: boolean;
  created_at: number;
  updated_at: number;
};

const EMPTY_HERO: Hero = {
  id: "",
  media_url: "",
  type: "image",
  forward_url: "",
  title_en: "",
  title_hu: "",
  subtitle_en: "",
  subtitle_hu: "",
  link_title_en: "",
  link_title_hu: "",
  title_size_web: 0,
  title_color_web: "",
  title_weight_web: "",
  subtitle_size_web: 0,
  subtitle_color_web: "",
  subtitle_weight_web: "",
  title_size_mobile: 0,
  title_color_mobile: "",
  title_weight_mobile: "",
  subtitle_size_mobile: 0,
  subtitle_color_mobile: "",
  subtitle_weight_mobile: "",
  sort_order: 10,
  active: true,
  created_at: 0,
  updated_at: 0,
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const TEXT_WEIGHTS = ["", "normal", "semibold", "bold"] as const;

type StylePlatform = "web" | "mobile";
type StyleText = "title" | "subtitle";

function validTextStyle(hero: Hero): boolean {
  return (["web", "mobile"] as StylePlatform[]).every((platform) =>
    (["title", "subtitle"] as StyleText[]).every((text) => {
      const size = hero[`${text}_size_${platform}`];
      const color = hero[`${text}_color_${platform}`];
      const weight = hero[`${text}_weight_${platform}`];
      return (size === 0 || (Number.isInteger(size) && size >= 10 && size <= 120))
        && (color === "" || HEX_COLOR.test(color))
        && (TEXT_WEIGHTS as readonly string[]).includes(weight);
    }));
}

function HeroStyleFields({
  value,
  platform,
  disabled,
  onChange,
}: {
  value: Hero;
  platform: StylePlatform;
  disabled: boolean;
  onChange: (value: Hero) => void;
}) {
  const t = useTranslations("heroes");
  return (
    <>
      {(["title", "subtitle"] as StyleText[]).map((text) => {
        const sizeKey = `${text}_size_${platform}` as const;
        const colorKey = `${text}_color_${platform}` as const;
        const weightKey = `${text}_weight_${platform}` as const;
        const color = value[colorKey];
        return (
          <div className="field" key={`${platform}-${text}`}>
            <span>{t(platform)} · {t(text === "title" ? "titleStyle" : "subtitleStyle")}</span>
            <div className="hero-style-controls">
              <input
                type="number"
                min={10}
                max={120}
                value={value[sizeKey] || ""}
                disabled={disabled}
                placeholder={t("sizeDefault")}
                aria-label={`${t(platform)} ${t(text === "title" ? "titleStyle" : "subtitleStyle")} ${t("sizePx")}`}
                onChange={(event) => onChange({
                  ...value,
                  [sizeKey]: Math.max(0, Math.min(120, Math.trunc(Number(event.target.value) || 0))),
                })}
              />
              <select
                value={value[weightKey]}
                disabled={disabled}
                aria-label={`${t(platform)} ${t(text === "title" ? "titleStyle" : "subtitleStyle")} ${t("weightLabel")}`}
                onChange={(event) => onChange({ ...value, [weightKey]: event.target.value })}
              >
                <option value="">{t("weightDefault")}</option>
                <option value="normal">{t("weightNormal")}</option>
                <option value="semibold">{t("weightSemibold")}</option>
                <option value="bold">{t("weightBold")}</option>
              </select>
              <div className="landing-color-control">
                <input
                  type="color"
                  value={HEX_COLOR.test(color) ? color : "#ffffff"}
                  disabled={disabled}
                  aria-label={`${t(platform)} ${t(text === "title" ? "titleStyle" : "subtitleStyle")} ${t("colorHex")}`}
                  onChange={(event) => onChange({ ...value, [colorKey]: event.target.value.toLowerCase() })}
                />
                <input
                  type="text"
                  value={color}
                  maxLength={7}
                  spellCheck={false}
                  disabled={disabled}
                  placeholder={t("colorDefault")}
                  onChange={(event) => onChange({ ...value, [colorKey]: event.target.value.trim().toLowerCase() })}
                />
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

function HeroDialog({
  value,
  busy,
  error,
  onChange,
  onClose,
  onSave,
}: {
  value: Hero;
  busy: boolean;
  error: string;
  onChange: (value: Hero) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const t = useTranslations("heroes");
  const common = useTranslations("common");
  const [uploading, setUploading] = useState(false);
  const locked = busy || uploading;

  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !locked) onClose();
    }
    document.addEventListener("keydown", keyDown);
    return () => document.removeEventListener("keydown", keyDown);
  }, [locked, onClose]);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !locked) onClose();
    }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="hero-dialog-title">
        <div className="dialog-header">
          <h2 id="hero-dialog-title">{value.id ? t("editTitle") : t("createTitle")}</h2>
          <button className="dialog-close" onClick={onClose} disabled={locked} aria-label={common("close")}>×</button>
        </div>
        <div className="dialog-body form-grid">
          <label className="field">
            <span>{t("mediaType")}</span>
            <select
              value={value.type}
              autoFocus
              disabled={locked}
              onChange={(event) => {
                const type = event.target.value as Hero["type"];
                onChange({
                  ...value,
                  type,
                  media_url: type === value.type ? value.media_url : "",
                });
              }}
            >
              <option value="image">{t("image")}</option>
              <option value="video">{t("video")}</option>
            </select>
          </label>
          <label className="field">
            <span>{t("sortOrder")}</span>
            <input
              type="number"
              min="0"
              max="10000"
              value={value.sort_order}
              onChange={(event) => onChange({ ...value, sort_order: Number(event.target.value) || 0 })}
            />
          </label>
          {value.type === "image" ? (
            <ImageUploadField
              className="field-full"
              label={t("campaignImage")}
              value={value.media_url}
              required
              disabled={busy}
              hint={t("campaignImageHint")}
              onBusyChange={setUploading}
              onChange={(mediaUrl) => onChange({ ...value, media_url: mediaUrl })}
            />
          ) : (
            <label className="field field-full">
              <span>{t("videoUrl")}</span>
              <input
                type="url"
                inputMode="url"
                value={value.media_url}
                onChange={(event) => onChange({ ...value, media_url: event.target.value.slice(0, 2048) })}
                placeholder="https://cdn.example.com/campaign.mp4"
              />
              <small className="field-hint">{t("videoUrlHint")}</small>
            </label>
          )}
          <label className="field field-full">
            <span>{t("destinationUrl")}</span>
            <input
              type="url"
              inputMode="url"
              value={value.forward_url}
              onChange={(event) => onChange({ ...value, forward_url: event.target.value.slice(0, 2048) })}
              placeholder="https://friending.com/campaign"
            />
            <small className="field-hint">{t("destinationUrlHint")}</small>
          </label>
          <label className="field">
            <span>{t("linkTitleEn")}</span>
            <input value={value.link_title_en} maxLength={80} onChange={(event) => onChange({ ...value, link_title_en: event.target.value })} />
            <small className="field-hint">{t("linkTitleHint")}</small>
          </label>
          <label className="field">
            <span>{t("linkTitleHu")}</span>
            <input value={value.link_title_hu} maxLength={80} onChange={(event) => onChange({ ...value, link_title_hu: event.target.value })} />
          </label>
          <label className="field">
            <span>{t("titleEn")}</span>
            <input value={value.title_en} maxLength={160} onChange={(event) => onChange({ ...value, title_en: event.target.value })} />
          </label>
          <label className="field">
            <span>{t("titleHu")}</span>
            <input value={value.title_hu} maxLength={160} onChange={(event) => onChange({ ...value, title_hu: event.target.value })} />
          </label>
          <label className="field">
            <span>{t("subtitleEn")}</span>
            <input value={value.subtitle_en} maxLength={160} onChange={(event) => onChange({ ...value, subtitle_en: event.target.value })} />
          </label>
          <label className="field">
            <span>{t("subtitleHu")}</span>
            <input value={value.subtitle_hu} maxLength={160} onChange={(event) => onChange({ ...value, subtitle_hu: event.target.value })} />
          </label>
          <div className="field-full hero-typography-head">
            <strong>{t("typography")}</strong>
            <small className="field-hint">{t("typographyHint")}</small>
          </div>
          <HeroStyleFields value={value} platform="web" disabled={locked} onChange={onChange} />
          <HeroStyleFields value={value} platform="mobile" disabled={locked} onChange={onChange} />
          <label className="checkbox-field field-full">
            <input type="checkbox" checked={value.active} onChange={(event) => onChange({ ...value, active: event.target.checked })} />
            <span>{t("isActive")}</span>
          </label>
          {error && <div className="alert alert-error field-full" role="alert">{error}</div>}
        </div>
        <div className="dialog-actions">
          <button className="button button-secondary" onClick={onClose} disabled={locked}>{common("cancel")}</button>
          <button className="button button-primary" onClick={onSave} disabled={locked}>
            {busy ? common("saving") : common("save")}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function HeroesPage() {
  const t = useTranslations("heroes");
  const common = useTranslations("common");
  const [rows, setRows] = useState<Hero[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [draft, setDraft] = useState<Hero | null>(null);
  const [deleting, setDeleting] = useState<Hero | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    if (rows.length === 0) setState("loading");
    const response = await adminCall("list_hero");
    if (!response?.success || !Array.isArray(response.data)) {
      setState("error");
      return;
    }
    setRows((response.data as Hero[]).sort((a, b) => a.sort_order - b.sort_order));
    setState("ready");
  }, [rows.length]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const activeCount = useMemo(() => rows.filter((row) => row.active).length, [rows]);

  async function save() {
    if (!draft) return;
    if (!isHttpsUrl(draft.media_url) || !isHttpsUrl(draft.forward_url, true)) {
      setFormError(t("invalidUrl"));
      return;
    }
    if (!validTextStyle(draft)) {
      setFormError(t("invalidTextStyle"));
      return;
    }
    setBusy(true);
    setFormError("");
    const response = await adminCall("save_hero", draft);
    setBusy(false);
    if (!response?.success || !response.hero) {
      setFormError(t("saveError"));
      return;
    }
    const saved = response.hero as Hero;
    setRows((current) => [...current.filter((row) => row.id !== saved.id), saved].sort((a, b) => a.sort_order - b.sort_order));
    setDraft(null);
    setToast({ tone: "success", text: t("updated") });
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    const response = await adminCall("delete_hero", { id: deleting.id });
    setBusy(false);
    if (!response?.success) {
      setToast({ tone: "error", text: t("deleteError") });
      setDeleting(null);
      return;
    }
    setRows((current) => current.filter((row) => row.id !== deleting.id));
    setDeleting(null);
    setToast({ tone: "success", text: t("deleted") });
  }

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={<button className="button button-primary" onClick={() => { setFormError(""); setDraft({ ...EMPTY_HERO, sort_order: (rows.at(-1)?.sort_order ?? 0) + 10 }); }}>{t("newCampaign")}</button>}
      />
      <div className="list-summary">
        <strong>{t("activeCount", { active: activeCount, total: rows.length })}</strong>
      </div>
      {state === "loading" ? <LoadingPanel /> : state === "error" ? (
        <ErrorPanel message={t("loadError")} retry={load} />
      ) : rows.length === 0 ? (
        <EmptyPanel title={t("empty")} copy={t("emptyCopy")} />
      ) : (
        <section className="hero-list">
          {rows.map((row) => (
            <article className="hero-card" key={row.id}>
              <div className="hero-media">
                {row.type === "video" ? (
                  <video src={row.media_url} muted controls preload="metadata" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={row.media_url} alt="" loading="lazy" />
                )}
                {(row.title_en || row.subtitle_en) && (
                  <div className="hero-media-overlay">
                    {row.title_en && <strong>{row.title_en}</strong>}
                    {row.subtitle_en && <span>{row.subtitle_en}</span>}
                  </div>
                )}
              </div>
              <div className="hero-card-body">
                <div className="hero-meta">
                  <span className={`badge ${row.active ? "badge-active" : "badge-inactive"}`}>
                    {row.active ? common("active") : common("inactive")}
                  </span>
                  <span className="badge">#{row.sort_order} · {row.type === "video" ? t("video") : t("image")}</span>
                </div>
                <span className="hero-url" title={row.forward_url || row.media_url}>{row.forward_url || row.media_url}</span>
                <div className="row-actions">
                  <button className="button button-secondary button-small" onClick={() => { setFormError(""); setDraft({ ...row }); }}>{common("edit")}</button>
                  <button className="button button-danger button-small" onClick={() => setDeleting(row)}>{common("delete")}</button>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
      {draft && (
        <HeroDialog
          value={draft}
          busy={busy}
          error={formError}
          onChange={setDraft}
          onClose={() => { if (!busy) setDraft(null); }}
          onSave={() => void save()}
        />
      )}
      {deleting && (
        <ConfirmDialog
          busyLabel={common("deleting")}
          title={t("deleteTitle")}
          copy={t("deleteCopy")}
          confirmLabel={common("delete")}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove()}
        />
      )}
      {toast && <div className={`toast${toast.tone === "error" ? " toast-error" : ""}`} role={toast.tone === "error" ? "alert" : "status"}>{toast.text}</div>}
    </>
  );
}
