/**
 * The private photo or clip of an event-wall post, as a moderation case's
 * evidence keeps it: what the browser component and the server bridge
 * (lib/datesWallMediaBridge.ts) both have to agree on.
 */

/** Core's cap on a wall asset (`DatesWallPolicy::MAX_MEDIA_BYTES`): a longer answer is not one. */
export const WALL_MEDIA_LIMIT = 12 * 1024 * 1024;
/** The two forms Core stores a wall asset in. Nothing else is ever handed to an image or a video element. */
export const WALL_MEDIA_TYPES = ["image/jpeg", "video/mp4"] as const;
export type DatesWallMediaType = typeof WALL_MEDIA_TYPES[number];

/**
 * The scope an evidence list was read with, as it was sent: the media of that
 * list is read with the same three values, so that Core audits it under the
 * reason of the read that showed it.
 */
export type DatesWallMediaAccess = { reason: string | null; break_glass: boolean; include_sensitive_location: boolean };

export const isWallMediaType = (value: unknown): value is DatesWallMediaType => typeof value === "string" && (WALL_MEDIA_TYPES as readonly string[]).includes(value);

/** The type of the media an evidence snapshot says it has (`snapshot.wall_media.mime`), or `null`: none this console shows. */
export function wallMediaType(snapshot: unknown): DatesWallMediaType | null {
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const media = (snapshot as Record<string, unknown>).wall_media;
  if (media === null || typeof media !== "object" || Array.isArray(media)) return null;
  const mime = (media as Record<string, unknown>).mime;
  return isWallMediaType(mime) ? mime : null;
}
