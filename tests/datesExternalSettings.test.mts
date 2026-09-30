import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { configurationInputValue, datesConfigurationRawValue, datesSettingEffectiveText } from "../lib/datesAdmin.ts";
import { DATES_RUNTIME_HELP_GROUPS } from "../lib/datesRuntimeHelp.ts";

test("P1 integer settings retain raw input for Core's strict parser", () => {
  for (const key of ["dates_event_invite_daily_limit", "dates_event_invite_per_event_limit", "dates_event_lookahead_days"]) {
    for (const raw of ["20", "1.5", "01", "20days", "", "true", "1e2", " 20 "])
      assert.equal(configurationInputValue("integer", raw, key), raw);
  }
  assert.equal(configurationInputValue("integer", "42", "dates_tbd_expiry_days"), 42, "known legacy behavior unchanged");
});

test("storefront map is readable/editable JSON, never object coercion or numeric input", () => {
  const map = { HUN: true, USA: false };
  const raw = datesConfigurationRawValue("storefront_overrides", map);
  assert.deepEqual(JSON.parse(raw), map);
  assert.equal(configurationInputValue("storefront_overrides", raw), raw, "Core validates authoritative country vocabulary");
  assert.equal(datesConfigurationRawValue("storefront_overrides", []), "{}");
  assert.equal(datesSettingEffectiveText("storefront_overrides", []), "{}");
  assert.equal(datesSettingEffectiveText("storefront_overrides", map), JSON.stringify(map));
  for (const invalid of [null, "bad", [true], { HUN: "false" }, { hu: true }])
    assert.equal(datesSettingEffectiveText("storefront_overrides", invalid), "—");
  assert.equal(datesConfigurationRawValue("quiet_hours", { start: "23:00", end: "07:00" }), "23:00|07:00");
  const page = readFileSync(new URL("../app/(dashboard)/dates/configuration/page.tsx", import.meta.url), "utf8");
  assert.match(page, /setting\.type === "storefront_overrides" \? <label[^\n]*<textarea/);
  assert.match(page, /configurationInputValue\(setting\.type, value, setting\.key\)/);
});

test("P1 exposes only the six committed settings, including the independent default-OFF publication switch", () => {
  const group = DATES_RUNTIME_HELP_GROUPS.find((item) => item.id === "externalEvents");
  assert.ok(group);
  assert.equal(group.settingKeys.length, 6);
  assert.equal(group.settingKeys.some((key) => /ai_|autopublish|research|suggestion/.test(key)), false);
  for (const locale of ["en", "hu"]) {
    const configuration = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")).datesAdmin.configuration;
    assert.ok(configuration.storefrontOverridesHelp);
    assert.ok(configuration.runtimeHelp.groups.externalEvents.copy);
    for (const key of group.settingKeys) for (const field of ["title", "purpose", "effect", "caution"])
      assert.ok(configuration.runtimeHelp.settings[key][field], `${locale}.${key}.${field}`);
  }
});
