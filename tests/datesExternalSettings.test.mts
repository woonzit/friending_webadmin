import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { configurationInputValue, datesConfigurationRawValue, datesSettingEffectiveText } from "../lib/datesAdmin.ts";
import { DATES_RUNTIME_HELP_GROUPS } from "../lib/datesRuntimeHelp.ts";
import { DATES_EXTERNAL_CATEGORIES } from "../lib/datesExternalInput.ts";

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

test("HU copy distinguishes availability BE from the independent default-KI publication switch", () => {
  const configuration = JSON.parse(readFileSync(new URL("../messages/hu.json", import.meta.url), "utf8")).datesAdmin.configuration;
  const help = configuration.runtimeHelp.settings;
  assert.match(help.dates_external_events_enabled.purpose, /tárolt alapérték BE/);
  assert.match(help.dates_external_publishing_enabled.purpose, /Alapértéke KI/);
  assert.match(help.dates_external_events_enabled_overrides.effect, /üres objektum/);
  assert.doesNotMatch(help.dates_external_events_enabled_overrides.effect, /üres térkép/);
  assert.equal(datesSettingEffectiveText("boolean", true, { on: "BE", off: "KI" }), "BE");
  assert.equal(datesSettingEffectiveText("boolean", false, { on: "BE", off: "KI" }), "KI");
});

test("the full EN/HU category vocabulary matches canonical member-app copy", () => {
  // Lead 18:09 ruling; member-app table read from committed UI 969a8687.
  const expected = {
    en: ["Sports match", "Sports activity", "Concert", "Club night", "Festival", "Theatre", "Cinema", "Exhibition", "Talk", "Workshop", "Market", "Food and drink", "Community", "Outdoors", "Other event"],
    hu: ["Sportmérkőzés", "Sportprogram", "Koncert", "Klubest", "Fesztivál", "Színház", "Mozi", "Kiállítás", "Előadás", "Műhelyfoglalkozás", "Piac", "Étel és ital", "Közösségi program", "Szabadtéri program", "Egyéb esemény"],
  };
  const keys = ["sport_match", "sport_participation", "concert", "club_night", "festival", "theatre", "cinema", "exhibition", "talk", "workshop", "market", "food_drink", "community", "outdoor", "other"];
  assert.deepEqual([...DATES_EXTERNAL_CATEGORIES], keys);
  for (const locale of ["en", "hu"] as const) {
    const categories = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")).datesAdmin.external.form.categories;
    assert.deepEqual(Object.keys(categories).sort(), [...keys].sort());
    assert.deepEqual(keys.map((key) => categories[key]), expected[locale]);
  }
});
