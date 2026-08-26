"use client";

import {
  ADMIN_REQUEST_HEADER,
  ADMIN_REQUEST_HEADER_VALUE,
} from "@/lib/requestGuard";

export type AdminResponse = {
  success?: boolean;
  error?: string;
  [key: string]: unknown;
};

export async function adminCall(
  action: string,
  body: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<AdminResponse | null> {
  let response: Response;
  try {
    response = await fetch(`/api/admin/${encodeURIComponent(action)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal,
    });
  } catch {
    return null;
  }
  if (response.status === 401) {
    window.location.assign("/login");
    return null;
  }
  try {
    return (await response.json()) as AdminResponse;
  } catch {
    return null;
  }
}

export async function adminUploadImage(file: File): Promise<AdminResponse | null> {
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
    });
  } catch {
    return null;
  }
  try {
    return (await response.json()) as AdminResponse;
  } catch {
    return null;
  }
}

export async function adminUploadVideo(file: File): Promise<AdminResponse | null> {
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
    });
  } catch {
    return null;
  }
  if (response.status === 401) {
    window.location.assign("/login");
    return null;
  }
  try {
    return (await response.json()) as AdminResponse;
  } catch {
    return null;
  }
}

export async function adminUploadProfileIcon(file: File): Promise<AdminResponse | null> {
  const body = new FormData();
  body.set("icon", file, file.name);
  let response: Response;
  try {
    response = await fetch("/api/admin/upload-profile-icon", {
      method: "POST",
      headers: { [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE },
      body,
      cache: "no-store",
    });
  } catch {
    return null;
  }
  if (response.status === 401) {
    window.location.assign("/login");
    return null;
  }
  try {
    return (await response.json()) as AdminResponse;
  } catch {
    return null;
  }
}

export type PingerIconVariant = "light" | "dark" | "liked_light" | "liked_dark";

export async function adminUploadPingerIcon(
  file: File,
  variant: PingerIconVariant,
): Promise<AdminResponse | null> {
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
    });
  } catch {
    return null;
  }
  if (response.status === 401) {
    window.location.assign("/login");
    return null;
  }
  try {
    return (await response.json()) as AdminResponse;
  } catch {
    return null;
  }
}

export async function adminUploadSupportImage(
  uid: number,
  file: File,
  requestId: string,
): Promise<AdminResponse | null> {
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
    });
  } catch {
    return null;
  }
  if (response.status === 401) {
    window.location.assign("/login");
    return null;
  }
  try {
    return (await response.json()) as AdminResponse;
  } catch {
    return null;
  }
}
