import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  pingerAdminPayload,
  pingerConfigurationWire,
  pingerIconURL,
  validatePingerConfiguration,
} from "../lib/pinger.ts";

function payload(): Record<string, unknown> {
  return {
    success: true,
    data: {
      configuration: {
        schema_version: 1,
        revision: 3,
        enabled: false,
        action_key: "ping",
        icon: {
          light_url: "https://img.friending.co/api/cache/admin/pinger/light/icon.png",
          dark_url: "https://img.friending.co/api/cache/admin/pinger/dark/icon.png",
        },
        cooldown_seconds: 86400,
        retention_seconds: 604800,
        chat_gate_default: true,
        chat_contract_version: 1,
        copy: {
          button_label: { en: "Like", hu: "Kedvelés" },
          success_toast: { en: "Like sent", hu: "Elküldve" },
          cooldown_error: { en: "Wait {remaining}.", hu: "Várj {remaining}." },
          refusal_generic: { en: "Unavailable", hu: "Nem érhető el" },
          collector_tab_title: { en: "Likes", hu: "Kedvelések" },
          push_title: { en: "New like", hu: "Új kedvelés" },
          push_body: { en: "{sender} liked you", hu: "{sender} kedvelt" },
          banner_text: { en: "{sender} liked you", hu: "{sender} kedvelt" },
          chat_locked_gate: { en: "Send a like", hu: "Küldj kedvelést" },
        },
      },
      audit: [{
        id: "abc",
        actor_email: "admin@example.com",
        actor_role: "admin",
        action: "pinger.configuration.save",
        old_revision: 2,
        new_revision: 3,
        created_at: 1786400000,
      }],
      limits: {
        cooldown_min: 60,
        cooldown_max: 2592000,
        retention_min: 3600,
        retention_max: 7776000,
        copy_max_length: 240,
      },
      capabilities: { chat_contract_ready: false },
    },
  };
}

test("Pinger admin payload parses the frozen schema and writes the same material contract", () => {
  const parsed = pingerAdminPayload(payload());
  assert.ok(parsed);
  assert.equal(parsed.configuration.actionKey, "ping");
  assert.equal(parsed.configuration.copy.cooldown_error.hu, "Várj {remaining}.");
  assert.equal(parsed.capabilities.chatContractReady, false);
  assert.deepEqual(pingerConfigurationWire(parsed.configuration), {
    schema_version: 1,
    enabled: false,
    action_key: "ping",
    icon: {
      light_url: "https://img.friending.co/api/cache/admin/pinger/light/icon.png",
      dark_url: "https://img.friending.co/api/cache/admin/pinger/dark/icon.png",
    },
    // A fixture without the state pair still writes it, empty — which is what
    // makes the field additive rather than a migration.
    icon_liked: { light_url: "", dark_url: "" },
    // Derived, not defaulted blindly: this fixture HAS resting artwork, so
    // "use the app's own" must be off or saving would silently discard it.
    use_bundled_icons: false,
    cooldown_seconds: 86400,
    retention_seconds: 604800,
    chat_gate_default: true,
    chat_contract_version: 1,
    copy: parsed.configuration.copy,
  });
});

test("the icon state pair and the bundled switch survive a load/save round trip", () => {
  const managed = "https://img.friending.co/api/cache/admin/pinger";
  const withPair = payload();
  const configuration = ((withPair.data as Record<string, unknown>).configuration as Record<string, unknown>);
  configuration.icon_liked = {
    light_url: `${managed}/liked_light/icon.png`,
    dark_url: `${managed}/liked_dark/icon.png`,
  };
  configuration.use_bundled_icons = true;

  const parsed = pingerAdminPayload(withPair);
  assert.ok(parsed);
  assert.equal(parsed.configuration.iconLiked.lightUrl, `${managed}/liked_light/icon.png`);
  assert.equal(parsed.configuration.iconLiked.darkUrl, `${managed}/liked_dark/icon.png`);
  assert.equal(parsed.configuration.useBundledIcons, true);

  // The switch being on must not erase the uploads: turning it off has to
  // bring the artwork back rather than ask for four files again.
  const written = pingerConfigurationWire(parsed.configuration) as Record<string, unknown>;
  assert.deepEqual(written.icon_liked, {
    light_url: `${managed}/liked_light/icon.png`,
    dark_url: `${managed}/liked_dark/icon.png`,
  });
  assert.equal(written.use_bundled_icons, true);
});

test("a configuration with no artwork at all defaults to the bundled icons", () => {
  const bare = payload();
  const configuration = ((bare.data as Record<string, unknown>).configuration as Record<string, unknown>);
  configuration.icon = { light_url: "", dark_url: "" };

  const parsed = pingerAdminPayload(bare);
  assert.ok(parsed);
  assert.equal(parsed.configuration.useBundledIcons, true);
});

test("a foreign liked-icon origin is refused like every other slot", () => {
  const foreign = payload();
  const configuration = ((foreign.data as Record<string, unknown>).configuration as Record<string, unknown>);
  configuration.icon_liked = { light_url: "https://example.invalid/liked.png", dark_url: "" };

  assert.equal(pingerAdminPayload(foreign), null);
});

test("copy validation counts Unicode scalars and rejects duplicate or extra tokens", () => {
  const emojiBoundary = payload();
  const copy = (((emojiBoundary.data as Record<string, unknown>).configuration as Record<string, unknown>).copy as Record<string, unknown>);
  copy.button_label = { en: "😀".repeat(240), hu: "😀".repeat(240) };
  assert.ok(pingerAdminPayload(emojiBoundary));

  const overBoundary = payload();
  const longCopy = (((overBoundary.data as Record<string, unknown>).configuration as Record<string, unknown>).copy as Record<string, unknown>);
  longCopy.button_label = { en: "😀".repeat(241), hu: "Rendben" };
  assert.equal(pingerAdminPayload(overBoundary), null);

  const duplicate = payload();
  const duplicateCopy = (((duplicate.data as Record<string, unknown>).configuration as Record<string, unknown>).copy as Record<string, unknown>);
  duplicateCopy.push_body = { en: "{sender} and {sender}", hu: "{sender} és {sender}" };
  assert.equal(pingerAdminPayload(duplicate), null);

  const parsed = pingerAdminPayload(payload());
  assert.ok(parsed);
  parsed.configuration.copy.banner_text.en = "{sender} {other}";
  assert.ok(validatePingerConfiguration(parsed.configuration, parsed.limits)["copy.banner_text.en"]);
});

test("managed icon validation rejects traversal, query and encoded paths", () => {
  assert.equal(pingerIconURL("https://img.friending.co/api/cache/../../secret.png"), null);
  assert.equal(pingerIconURL("https://img.friending.co/api/cache/%2e%2e/secret.png"), null);
  assert.equal(pingerIconURL("https://img.friending.co/api/cache/icon.png?redirect=1"), null);
  assert.equal(
    pingerIconURL("https://img.friending.co/api/cache/admin/pinger/light/icon.png"),
    "https://img.friending.co/api/cache/admin/pinger/light/icon.png",
  );
});

test("malformed copy, unknown chat versions and foreign icon origins fail closed", () => {
  const missingToken = payload();
  const copy = ((missingToken.data as Record<string, unknown>).configuration as Record<string, unknown>).copy as Record<string, unknown>;
  copy.cooldown_error = { en: "Wait", hu: "Várj" };
  assert.equal(pingerAdminPayload(missingToken), null);

  const unknownVersion = payload();
  (((unknownVersion.data as Record<string, unknown>).configuration as Record<string, unknown>)).chat_contract_version = 2;
  assert.equal(pingerAdminPayload(unknownVersion), null);

  const foreignIcon = payload();
  const icon = (((foreignIcon.data as Record<string, unknown>).configuration as Record<string, unknown>).icon as Record<string, unknown>);
  icon.light_url = "https://example.com/icon.png";
  assert.equal(pingerAdminPayload(foreignIcon), null);
});

test("the same-origin bridge classifies Pinger reads and writes and provides a bounded upload route", async () => {
  const actions = await readFile(new URL("../lib/adminActions.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/admin/upload-pinger-icon/route.ts", import.meta.url), "utf8");
  assert.match(actions, /"pinger_admin"/);
  assert.match(actions, /"save_pinger_config"/);
  assert.match(actions, /pinger_admin:\s*"read"/);
  assert.match(actions, /save_pinger_config:\s*"write"/);
  assert.match(route, /MAX_ADMIN_PROFILE_ICON_BYTES/);
  assert.match(route, /requireAdminWriter/);
  assert.match(route, /upload_pinger_icon/);
  assert.match(route, /coreMultipartCall/);
  assert.doesNotMatch(route, /image_b64/);
});
