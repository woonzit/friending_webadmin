"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import PageHeader from "@/components/PageHeader";
import { ErrorPanel, LoadingPanel } from "@/components/StatePanel";
import AdminImageEditor from "@/components/AdminImageEditor";
import { adminCall } from "@/lib/adminClient";
import { avatarUrl, formatDate } from "@/lib/format";

type SafeSearchScan = {
  state: string;
  provider: string;
  policy_version: number;
  checked_at: number;
  likelihoods: Record<string, string>;
  reasons: string[];
  error_category: string;
};

type QueueItem = {
  id: string;
  created: number;
  data: {
    id: string;
    type: string;
    original: string;
    thumbnail: string;
    userId: number;
    userName: string;
    scan: SafeSearchScan | null;
    mediaScope: ModerationScope;
    albumName: string;
    albumPrivate: boolean;
  };
};

type ModerationScope = "profile" | "private_album" | "public_album";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseScan(value: unknown): SafeSearchScan | null {
  const source = record(value);
  const likelihoods = record(source?.likelihoods);
  if (!source || !likelihoods) return null;
  return {
    state: typeof source.state === "string" ? source.state : "review",
    provider: typeof source.provider === "string" ? source.provider : "",
    policy_version: Number(source.policy_version) || 0,
    checked_at: Number(source.checked_at) || 0,
    likelihoods: Object.fromEntries(Object.entries(likelihoods).flatMap(([key, item]) => (
      typeof item === "string" ? [[key, item]] : []
    ))),
    reasons: Array.isArray(source.reasons)
      ? source.reasons.filter((item): item is string => typeof item === "string").slice(0, 10)
      : [],
    error_category: typeof source.error_category === "string" ? source.error_category : "",
  };
}

function displayName(value: unknown, fallback: string): string {
  const source = record(value);
  const direct = typeof source?.value === "string" ? source.value.trim() : "";
  return direct || fallback;
}

function profileImageUrl(value: unknown): string {
  const candidate = avatarUrl(value);
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" && parsed.hostname === "img.friending.co"
      ? parsed.toString()
      : "";
  } catch {
    return "";
  }
}

function parseQueue(value: unknown): QueueItem[] | null {
  if (value === null) return [];
  if (!Array.isArray(value) || value.length > 100) return null;
  const rows: QueueItem[] = [];
  for (const item of value) {
    const source = record(item);
    const data = record(source?.data);
    const user = record(data?.user);
    const id = typeof data?.id === "string" ? data.id : "";
    const original = profileImageUrl(data?.original);
    const thumbnail = profileImageUrl(data?.thumbnail);
    const userId = Number(user?.id);
    if (!source || !data || !/^[a-f0-9]{24}$/i.test(id) || !original || !thumbnail) {
      return null;
    }
    rows.push({
      id,
      created: Number(source.created) || 0,
      data: {
        id,
        type: typeof data.type === "string" ? data.type : "image",
        original,
        thumbnail,
        userId: Number.isInteger(userId) && userId > 0 ? userId : 0,
        userName: displayName(user?.displayname, userId > 0 ? `#${userId}` : "—"),
        scan: parseScan(data.moderation_scan),
        mediaScope: data.media_scope === "private_album" || data.media_scope === "public_album"
          ? data.media_scope
          : "profile",
        albumName: typeof data.album_name === "string" ? data.album_name.slice(0, 80) : "",
        albumPrivate: data.album_private === true,
      },
    });
  }
  return rows;
}

export default function PhotoModerationPage() {
  const t = useTranslations("photoModeration");
  const common = useTranslations("common");
  const editor = useTranslations("imageEditor");
  const locale = useLocale();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [scope, setScope] = useState<ModerationScope>("profile");
  const [editing, setEditing] = useState<{ uid: number; imageId: string; mode: "replace" | "square" } | null>(null);

  const load = useCallback(async () => {
    setState((current) => items.length === 0 || current === "error" ? "loading" : current);
    const response = await adminCall("moderation_pic_list", { media_scope: scope });
    const parsed = response?.success ? parseQueue(response.data) : null;
    if (!parsed) {
      setState("error");
      return;
    }
    setItems(parsed);
    setState("ready");
  }, [items.length, scope]);

  useEffect(() => { void load(); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  async function decide(item: QueueItem, action: "accept" | "deny") {
    if (busy) return;
    if (action === "deny" && !window.confirm(t("rejectConfirm"))) return;
    setBusy(item.id);
    setNotice(null);
    const response = await adminCall("moderation_image_action", {
      image_id: item.id,
      image_action: action,
      avatar_type: "profile",
    });
    setBusy("");
    if (!response?.success) {
      setNotice({ tone: "error", text: t("actionError") });
      return;
    }
    setItems((current) => current.filter((row) => row.id !== item.id));
    setNotice({ tone: "success", text: t(action === "accept" ? "approved" : "rejected") });
  }

  return (
    <>
      {editing ? (
        <AdminImageEditor
          uid={editing.uid}
          imageId={editing.imageId}
          mode={editing.mode}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            // Core marks a replaced picture accepted, so it leaves this queue.
            setNotice({ tone: "success", text: editor("saved") });
            void load();
          }}
        />
      ) : null}
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} subtitle={t("subtitle")} />
      <div className="photo-moderation-toolbar">
        <div className="photo-moderation-tabs" role="tablist" aria-label={t("scopeLabel")}>
          {(["profile", "private_album", "public_album"] as const).map((item) => (
            <button type="button" role="tab" aria-selected={scope === item} className={scope === item ? "is-active" : ""} key={item} onClick={() => setScope(item)}>{t(`scopes.${item}`)}</button>
          ))}
        </div>
        <span>{t("queueCount", { count: items.length })}</span>
        <button type="button" className="button button-secondary" disabled={Boolean(busy)} onClick={() => void load()}>{common("refresh")}</button>
      </div>
      {notice ? <div className={`alert ${notice.tone === "success" ? "alert-success" : "alert-error"} page-alert`} role="status">{notice.text}</div> : null}
      {state === "loading" ? <LoadingPanel /> : state === "error" ? <ErrorPanel message={t("loadError")} retry={() => void load()} /> : items.length === 0 ? (
        <div className="empty-state photo-moderation-empty"><div className="empty-state-inner"><h3>{t("empty")}</h3><p>{t("emptyCopy")}</p></div></div>
      ) : (
        <div className="photo-moderation-grid">
          {items.map((item) => {
            const scan = item.data.scan;
            return (
              <article className="photo-moderation-card" key={item.id}>
                <a href={item.data.original} target="_blank" rel="noopener noreferrer" className="photo-moderation-image">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.data.thumbnail || item.data.original} alt={t("imageAlt", { name: item.data.userName })} loading="lazy" />
                  <span>{t("openOriginal")}</span>
                </a>
                <div className="photo-moderation-copy">
                  <header>
                    <div><strong>{item.data.userName}</strong><small>{item.data.albumName || t(`scopes.${item.data.mediaScope}`)} · {item.created ? formatDate(item.created, locale, true) : "—"}</small></div>
                    {item.data.userId > 0 ? <Link href={`/users/${item.data.userId}`} className="button button-secondary button-small">{t("openUser")}</Link> : null}
                  </header>
                  <div className="photo-moderation-scan">
                    <div className="photo-moderation-scan-title"><strong>{t("safeSearch")}</strong><span className={`badge ${scan?.state === "safe" ? "badge-active" : "badge-warning"}`}>{scan ? t(`states.${scan.state === "safe" ? "safe" : "review"}`) : t("states.notScanned")}</span></div>
                    {scan?.error_category ? <p className="photo-moderation-scan-error">{t("scanError", { error: scan.error_category })}</p> : null}
                    {scan ? <dl>{Object.entries(scan.likelihoods).map(([key, value]) => <div key={key}><dt>{t(`categories.${key}`)}</dt><dd>{value.replaceAll("_", " ")}</dd></div>)}</dl> : <p>{t("legacyPending")}</p>}
                    {scan?.reasons.length ? <div className="photo-moderation-reasons">{scan.reasons.map((reason) => <span key={reason}>{reason.replaceAll("_", " ")}</span>)}</div> : null}
                  </div>
                  <footer>
                    {/* Needs the owning uid: Core scopes the replacement to that
                        member's gallery and refuses an image it does not own. */}
                    {item.data.userId > 0 ? (
                      <>
                        <button type="button" className="button button-secondary" disabled={Boolean(busy)} onClick={() => setEditing({ uid: item.data.userId, imageId: item.id, mode: "replace" })}>{editor("edit")}</button>
                        <button type="button" className="button button-secondary" disabled={Boolean(busy)} onClick={() => setEditing({ uid: item.data.userId, imageId: item.id, mode: "square" })}>{editor("squareEdit")}</button>
                      </>
                    ) : null}
                    <button type="button" className="button button-danger" disabled={Boolean(busy)} onClick={() => void decide(item, "deny")}>{busy === item.id ? common("loading") : t("reject")}</button>
                    <button type="button" className="button button-primary" disabled={Boolean(busy)} onClick={() => void decide(item, "accept")}>{busy === item.id ? common("loading") : t("approve")}</button>
                  </footer>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
