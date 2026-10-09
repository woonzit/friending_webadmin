"use client";

import { isAdminClientReadAction } from "@/lib/adminClientReadActions";
import { ADMIN_MEMBERSHIP_UNCONFIRMED, classifyAdminMembership } from "@/lib/adminMembership";
import { adminMembershipFailure, adminRequestOutcomeUnknownFailure } from "@/lib/adminMembershipClientError";
import { createAdminMembershipRecovery, createAdminWriteOutcomeNotice } from "@/lib/adminMembershipRecovery";
import {
  ADMIN_REQUEST_HEADER,
  ADMIN_REQUEST_HEADER_VALUE,
} from "@/lib/requestGuard";

export type AdminResponse = {
  success?: boolean;
  error?: string;
  [key: string]: unknown;
};

// PROOF per name/action, not per HTTP class or complete envelope. Core main
// 68881e54: src/Services/DatesEventResearchAdminService.php:182-187 resolves the
// place before DatesEventResearchCommands::execute opens its transaction;
// src/Services/DatesEventResearchAreaResolver.php:29,57,63 raises this refusal.
// A new entry requires its own Core no-write proof AND a regression test.
const PROVEN_CORE_NO_WRITE_REFUSALS = [
  { action: "dates_event_research_area_save", status: 503, error: "dates-research-place-unavailable" },
] as const;

function unknownWriteOutcome(action: string, response: Response | null, data: AdminResponse | null): boolean {
  if (!response || !data) return true;
  if (response.status < 500) return false;
  const complete = data.success === false && data.status_code === response.status
    && data.message === 200 && data.status === 200 && data.can_send === 0;
  return !complete || !PROVEN_CORE_NO_WRITE_REFUSALS.some(rule =>
    rule.action === action && rule.status === response.status && rule.error === data.error);
}

const refuseUnconfirmed = adminMembershipFailure;
export const adminWriteOutcomeNotice = createAdminWriteOutcomeNotice();
const redirectToLogin = () => window.location.assign("/login");
function definiteSignedOut(status: number, data: AdminResponse | null): boolean {
  return status === 401 && data?.success === false && data.error === "auth-required"
    && (data.status_code === undefined || data.status_code === 401);
}
async function responseData(response: Response, signal?: AbortSignal): Promise<AdminResponse | null> {
  if (signal?.aborted) return null;
  try {
    const data: unknown = await response.json();
    return !signal?.aborted && data !== null && typeof data === "object" && !Array.isArray(data) ? data as AdminResponse : null;
  } catch { return null; }
}
async function jsonRequest(action: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response | null> {
  if (signal?.aborted) return null;
  try {
    return await fetch(`/api/admin/${encodeURIComponent(action)}`, {
      method: "POST", headers: { "Content-Type": "application/json", [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE },
      body: JSON.stringify(body), cache: "no-store", signal,
    });
  } catch { return null; }
}
export const adminMembershipRecovery = createAdminMembershipRecovery(async () => {
  const signal = AbortSignal.timeout(10_000);
  const response = await jsonRequest("admin_me", {}, signal);
  if (!response || signal.aborted) return "unconfirmed";
  const data = await responseData(response, signal);
  if (signal.aborted) return "unconfirmed";
  if (definiteSignedOut(response.status, data)) return "revoked";
  // The bridge has already bound the actor to its HttpOnly session. This
  // client parse only decides whether to hide a notice, never grants access.
  const decision = classifyAdminMembership({ status: response.status, data }, typeof data?.email === "string" ? data.email : "");
  return decision.kind === "confirmed" ? "confirmed" : "unconfirmed";
}, redirectToLogin);

async function finishUpload(response: Response, signal?: AbortSignal): Promise<AdminResponse | null> {
  const data = await responseData(response, signal);
  if (signal?.aborted) return null;
  if (definiteSignedOut(response.status, data)) { redirectToLogin(); return null; }
  if (response.status === 503 && data?.success === false && data.error === ADMIN_MEMBERSHIP_UNCONFIRMED) {
    adminMembershipRecovery.markUnconfirmed(); return refuseUnconfirmed();
  }
  else if (unknownWriteOutcome("", response, data)) adminWriteOutcomeNotice.markUnknown();
  return data ?? adminRequestOutcomeUnknownFailure();
}

function lostUpload(signal?: AbortSignal): AdminResponse | null {
  if (!signal?.aborted) { adminWriteOutcomeNotice.markUnknown(); adminMembershipRecovery.markUnconfirmed(); return adminRequestOutcomeUnknownFailure(); }
  return null;
}

export async function adminCall(
  action: string,
  body: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<AdminResponse | null> {
  const readOnly = isAdminClientReadAction(action);
  if (signal?.aborted) return null;
    // Reads can be the first step of a write. NEVER hold/resend any caller's
    // Promise: recovery starts registered read-only page loaders from the top.
    if (adminMembershipRecovery.getSnapshot()) return refuseUnconfirmed();
    const response = await jsonRequest(action, body, signal);
    if (signal?.aborted) return null;
    const data = response ? await responseData(response, signal) : null;
    if (signal?.aborted) return null; // A late body / 401 cannot navigate an abandoned caller.
    if (response && definiteSignedOut(response.status, data)) { redirectToLogin(); return null; }
    const preForwardRefusal = response?.status === 503 && data?.success === false && data.error === ADMIN_MEMBERSHIP_UNCONFIRMED;
    if (!readOnly && !preForwardRefusal && unknownWriteOutcome(action, response, data)) adminWriteOutcomeNotice.markUnknown();
    if (!readOnly && !data) {
      adminMembershipRecovery.markUnconfirmed();
      return adminRequestOutcomeUnknownFailure();
    }
    const unavailable = !response
      || (response.status === 503 && data?.success === false && data.error === ADMIN_MEMBERSHIP_UNCONFIRMED)
      || (action === "admin_me" && classifyAdminMembership({ status: response.status, data }, typeof data?.email === "string" ? data.email : "").kind !== "confirmed");
    if (unavailable) {
      adminMembershipRecovery.markUnconfirmed();
      return refuseUnconfirmed();
    }
    return data;
}

export async function adminUploadImage(file: File, signal?: AbortSignal): Promise<AdminResponse | null> {
  if (signal?.aborted) return null;
  if (adminMembershipRecovery.getSnapshot()) return refuseUnconfirmed();
  const body = new FormData();
  body.set("image", file, file.name);

  let response: Response;
  try {
    response = await fetch("/api/admin/upload-image", {
      method: "POST",
      headers: {
        [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE,
      },
      body,
      cache: "no-store",
      signal,
    });
  } catch {
    return lostUpload(signal);
  }
  return finishUpload(response, signal);
}

export async function adminUploadVideo(file: File, signal?: AbortSignal): Promise<AdminResponse | null> {
  if (signal?.aborted) return null;
  if (adminMembershipRecovery.getSnapshot()) return refuseUnconfirmed();
  const body = new FormData();
  body.set("video", file, file.name);

  let response: Response;
  try {
    response = await fetch("/api/admin/upload-video", {
      method: "POST",
      headers: {
        [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE,
      },
      body,
      cache: "no-store",
      signal,
    });
  } catch {
    return lostUpload(signal);
  }
  return finishUpload(response, signal);
}

export async function adminUploadProfileIcon(file: File, signal?: AbortSignal): Promise<AdminResponse | null> {
  if (signal?.aborted) return null;
  if (adminMembershipRecovery.getSnapshot()) return refuseUnconfirmed();
  const body = new FormData();
  body.set("icon", file, file.name);
  let response: Response;
  try {
    response = await fetch("/api/admin/upload-profile-icon", {
      method: "POST",
      headers: { [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE },
      body,
      cache: "no-store",
      signal,
    });
  } catch {
    return lostUpload(signal);
  }
  return finishUpload(response, signal);
}

export type PingerIconVariant = "light" | "dark" | "liked_light" | "liked_dark";

export async function adminUploadPingerIcon(
  file: File,
  variant: PingerIconVariant,
  signal?: AbortSignal,
): Promise<AdminResponse | null> {
  if (signal?.aborted) return null;
  if (adminMembershipRecovery.getSnapshot()) return refuseUnconfirmed();
  const body = new FormData();
  body.set("icon", file, file.name);
  body.set("variant", variant);
  let response: Response;
  try {
    response = await fetch("/api/admin/upload-pinger-icon", {
      method: "POST",
      headers: { [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE },
      body,
      cache: "no-store",
      signal,
    });
  } catch {
    return lostUpload(signal);
  }
  return finishUpload(response, signal);
}

export async function adminUploadSupportImage(
  uid: number,
  file: File,
  requestId: string,
  signal?: AbortSignal,
): Promise<AdminResponse | null> {
  if (signal?.aborted) return null;
  if (adminMembershipRecovery.getSnapshot()) return refuseUnconfirmed();
  const body = new FormData();
  body.set("uid", String(uid));
  body.set("request_id", requestId);
  body.set("image", file, file.name || "support-image");
  let response: Response;
  try {
    response = await fetch("/api/admin/support-media", {
      method: "POST",
      headers: { [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE },
      body,
      cache: "no-store",
      signal,
    });
  } catch {
    return lostUpload(signal);
  }
  return finishUpload(response, signal);
}

/**
 * A private event-wall photo or clip of a moderation case's evidence, from the
 * console's own bridge: the bytes, or the refusal. A read, so nothing is
 * marked as a write in doubt; a definite sign-out goes to /login and an
 * unconfirmed membership starts the recovery, as for every other call. It
 * does not itself look at the membership state (the reviewed list of its
 * observers stays as it is): the bridge checks the membership on every read.
 * `null`: the caller gave up, or the page is leaving for /login.
 */
export async function adminWallEvidenceMedia(body: Record<string, unknown>, signal?: AbortSignal): Promise<Blob | AdminResponse | null> {
  if (signal?.aborted) return null;
  let response: Response;
  try {
    response = await fetch("/api/admin/dates-wall-media", {
      method: "POST",
      headers: { "Content-Type": "application/json", [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE },
      body: JSON.stringify(body),
      cache: "no-store",
      signal,
    });
  } catch {
    if (signal?.aborted) return null;
    adminMembershipRecovery.markUnconfirmed();
    return refuseUnconfirmed();
  }
  if (signal?.aborted) return null;
  if (response.ok) {
    let media: Blob | null = null;
    try { media = await response.blob(); } catch { media = null; }
    if (signal?.aborted) return null;
    return media ?? { success: false, error: "media-unreadable" };
  }
  const data = await responseData(response, signal);
  if (signal?.aborted) return null;
  if (definiteSignedOut(response.status, data)) { redirectToLogin(); return null; }
  if (response.status === 503 && data?.success === false && data.error === ADMIN_MEMBERSHIP_UNCONFIRMED) {
    adminMembershipRecovery.markUnconfirmed();
    return refuseUnconfirmed();
  }
  return data ?? { success: false, error: "media-unreadable" };
}

/** "Draft from source" (T-865 P2a): the source, and a flyer when there is one, to the console's own route. */
export async function adminIntakeCreate(body: FormData, signal?: AbortSignal): Promise<AdminResponse | null> {
  if (signal?.aborted) return null;
  if (adminMembershipRecovery.getSnapshot()) return refuseUnconfirmed();
  let response: Response;
  try {
    response = await fetch("/api/admin/dates-intake-create", {
      method: "POST",
      headers: { [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE },
      body,
      cache: "no-store",
      signal,
    });
  } catch {
    return lostUpload(signal);
  }
  return finishUpload(response, signal);
}
