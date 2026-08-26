import test from "node:test";
import assert from "node:assert/strict";
import {
  supportClientContext,
  supportConversation,
  supportImageUrl,
  supportMediaEnabled,
  supportSourceLabel,
  supportThreads,
} from "../lib/supportInbox.ts";

const image = "https://pic.freelove.hu/api/cache/support/42/2026/08/0123456789abcdef0123456789abcdef.jpg";

test("support inbox decodes image rows and the latest bounded client context", () => {
  const payload = {
    success: true,
    capabilities: { support_media: true, client_context_schema: 1 },
    threads: [{
      uid: 42,
      status: "open",
      last_text: "",
      last_kind: "image",
      last_sender: "user",
      last_at: 123,
      unread_admin: 1,
      client_context: {
        schema_version: 1,
        source: "ios",
        app_version: "2.5.0",
        app_build: "84",
        screen_width_px: 1290,
        screen_height_px: 2796,
        auth_token: "must-not-be-decoded",
      },
      user: { displayname: { value: "Ada" }, avatar: "https://pic.freelove.hu/a.jpg" },
    }],
  };
  assert.equal(supportMediaEnabled(payload), true);
  const rows = supportThreads(payload);
  assert.ok(rows);
  assert.equal(rows[0]?.lastKind, "image");
  assert.equal(rows[0]?.clientContext?.source, "ios");
  assert.equal("authToken" in (rows[0]?.clientContext ?? {}), false);
});

test("support conversations require text XOR a trusted first-party image", () => {
  const parsed = supportConversation({
    messages: [
      { id: "a", smid: 1, sender: "user", kind: "text", body: "Hello", created_at: 1 },
      {
        id: "b",
        smid: 2,
        sender: "admin",
        kind: "image",
        body: "",
        image_url: image,
        image_width: 1200,
        image_height: 900,
        image_removed: false,
        created_at: 2,
      },
    ],
    last_smid: 2,
    status: "open",
    capabilities: { support_media: true },
  });
  assert.ok(parsed);
  assert.equal(parsed.messages[1]?.kind, "image");
  assert.equal(parsed.messages[1]?.imageUrl, image);
  assert.equal(parsed.mediaEnabled, true);

  assert.equal(supportConversation({
    messages: [{
      id: "x", smid: 1, sender: "user", kind: "image", body: "",
      image_url: image.replace("pic.freelove.hu", "example.com"), image_removed: false,
    }],
  }), null);
  assert.equal(supportConversation({
    messages: [{
      id: "xor-image", smid: 2, sender: "user", kind: "image", body: "caption",
      image_url: image, image_removed: false,
    }],
  }), null);
  assert.equal(supportConversation({
    messages: [{
      id: "xor-text", smid: 3, sender: "user", kind: "text", body: "caption",
      image_url: image, image_removed: false,
    }],
  }), null);
  assert.equal(supportConversation({
    messages: [{
      id: "invalid-sequence", smid: 0, sender: "user", kind: "text", body: "caption",
    }],
  }), null);
});

test("removed support images remain a renderable terminal message", () => {
  const parsed = supportConversation({
    messages: [{
      id: "x", smid: 1, sender: "user", kind: "image", body: "",
      image_url: null, image_removed: true,
    }],
  });
  assert.ok(parsed);
  assert.equal(parsed.messages[0]?.imageRemoved, true);
});

test("support media URL and client context parsers fail closed", () => {
  assert.equal(supportImageUrl(image), image);
  assert.equal(supportImageUrl(`${image}?token=secret`), "");
  assert.equal(supportImageUrl(image.replace("https://", "http://")), "");
  assert.equal(supportClientContext({ schema_version: 2, source: "web" }), null);
  assert.equal(supportClientContext({ schema_version: 1, source: "android" })?.source, "android");
  assert.equal(supportClientContext({ schema_version: 1, source: "unknown" }), null);
  assert.equal(supportSourceLabel("android"), "Android");
  assert.equal(supportSourceLabel("ios"), "iOS");
  assert.equal(supportSourceLabel("web"), "Web");
});
