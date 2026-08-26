import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  cloneInviteConfiguration,
  inviteDraftIssue,
  inviteSaveBody,
  normalizedStorefront,
  parseInviteConfigurationPayload,
} from "../lib/inviteConfiguration.ts";

function payload(): Record<string, unknown> {
  return {
    configuration: {
      schema_version: 2,
      revision: 7,
      enabled: true,
      global: {
        mode: "server_sms",
        messages: {
          en: "Find me here: {user_url}",
          hu: "Itt találsz: {user_url}",
          de: "Hier: {user_url}",
        },
      },
      overrides: [
        {
          storefront: "HUN",
          mode: "device_sms",
          active: true,
          messages: { hu: "Szia {display_name}: {user_url}" },
        },
      ],
      updated_at: 1786300000,
    },
    modes: ["server_sms", "device_sms"],
    placeholders: ["{user_url}", "{display_name}"],
    limits: { template_length: 600, overrides: 250 },
  };
}

test("the complete Core payload parses and round-trips without dropping future languages", () => {
  const parsed = parseInviteConfigurationPayload(payload());
  assert.ok(parsed);
  assert.equal(parsed.configuration.global.messages.de, "Hier: {user_url}");
  assert.equal(parsed.configuration.overrides[0]?.mode, "device_sms");

  const draft = cloneInviteConfiguration(parsed.configuration);
  draft.global.messages.de = "Neu: {user_url}";
  assert.notEqual(parsed.configuration.global.messages.de, draft.global.messages.de);
  assert.deepEqual(inviteSaveBody(draft), {
    expected_revision: 7,
    configuration: {
      enabled: true,
      global: draft.global,
      overrides: draft.overrides,
    },
  });
});

test("malformed modes, duplicate storefronts and templates without the profile URL fail closed", () => {
  const badMode = payload();
  (badMode.configuration as { global: { mode: string } }).global.mode = "email";
  assert.equal(parseInviteConfigurationPayload(badMode), null);

  const duplicate = payload();
  const configuration = duplicate.configuration as { overrides: unknown[] };
  configuration.overrides.push({
    storefront: "HUN",
    mode: "server_sms",
    active: false,
    messages: {},
  });
  assert.equal(parseInviteConfigurationPayload(duplicate), null);

  const missingUrl = payload();
  (missingUrl.configuration as { global: { messages: Record<string, string> } }).global.messages.en = "No link";
  assert.equal(parseInviteConfigurationPayload(missingUrl), null);
});

test("draft validation catches incomplete storefront rows and inherited overrides remain legal", () => {
  const parsed = parseInviteConfigurationPayload(payload());
  assert.ok(parsed);
  assert.equal(inviteDraftIssue(parsed.configuration), null);

  const incomplete = cloneInviteConfiguration(parsed.configuration);
  incomplete.overrides.push({ storefront: "", mode: "server_sms", active: true, messages: {} });
  assert.equal(inviteDraftIssue(incomplete), "storefront");

  incomplete.overrides[1]!.storefront = "USA";
  assert.equal(inviteDraftIssue(incomplete), null, "blank override messages inherit the global copy");
  incomplete.overrides[1]!.messages.hu = "";
  assert.equal(inviteDraftIssue(incomplete), null, "a cleared override field also inherits global copy");
  assert.equal(normalizedStorefront(" h-u1n "), "HUN");
});

test("the advertised delivery-mode catalogue must contain each supported mode exactly once", () => {
  const duplicateModes = payload();
  duplicateModes.modes = ["server_sms", "server_sms"];
  assert.equal(parseInviteConfigurationPayload(duplicateModes), null);
});

test("the same-origin bridge explicitly classifies both invite actions", async () => {
  const source = await readFile(new URL("../lib/adminActions.ts", import.meta.url), "utf8");
  assert.match(source, /"invite_configuration"/);
  assert.match(source, /"save_invite_configuration"/);
  assert.match(source, /invite_configuration:\s*"read"/);
  assert.match(source, /save_invite_configuration:\s*"write"/);
  assert.match(source, /save_invite_configuration:\s*INVITE_CONFIGURATION_BODY_LIMIT_BYTES/);
});
