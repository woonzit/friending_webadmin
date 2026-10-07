import { test } from "node:test";
import assert from "node:assert/strict";
import { eventIconCatalog, eventIconImageURL, eventIconReceipt, eventIconSaveOutcome } from "../lib/datesEventIcons.ts";

const icon = { key: "yoga", activity_type: "sport", emoji: "🧘", image_url: null, name_en: "Yoga", name_hu: "Jóga", enabled: true, is_default: true, order: 10 };
const catalog = { success: true, status_code: 200, event_icon_contract_version: 1, icons: [icon], revision: 1 };
test("icon catalogue is versioned, typed, unique and fail closed", () => {
  assert.ok(eventIconCatalog(catalog));
  for (const patch of [{ event_icon_contract_version: 2 }, { revision: -1 }, { icons: [] }, { icons: [icon, icon] },
    { icons: [{ ...icon, enabled: false }] }, { icons: [{ ...icon, image_url: "https://evil.test/a.png" }] }]) {
    assert.equal(eventIconCatalog({ ...catalog, ...patch }), null);
  }
});
test("malformed provider success cannot populate the icon editor", () => {
  assert.equal(eventIconCatalog({ ...catalog, status_code: 503 }), null);
  for (const patch of [{ activity_type: ["sport"] }, { emoji: "not an emoji" }, { emoji: "a" },
    { emoji: "☕☕" }, { name_en: "x".repeat(10000) }, { name_hu: " Yoga " }]) {
    assert.equal(eventIconCatalog({ ...catalog, icons: [{ ...icon, ...patch }] }), null);
  }
});
test("lost response -> revoked retry -> restored replay retains and settles the same command", () => {
  const command = { icons: JSON.stringify([icon]), expected_revision: 0, idempotency_key: "icon-save-one" };
  let pending: typeof command | null = command;
  const requests: (typeof command)[] = [];
  function attempt(response: unknown, retrying: boolean) {
    assert.ok(pending);
    requests.push(pending);
    const result = eventIconSaveOutcome(response, pending, retrying);
    if (result.receipt || result.outcome.kind === "refused") pending = null;
    return result;
  }
  assert.equal(attempt(null, false).outcome.kind, "uncertain");
  assert.equal(attempt({ success: false, status_code: 403, error: "admin-write-required" }, true).outcome.kind, "uncertain");
  assert.equal(pending, command);
  const restored = attempt({ ...catalog, audit_id: `aud_${"a".repeat(32)}`, idempotency_replayed: true }, true);
  assert.equal(restored.outcome.kind, "success");
  assert.equal(pending, null);
  assert.ok(requests.every(request => request === command));
});
test("proven icon validation refusal releases a retained command for correction", () => {
  for (const error of ["dates-event-icons-invalid", "dates-event-icon-invalid", "dates-event-icon-name-invalid",
    "dates-event-icon-image-required", "dates-event-icon-default-invalid", "dates-event-icon-removal-forbidden", "dates-event-icon-type-immutable"]) {
    const response = { success: false, status_code: 422, error, message: 200, status: 200, can_send: 0 };
    assert.equal(eventIconSaveOutcome(response, { expected_revision: 0, icons: "[]" }, true).outcome.kind, "refused");
  }
});
test("only managed PNG assets can become map pins", () => {
  assert.ok(eventIconImageURL("https://img.friending.co/icons/yoga.png"));
  for (const url of ["https://x@img.friending.co/a.png", "https://img.friending.co/a.svg", "https://img.friending.co/../a.png", "https://img.friending.co/a.png?x=1"]) assert.equal(eventIconImageURL(url), false);
});
test("save receipt binds the exact catalogue and revision; success alone is not enough", () => {
  const request = { icons: JSON.stringify([icon]), expected_revision: 0 };
  const receipt = { ...catalog, audit_id: `aud_${"a".repeat(32)}`, idempotency_replayed: false };
  assert.ok(eventIconReceipt(receipt, request));
  assert.equal(eventIconReceipt(catalog, request), null);
  assert.equal(eventIconReceipt(receipt, { ...request, expected_revision: 1 }), null);
  assert.equal(eventIconReceipt({ ...receipt, icons: [{ ...icon, emoji: "⚽" }] }, request), null);
});
