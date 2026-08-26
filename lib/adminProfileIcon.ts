export const MAX_ADMIN_PROFILE_ICON_BYTES = 2 * 1024 * 1024;

export type AdminProfileIconMime = "image/png" | "image/svg+xml";

export class AdminProfileIconError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

export type ValidatedAdminProfileIcon = {
  buffer: Buffer;
  mime: AdminProfileIconMime;
  sizeBytes: number;
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BOM = "﻿";

function isPng(input: Buffer): boolean {
  return input.length >= PNG_SIGNATURE.length
    && input.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

function isSvg(input: Buffer): boolean {
  if (input.includes(0x00)) return false;
  const text = input.toString("utf8");
  const start = (text.startsWith(BOM) ? text.slice(BOM.length) : text).trimStart();
  return start.startsWith("<") && /<svg[\s/>]/i.test(start);
}

/**
 * Decide the icon type from the bytes instead of from the browser-declared
 * `File.type`. Core's `AdminProfileIconUploadService` still owns PNG geometry
 * and the full SVG sanitization; this is a cheap agreement check so a file whose
 * content disagrees with what the caller claimed never reaches Core, and so the
 * console has its own coverage of that boundary.
 */
export function detectAdminProfileIconMime(input: Buffer): AdminProfileIconMime | null {
  if (isPng(input)) return "image/png";
  if (isSvg(input)) return "image/svg+xml";
  return null;
}

export function validateAdminProfileIcon(
  input: Buffer,
  declaredMime: string,
): ValidatedAdminProfileIcon {
  if (input.length === 0) throw new AdminProfileIconError("profile-icon-missing", 400);
  if (input.length > MAX_ADMIN_PROFILE_ICON_BYTES) {
    throw new AdminProfileIconError("profile-icon-too-large", 413);
  }
  const mime = detectAdminProfileIconMime(input);
  if (mime === null || mime !== declaredMime.trim().toLowerCase()) {
    throw new AdminProfileIconError("profile-icon-format-invalid", 422);
  }
  return { buffer: input, mime, sizeBytes: input.length };
}
