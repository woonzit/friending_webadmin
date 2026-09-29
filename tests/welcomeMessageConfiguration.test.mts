import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import {
  WelcomeMessageView,
  type WelcomeMessageModel,
} from "../components/WelcomeMessageConfiguration.tsx";
import {
  WELCOME_MESSAGE_LOCALES,
  WELCOME_MESSAGE_MAX_BODY,
  WELCOME_MESSAGE_SETTING_KEY,
  normalizeWelcomeMessage,
  welcomeMessageBodyIssue,
  welcomeMessageLength,
  welcomeMessageSaveBody,
  welcomeMessageSaveOutcome,
  welcomeMessageSettingsRead,
  type WelcomeMessageValue,
} from "../lib/welcomeMessageConfiguration.ts";

/**
 * Core's wire capture for P-091, copied byte-identical from Core b0295e97, the
 * last Core main commit touching tests/fixtures/welcome_message_wire.json
 * (`php tests/welcome_message_storage_test.php --write` produces it). Only the
 * welcome_message entry of each settings map is kept.
 */
const FIXTURE = new URL("./fixtures/welcome_message_wire.json", import.meta.url);
const FIXTURE_SOURCE_COMMIT = "b0295e97637f1bdc91e82a1d795f17947f97f512";
const FIXTURE_SHA256 = "4002df00bc895f0294e8722d43e04db59c504e74c21b17a874e3e9dbbf2929fd";

type Json = Record<string, any>;

const corpus = JSON.parse(await readFile(FIXTURE, "utf8")) as Json;
const responses = corpus.responses as Record<string, Json>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const MESSAGES = {
  en: JSON.parse(await readFile(new URL("../messages/en.json", import.meta.url), "utf8")),
  hu: JSON.parse(await readFile(new URL("../messages/hu.json", import.meta.url), "utf8")),
};

function render(locale: "en" | "hu", model: WelcomeMessageModel): string {
  const noop = () => undefined;
  return renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale,
    messages: MESSAGES[locale],
    timeZone: "UTC",
    onError: (error: Error) => { throw error; },
  }, createElement(WelcomeMessageView, {
    model,
    onToggle: noop,
    onBody: noop,
    onSave: noop,
    onDiscard: noop,
    onReload: noop,
    onReplace: noop,
  })));
}

function escaped(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

test("the vendored capture is byte-identical to Core's", async () => {
  const bytes = await readFile(FIXTURE);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), FIXTURE_SHA256,
    `tests/fixtures/welcome_message_wire.json must stay byte-identical to Core ${FIXTURE_SOURCE_COMMIT}`);
  assert.equal(corpus.setting_key, WELCOME_MESSAGE_SETTING_KEY);
  assert.deepEqual(corpus.routes, { read: "/v1/webadmin/get_settings", save: "/v1/webadmin/set_settings" });
  assert.deepEqual(corpus.limits.locales, [...WELCOME_MESSAGE_LOCALES]);
  assert.equal(corpus.limits.max_body_code_points, WELCOME_MESSAGE_MAX_BODY);
  assert.deepEqual(corpus.limits.allowed_control_characters, ["\\t", "\\n"]);
});

test("every successful read in the capture decodes, with Core's metadata", () => {
  for (const name of ["viewer-default", "owner-default"]) {
    const read = welcomeMessageSettingsRead(responses[name]);
    assert.equal(read.kind, "ready", name);
    if (read.kind !== "ready") continue;
    assert.equal(read.stored.value.enabled, true, "the welcome is on by default");
    assert.equal(read.stored.updatedAt, 0, "never saved");
    assert.equal(read.stored.updatedBy, "");
    assert.match(read.stored.value.body.hu, /^Szia!/u);
    assert.match(read.stored.value.body.en, /^Hi there,/u);
  }
  const disabled = welcomeMessageSettingsRead(responses["disabled-saved"]);
  assert.equal(disabled.kind, "ready");
  if (disabled.kind === "ready") {
    assert.equal(disabled.stored.value.enabled, false);
    assert.equal(disabled.stored.updatedAt, 1_700_000_000);
    assert.equal(disabled.stored.updatedBy, "admin@example.test");
  }
  const edited = welcomeMessageSettingsRead(responses["edited-saved"]);
  assert.deepEqual(edited, {
    kind: "ready",
    stored: {
      value: corpus.save_body_example.settings.welcome_message,
      updatedAt: 1_700_000_000,
      updatedBy: "owner@example.test",
    },
  });
});

test("a damaged stored row (value null) is a load error, never a default", () => {
  assert.deepEqual(welcomeMessageSettingsRead(responses["corrupt-read"]), {
    kind: "corrupt",
    updatedAt: 1_700_000_000,
    updatedBy: "owner@example.test",
  });
});

test("refusals, other settings and malformed rows never read as an editable message", () => {
  for (const name of ["viewer-write-refused", "invalid-empty", "invalid-shape", "invalid-too-long"]) {
    assert.deepEqual(welcomeMessageSettingsRead(responses[name]), { kind: "invalid" }, name);
  }
  const base = responses["edited-saved"];
  const variants: Array<[string, (body: Json) => void]> = [
    ["no entry (older Core)", (body) => { delete body.settings.welcome_message; }],
    ["wrong type", (body) => { body.settings.welcome_message.type = "boolean"; }],
    ["value missing", (body) => { delete body.settings.welcome_message.value; }],
    ["success false", (body) => { body.success = false; }],
    ["status 500", (body) => { body.status_code = 500; }],
    ["negative updated_at", (body) => { body.settings.welcome_message.updated_at = -1; }],
    ["fractional updated_at", (body) => { body.settings.welcome_message.updated_at = 1.5; }],
    ["updated_by not a string", (body) => { body.settings.welcome_message.updated_by = null; }],
    ["untrimmed body", (body) => { body.settings.welcome_message.value.body.en = " New English text."; }],
    ["extra key", (body) => { body.settings.welcome_message.value.title = "x"; }],
    ["extra locale", (body) => { body.settings.welcome_message.value.body.de = "Hallo"; }],
    ["missing locale", (body) => { delete body.settings.welcome_message.value.body.hu; }],
    ["string boolean", (body) => { body.settings.welcome_message.value.enabled = "true"; }],
  ];
  for (const [why, change] of variants) {
    const body = clone(base);
    change(body);
    assert.deepEqual(welcomeMessageSettingsRead(body), { kind: "invalid" }, why);
  }
  for (const value of [null, undefined, "x", [], {}]) {
    assert.deepEqual(welcomeMessageSettingsRead(value), { kind: "invalid" });
  }
});

test("the save body is exactly Core's example: only the welcome entry, canonical", () => {
  const example = corpus.save_body_example as { settings: { welcome_message: WelcomeMessageValue } };
  assert.deepEqual(welcomeMessageSaveBody(example.settings.welcome_message), example);
  // The console trims like PHP's trim() before sending; paragraphs survive.
  assert.deepEqual(
    welcomeMessageSaveBody({ enabled: true, body: { hu: "\n Első.\n\nMásodik. \r\n", en: "\tHi\t" } }),
    { settings: { welcome_message: { enabled: true, body: { hu: "Első.\n\nMásodik.", en: "Hi" } } } },
  );
  assert.equal(welcomeMessageSaveBody({ enabled: true, body: { hu: "   ", en: "Hi" } }), null);
});

test("the client mirrors Core's WelcomeMessage::normalize limits", () => {
  const ok = (hu: string) => normalizeWelcomeMessage({ enabled: false, body: { hu, en: "Hi" } });
  assert.ok(ok("x".repeat(WELCOME_MESSAGE_MAX_BODY)));
  assert.equal(ok("x".repeat(WELCOME_MESSAGE_MAX_BODY + 1)), null);
  // Code points, as mb_strlen counts them: 4000 emoji are 8000 UTF-16 units.
  assert.ok(ok("😀".repeat(WELCOME_MESSAGE_MAX_BODY)));
  assert.equal(ok("😀".repeat(WELCOME_MESSAGE_MAX_BODY + 1)), null);
  assert.equal(welcomeMessageLength(" 😀ő "), 2);
  // Tab and newline are allowed inside; every other control character is not.
  assert.ok(ok("a\tb\nc"));
  for (const bad of ["a\rb", "a\u0000b", "a\u0007b", "a\u000Bb", "a\u001Fb", "a\u007Fb", "a\uD800b", "a\uDC00b"]) {
    assert.equal(ok(bad), null, JSON.stringify(bad));
  }
  // PHP's trim() set only: a no-break space is content, not whitespace.
  assert.equal(ok(" Hi")?.body.hu, " Hi");
  assert.equal(welcomeMessageBodyIssue(""), "empty");
  assert.equal(welcomeMessageBodyIssue(" \n\t "), "empty");
  assert.equal(welcomeMessageBodyIssue("x".repeat(4001)), "tooLong");
  assert.equal(welcomeMessageBodyIssue("a\u0001"), "control");
  assert.equal(welcomeMessageBodyIssue("Szia!"), null);
  for (const value of [
    null, [], { enabled: true }, { enabled: 1, body: { hu: "a", en: "b" } },
    { enabled: true, body: ["a", "b"] }, { enabled: true, body: { hu: "a", en: 1 } },
    { enabled: true, body: { hu: "a", en: "b" }, extra: true },
  ]) {
    assert.equal(normalizeWelcomeMessage(value), null, JSON.stringify(value));
  }
});

test("save answers are classified: saved, definite refusals, and unknown outcomes", () => {
  const sent = corpus.save_body_example.settings.welcome_message as WelcomeMessageValue;
  const saved = welcomeMessageSaveOutcome(responses["edited-saved"], sent);
  assert.equal(saved.kind, "saved");
  // A success carrying some other value is not proof that ours landed.
  assert.deepEqual(welcomeMessageSaveOutcome(responses["disabled-saved"], sent), { kind: "unknown" });
  for (const name of ["invalid-empty", "invalid-shape", "invalid-too-long"]) {
    assert.deepEqual(welcomeMessageSaveOutcome(responses[name], sent), { kind: "invalid" }, name);
  }
  assert.deepEqual(welcomeMessageSaveOutcome(responses["viewer-write-refused"], sent), { kind: "writeRequired" });
  // The same-origin bridge refuses a viewer before Core, without the legacy trio.
  assert.deepEqual(
    welcomeMessageSaveOutcome({ success: false, status_code: 403, error: "admin-write-required" }, sent),
    { kind: "writeRequired" },
  );
  assert.deepEqual(
    welcomeMessageSaveOutcome({ success: false, status_code: 413, error: "too-large" }, sent),
    { kind: "refused", error: "too-large" },
  );
  // setting-invalid about another field is not this panel's validation message.
  assert.deepEqual(
    welcomeMessageSaveOutcome({ success: false, status_code: 422, error: "setting-invalid", field: "expected_revision" }, sent),
    { kind: "refused", error: "setting-invalid" },
  );
  // Core writes the row before its audit: write-failed may follow a stored change.
  for (const answer of [
    null,
    undefined,
    { success: false, status_code: 500, error: "write-failed" },
    { success: false, status_code: 503, error: "core-unavailable" },
    { success: false, error: "core-timeout" },
    { success: true, status_code: 200 },
  ]) {
    assert.deepEqual(welcomeMessageSaveOutcome(answer, sent), { kind: "unknown" }, JSON.stringify(answer));
  }
});

function readyModel(overrides: Partial<WelcomeMessageModel> = {}): WelcomeMessageModel {
  const read = welcomeMessageSettingsRead(responses["owner-default"]);
  assert.equal(read.kind, "ready");
  const stored = read.kind === "ready" ? read.stored : null;
  return { phase: "ready", canWrite: true, stored, draft: stored!.value, busy: false, notice: null, ...overrides };
}

test("the editor renders Core's default in both locales with the default-on note", () => {
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].configuration.welcomeMessage;
    const model = readyModel();
    const html = render(locale, model);
    assert.ok(html.includes(escaped(copy.title)));
    assert.ok(html.includes(escaped(copy.defaultOn)), "the on-by-default note is always shown");
    assert.ok(html.includes(escaped(copy.neverSaved)));
    assert.ok(html.includes(escaped(copy.enabledOn)));
    assert.ok(html.includes(escaped(copy.locales.hu)));
    assert.ok(html.includes(escaped(copy.locales.en)));
    assert.ok(html.includes(escaped(model.draft!.body.hu)));
    assert.ok(html.includes(escaped(model.draft!.body.en)));
    assert.equal([...html.matchAll(/<textarea/g)].length, 2);
    assert.ok(html.includes(escaped(copy.save)));
    assert.doesNotMatch(html, /data-welcome-message-read-only/);
    // Nothing changed yet: both buttons stay disabled.
    assert.equal([...html.matchAll(/<button[^>]*disabled=""/g)].length, 2);
  }
});

test("viewers see the message read-only, without save controls", () => {
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].configuration.welcomeMessage;
    const html = render(locale, readyModel({ canWrite: false }));
    assert.ok(html.includes(escaped(copy.readOnly)));
    assert.doesNotMatch(html, /<button/);
    assert.equal([...html.matchAll(/<textarea[^>]*disabled=""/g)].length, 2);
    assert.match(html, /<input type="checkbox"[^>]*disabled=""/);
  }
});

test("a changed or invalid draft, and the save notices, render in both locales", () => {
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].configuration.welcomeMessage;
    const base = readyModel();
    const changed = render(locale, { ...base, draft: { ...base.draft!, enabled: false } });
    assert.ok(changed.includes(escaped(copy.unsaved)));
    assert.ok(changed.includes(escaped(copy.enabledOff)));
    assert.equal([...changed.matchAll(/<button[^>]*disabled=""/g)].length, 0);

    const empty = render(locale, { ...base, draft: { ...base.draft!, body: { ...base.draft!.body, en: "  " } } });
    assert.ok(empty.includes(escaped(copy.issues.empty)));
    assert.match(empty, /aria-invalid="true"/);
    assert.match(empty, new RegExp(`<button[^>]*disabled=""[^>]*>${escaped(copy.save)}<`));

    for (const key of ["saved", "invalid", "writeRequired", "notApplied"] as const) {
      const html = render(locale, { ...base, notice: { tone: key === "saved" ? "success" : "error", key } });
      assert.ok(html.includes(escaped(copy[key])), key);
    }
    const refused = render(locale, { ...base, notice: { tone: "error", key: "refused", error: "too-large" } });
    assert.ok(refused.includes("too-large"));
  }
});

test("a damaged row and a failed read show errors, never an editor", () => {
  for (const locale of ["en", "hu"] as const) {
    const copy = MESSAGES[locale].configuration.welcomeMessage;
    const corrupt: WelcomeMessageModel = {
      phase: "corrupt", canWrite: true, stored: null, draft: null, busy: false, notice: null,
      corruptMeta: { updatedAt: 1_700_000_000, updatedBy: "owner@example.test" },
    };
    const writer = render(locale, corrupt);
    assert.ok(writer.includes(escaped(copy.corrupt)));
    assert.ok(writer.includes(`>${escaped(copy.replace)}</button>`));
    assert.ok(writer.includes("owner@example.test"));
    assert.doesNotMatch(writer, /<textarea/);
    const viewer = render(locale, { ...corrupt, canWrite: false });
    assert.ok(viewer.includes(escaped(copy.corrupt)));
    assert.doesNotMatch(viewer, /<button[^>]*>[^<]*<\/button>[\s\S]*<button/u, "only Reload");
    assert.ok(!viewer.includes(`>${escaped(copy.replace)}</button>`));
    assert.ok(viewer.includes(escaped(copy.readOnly)));
    // Writing a replacement starts from empty bodies and cannot be saved empty.
    const replacing = render(locale, { ...corrupt, draft: { enabled: true, body: { hu: "", en: "" } } });
    assert.ok(replacing.includes(escaped(copy.replacing)));
    assert.equal([...replacing.matchAll(/<textarea/g)].length, 2);
    assert.match(replacing, new RegExp(`<button[^>]*disabled=""[^>]*>${escaped(copy.save)}<`));

    const failed = render(locale, { phase: "error", canWrite: false, stored: null, draft: null, busy: false, notice: null });
    assert.ok(failed.includes(escaped(copy.loadError)));
    assert.doesNotMatch(failed, /<textarea/);
  }
});

test("the panel reads its role from admin_me, saves only through set_settings and is mounted on Configuration", async () => {
  const component = await readFile(new URL("../components/WelcomeMessageConfiguration.tsx", import.meta.url), "utf8");
  assert.match(component, /adminCall\("admin_me", \{\}, signal\)/);
  assert.match(component, /adminCall\("set_settings", payload\)/);
  assert.match(component, /const payload = draft \? welcomeMessageSaveBody\(draft\) : null;/);
  assert.equal([...component.matchAll(/adminCall\("set_settings"/g)].length, 1, "one save, never a blind retry");
  assert.doesNotMatch(component, /fetch\(|localStorage|sessionStorage/);
  const page = await readFile(new URL("../app/(dashboard)/configuration/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<WelcomeMessageConfiguration \/>/);
});
