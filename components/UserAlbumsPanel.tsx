"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { adminCall } from "@/lib/adminClient";
import { parseProfilePhotoInsights, type ProfilePhotoInsights } from "@/lib/profilePresentation";
import AdminImageEditor from "@/components/AdminImageEditor";

type AlbumImage = { id: string; thumbnail_url: string; full_url: string; status: string; media_scope: string };
type Album = { id: string; kind: string; name: string; private: boolean; protected: boolean; images: AlbumImage[] };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function httpsImage(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "img.friending.co" ? url.toString() : "";
  } catch {
    return "";
  }
}

function parseAlbums(value: unknown): Album[] | null {
  const source = record(value);
  if (!source || !Array.isArray(source.albums) || source.albums.length > 24) return null;
  const result: Album[] = [];
  for (const rawAlbum of source.albums) {
    const album = record(rawAlbum);
    if (!album || typeof album.id !== "string" || !/^[a-f0-9]{24}$/i.test(album.id) || !Array.isArray(album.images)) return null;
    const images: AlbumImage[] = [];
    for (const rawImage of album.images) {
      const image = record(rawImage);
      const id = typeof image?.id === "string" ? image.id : "";
      const thumbnail = httpsImage(image?.thumbnail_url);
      const full = httpsImage(image?.full_url);
      if (!/^[a-f0-9]{24}$/i.test(id) || (!thumbnail && !full)) return null;
      images.push({
        id,
        thumbnail_url: thumbnail,
        full_url: full,
        status: typeof image?.status === "string" ? image.status : "pending",
        media_scope: typeof image?.media_scope === "string" ? image.media_scope : "profile",
      });
    }
    result.push({
      id: album.id,
      kind: typeof album.kind === "string" ? album.kind : "custom",
      name: typeof album.name === "string" ? album.name : "Album",
      private: album.private === true,
      protected: album.protected === true,
      images,
    });
  }
  return result;
}

export default function UserAlbumsPanel({ uid }: { uid: number }) {
  const t = useTranslations("userDetail");
  const editor = useTranslations("imageEditor");
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [insights, setInsights] = useState<ProfilePhotoInsights | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const [editing, setEditing] = useState<{ imageId: string; mode: "replace" | "square" } | null>(null);
  const [edited, setEdited] = useState(false);

  const load = useCallback(async () => {
    const [albumResponse, insightResponse] = await Promise.all([
      adminCall("user_profile_albums", { uid }),
      adminCall("profile_photo_insights", { uid }),
    ]);
    const parsedAlbums = albumResponse?.success ? parseAlbums(albumResponse.data) : null;
    const parsedInsights = insightResponse?.success ? parseProfilePhotoInsights(insightResponse.data) : null;
    setError(!parsedAlbums || !parsedInsights);
    setAlbums(parsedAlbums);
    setInsights(parsedInsights);
  }, [uid]);

  useEffect(() => { void load(); }, [load]);

  async function remove(image: AlbumImage) {
    if (!window.confirm(t("deleteAlbumImageConfirm"))) return;
    setBusy(image.id);
    const response = await adminCall("admin_delete_profile_album_image", { image_id: image.id });
    setBusy("");
    if (!response?.success) {
      // `error` replaces the whole panel with a *load* failure, so reusing it here destroyed the
      // loaded albums and told the operator the wrong thing about a delete that simply failed.
      setDeleteError(true);
      return;
    }
    setDeleteError(false);
    await load();
  }

  // Reorders the profile gallery server-side so this picture leads; Core
  // resynchronizes the legacy avatar hash from the new order.
  async function makeMain(image: AlbumImage) {
    if (!window.confirm(t("makeMainConfirm"))) return;
    setBusy(image.id);
    const response = await adminCall("admin_set_main_photo", { uid, image_id: image.id });
    setBusy("");
    if (!response?.success) {
      setDeleteError(true);
      return;
    }
    setDeleteError(false);
    await load();
  }

  return (
    <section className="panel user-albums-panel">
      {editing ? (
        <AdminImageEditor
          uid={uid}
          imageId={editing.imageId}
          mode={editing.mode}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setEdited(true);
            // The replacement gets a new hash, so the old thumbnail URL is
            // stale. Reload rather than patching it in place.
            void load();
          }}
        />
      ) : null}
      <div className="panel-header"><div><h2>{t("allAlbums")}</h2><p>{t("allAlbumsCopy")}</p></div></div>
      <div className="panel-body">
        {deleteError ? <p className="alert alert-error" role="alert">{t("deleteAlbumImageError")}</p> : null}
        {edited ? <p className="alert alert-success" role="status">{editor("saved")}</p> : null}
        {error ? <p className="alert alert-error">{t("albumLoadError")}</p> : albums === null || insights === null ? <p className="page-subtitle">…</p> : albums.length === 0 ? <p className="page-subtitle">{t("noAlbums")}</p> : (
          <>
            <div className="album-insight-summary" aria-label={t("popularityTitle")}>
              <span><small>{t("totalLikes")}</small><strong>{insights.total_likes}</strong></span>
              <span><small>{t("likedPhotos")}</small><strong>{insights.liked_photo_count}</strong></span>
              <span><small>{t("topPhoto")}</small><strong>{insights.top_photo_id ? t("rankValue", { rank: 1 }) : t("noTopPhoto")}</strong></span>
            </div>
            <div className="admin-album-list">
            {albums.map((album) => (
              <section className="admin-album" key={album.id}>
                <header><div><h3>{album.name}</h3><small>{t(`albumKinds.${album.kind === "profile" || album.kind === "private" ? album.kind : "custom"}`)} · {album.private ? t("privateAlbum") : t("publicAlbum")}</small></div><span>{t("imageCount", { count: album.images.length })}</span></header>
                {album.images.length === 0 ? <p>{t("emptyAlbum")}</p> : <div className="gallery-grid">
                  {album.images.map((image) => {
                    const insight = insights.photos.find((row) => row.image_id === image.id);
                    const status = insight?.status ?? image.status;
                    return <figure className={`gallery-item${insights.top_photo_id === image.id ? " is-top-photo" : ""}`} key={image.id}>
                    <a href={image.full_url || image.thumbnail_url} target="_blank" rel="noopener noreferrer"><img src={image.thumbnail_url || image.full_url} alt="" loading="lazy" /></a>
                    {insights.top_photo_id === image.id ? <span className="top-photo-marker">{t("topPhotoMarker")}</span> : null}
                    <figcaption><span>{t(`albumScopes.${image.media_scope === "private_album" || image.media_scope === "public_album" ? image.media_scope : "profile"}`)} · <b className={`status-badge status-${status === "active" ? "accepted" : status === "rejected" ? "denied" : "pending"}`}>{status}</b></span>{insight ? <span className="album-photo-stats"><b>{t("likesValue", { count: insight.likes_count })}</b><b>{insight.rank === null ? t("unranked") : t("rankValue", { rank: insight.rank })}</b><b>{t("orderValue", { order: insight.order })}</b></span> : <span className="album-photo-stats">{t("nonProfileInsight")}</span>}{album.kind === "profile" && image.media_scope === "profile" ? <button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => void makeMain(image)}>{busy === image.id ? "…" : t("makeMain")}</button> : null}<button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => setEditing({ imageId: image.id, mode: "replace" })}>{editor("edit")}</button><button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => setEditing({ imageId: image.id, mode: "square" })}>{editor("squareEdit")}</button><button type="button" className="text-button danger-text" disabled={Boolean(busy)} onClick={() => void remove(image)}>{busy === image.id ? "…" : t("deleteImage")}</button></figcaption>
                  </figure>})}
                </div>}
              </section>
            ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
