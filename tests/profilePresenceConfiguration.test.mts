import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  enabledProfilePresenceModes,
  parseProfilePresenceConfigurationPayload,
  profilePresenceConfigurationResponseData,
  profilePresenceConfigurationSaveBody,
  reconciledProfilePresenceCount,
} from "../lib/profilePresenceConfiguration.ts";
import {
  adminActionAccess,
  adminPrincipalFrom,
  isAdminActionAuthorized,
} from "../lib/adminActions.ts";

function payload() {
  return {
    configuration: {
      schema_version: 1,
      revision: 7,
      date_enabled: true,
      now_enabled: false,
      enabled_modes: ["online", "date", "invisible"],
      updated_at: 1_723_000_000,
      updated_by: "owner@friending.com",
    },
    mandatory_modes: ["online", "invisible"],
    optional_modes: ["date", "now"],
    selected_counts: { online: 11, date: 3, now: 0, invisible: 5 },
  };
}

test("the strict schema preserves mandatory modes, counts, and save revision", () => {
  const parsed = parseProfilePresenceConfigurationPayload(payload());
  assert.ok(parsed);
  assert.deepEqual(parsed.configuration.enabled_modes, ["online", "date", "invisible"]);
  assert.equal(parsed.selected_counts.date, 3);
  assert.deepEqual(profilePresenceConfigurationSaveBody(parsed.configuration), {
    expected_revision: 7,
    configuration: {
      schema_version: 1,
      date_enabled: true,
      now_enabled: false,
    },
  });
  assert.deepEqual(enabledProfilePresenceModes(false, true), ["online", "now", "invisible"]);
});

test("malformed catalogues fail closed instead of creating an editable fallback", () => {
  const cases: unknown[] = [];
  const wrongMandatory = structuredClone(payload());
  wrongMandatory.mandatory_modes = ["online"];
  cases.push(wrongMandatory);

  const reorderedEnabled = structuredClone(payload());
  reorderedEnabled.configuration.enabled_modes = ["date", "online", "invisible"];
  cases.push(reorderedEnabled);

  const missingCount = structuredClone(payload());
  delete (missingCount.selected_counts as Record<string, unknown>).now;
  cases.push(missingCount);

  const textualRevision = structuredClone(payload());
  textualRevision.configuration.revision = "7" as never;
  cases.push(textualRevision);

  const unknownMode = structuredClone(payload());
  unknownMode.configuration.enabled_modes = ["online", "date", "transparent"];
  cases.push(unknownMode);

  for (const value of cases) {
    assert.equal(parseProfilePresenceConfigurationPayload(value), null);
  }
});

test("response helpers use only Core's data envelope and validated reconciliation count", () => {
  const data = { ...payload(), save_result: { changed: true, reconciled_count: 3 } };
  const response = { success: true, data };
  assert.equal(profilePresenceConfigurationResponseData(response), data);
  assert.equal(reconciledProfilePresenceCount(response), 3);
  assert.equal(reconciledProfilePresenceCount({ success: true, data: { save_result: { reconciled_count: 3 } } }), null);
  assert.equal(reconciledProfilePresenceCount({ success: true, data: { save_result: { reconciled_count: -1 } } }), null);
});

test("the admin bridge exposes a read and editor-only write", () => {
  assert.equal(adminActionAccess("profile_presence_configuration"), "read");
  assert.equal(adminActionAccess("save_profile_presence_configuration"), "write");
  assert.equal(
    isAdminActionAuthorized("profile_presence_configuration", adminPrincipalFrom({ role: "viewer" })),
    true,
  );
  assert.equal(
    isAdminActionAuthorized("save_profile_presence_configuration", adminPrincipalFrom({ role: "viewer" })),
    false,
  );
});

test("the configuration screen locks mandatory choices and confirms destructive fallback", async () => {
  const [page, component] = await Promise.all([
    readFile(new URL("../app/(dashboard)/configuration/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ProfilePresenceConfiguration.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /<ProfilePresenceConfiguration\s*\/>/);
  assert.match(component, /MANDATORY_PROFILE_PRESENCE_MODES/);
  assert.match(component, /disabled=\{busy \|\| mandatory\}/);
  assert.match(component, /<ConfirmDialog/);
  assert.match(component, /reconciledProfilePresenceCount/);
  assert.match(component, /profile-presence-configuration-conflict/);
});

test("English and Hungarian presence-copy trees stay identical", async () => {
  const [en, hu] = await Promise.all([
    readFile(new URL("../messages/en.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../messages/hu.json", import.meta.url), "utf8").then(JSON.parse),
  ]);

  function paths(value: unknown, prefix = ""): string[] {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix];
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([key, child]) => paths(child, prefix ? `${prefix}.${key}` : key))
      .sort();
  }

  assert.deepEqual(paths(en.profilePresence), paths(hu.profilePresence));
});
