import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_REQUEST_HEADER,
  ADMIN_REQUEST_HEADER_VALUE,
  isSameOrigin,
  isTrustedAdminMediaRead,
  isTrustedAdminRequest,
} from "../lib/requestGuard.ts";

function headers(values: Record<string, string>) {
  const normalized = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return { get: (name: string) => normalized.get(name.toLowerCase()) ?? null };
}

test("same-origin requests with the admin marker are trusted", () => {
  assert.equal(ADMIN_REQUEST_HEADER, "x-friending-admin-request");
  const value = headers({
    origin: "https://friendingapp.com",
    host: "friendingapp.com",
    "sec-fetch-site": "same-origin",
    [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE,
  });
  assert.equal(isSameOrigin(value), true);
  assert.equal(isTrustedAdminRequest(value), true);
});

test("foreign, missing-origin and unmarked requests fail closed", () => {
  assert.equal(isTrustedAdminRequest(headers({
    origin: "https://friending.com",
    host: "friendingapp.com",
    [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE,
  })), false);
  assert.equal(isTrustedAdminRequest(headers({
    host: "friendingapp.com",
    [ADMIN_REQUEST_HEADER]: ADMIN_REQUEST_HEADER_VALUE,
  })), false);
  assert.equal(isTrustedAdminRequest(headers({
    origin: "https://friendingapp.com",
    host: "friendingapp.com",
  })), false);
});

test("host comparison includes the development port", () => {
  assert.equal(isSameOrigin(headers({
    origin: "http://localhost:3006",
    host: "localhost:3006",
  })), true);
  assert.equal(isSameOrigin(headers({
    origin: "http://localhost:3005",
    host: "localhost:3006",
  })), false);
});

test("private media subresources require a same-host source and fail direct or cross-site opens", () => {
  assert.equal(isTrustedAdminMediaRead(headers({
    referer: "https://friendingapp.com/profile-verification/abc",
    host: "friendingapp.com",
    "sec-fetch-site": "same-origin",
  })), true);
  assert.equal(isTrustedAdminMediaRead(headers({
    origin: "https://friendingapp.com",
    host: "friendingapp.com",
    "sec-fetch-site": "same-origin",
  })), true);
  assert.equal(isTrustedAdminMediaRead(headers({
    host: "friendingapp.com",
    "sec-fetch-site": "none",
  })), false, "a copied evidence URL may not be opened directly");
  // The console sends `Referrer-Policy: no-referrer`, so an evidence <img>/<video> arrives with
  // neither Referer nor Origin: the browser's own same-origin Fetch Metadata is the proof.
  assert.equal(isTrustedAdminMediaRead(headers({
    host: "friendingapp.com",
    "sec-fetch-site": "same-origin",
    "sec-fetch-dest": "image",
  })), true, "an evidence image on the console page");
  assert.equal(isTrustedAdminMediaRead(headers({
    host: "friendingapp.com",
    "sec-fetch-site": "same-origin",
    "sec-fetch-dest": "video",
  })), true, "an evidence video on the console page");
  assert.equal(isTrustedAdminMediaRead(headers({
    host: "friendingapp.com",
    "sec-fetch-site": "same-origin",
    "sec-fetch-dest": "audio",
  })), true, "an evidence audio element on the console page");
  assert.equal(isTrustedAdminMediaRead(headers({
    host: "friendingapp.com",
    "sec-fetch-site": "SAME-ORIGIN",
    "sec-fetch-dest": "Video",
  })), true, "Fetch Metadata values compare case-insensitively");
  // Without Referer/Origin, same-origin Fetch Metadata alone is not enough: a same-origin link
  // click or script fetch to an evidence URL is not a media element and is refused.
  for (const dest of ["document", "iframe", "frame", "embed", "object", "empty", "script", "worker", ""]) {
    assert.equal(isTrustedAdminMediaRead(headers({
      host: "friendingapp.com",
      "sec-fetch-site": "same-origin",
      ...(dest ? { "sec-fetch-dest": dest } : {}),
    })), false, `same-origin Sec-Fetch-Dest ${dest || "absent"} is not a media element`);
  }
  for (const site of ["cross-site", "same-site", "none", ""]) {
    assert.equal(isTrustedAdminMediaRead(headers({
      host: "friendingapp.com",
      "sec-fetch-dest": "video",
      ...(site ? { "sec-fetch-site": site } : {}),
    })), false, `a media destination does not rescue Sec-Fetch-Site ${site || "absent"}`);
  }
  for (const site of ["cross-site", "same-site", "none", ""]) {
    assert.equal(isTrustedAdminMediaRead(headers({ host: "friendingapp.com", ...(site ? { "sec-fetch-site": site } : {}) })), false,
      `no Referer/Origin and Sec-Fetch-Site ${site || "absent"}`);
  }
  assert.equal(isTrustedAdminMediaRead(headers({ "sec-fetch-site": "same-origin" })), false, "no Host");
  // A present Referer/Origin must still name this host, even when Fetch Metadata claims same-origin.
  assert.equal(isTrustedAdminMediaRead(headers({
    referer: "https://evil.example/",
    host: "friendingapp.com",
    "sec-fetch-site": "same-origin",
  })), false, "a foreign Referer is never overridden by Fetch Metadata");
  assert.equal(isTrustedAdminMediaRead(headers({
    origin: "https://friendingapp.com",
    host: "friendingapp.com",
    "sec-fetch-site": "cross-site",
  })), false, "a same-host Origin with cross-site Fetch Metadata");
  assert.equal(isTrustedAdminMediaRead(headers({
    referer: "https://evil.example/",
    host: "friendingapp.com",
    "sec-fetch-site": "cross-site",
  })), false);
});

test("private evidence is only ever loaded by media elements the guard accepts", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../app/(dashboard)/profile-verification/[caseId]/page.tsx", import.meta.url), "utf8");
  // <video> requests carry Sec-Fetch-Dest: video; the <img> keeps a same-origin Referer and, if a
  // browser strips it, carries Sec-Fetch-Dest: image. No link, frame or fetch opens the URL.
  assert.match(page, /<video controls controlsList="nodownload" playsInline preload="metadata" src=\{videoUrl\} \/>/);
  assert.match(page, /<img src=\{snapshotUrl\} alt=\{t\("evidence\.avatarSnapshot"\)\} referrerPolicy="same-origin" \/>/);
  for (const url of ["videoUrl", "snapshotUrl"]) {
    const uses = page.match(new RegExp(`\\{${url}\\}`, "gu")) ?? [];
    assert.equal(uses.length, 1, `${url} is used by exactly one media element`);
    assert.doesNotMatch(page, new RegExp(`href=\\{${url}\\}|fetch\\(${url}`, "u"));
  }
  const route = await readFile(new URL("../app/api/admin/profile-verification-evidence/route.ts", import.meta.url), "utf8");
  assert.match(route, /if \(!isTrustedAdminMediaRead\(request\.headers\)\) \{\s*return jsonError\("bad-origin", 403\);/);
});
