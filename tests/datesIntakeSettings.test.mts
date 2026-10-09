import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  DATES_AI_MODEL_SETTING_KEYS, DATES_SETTING_EDITOR_TYPES, configurationInputValue, datesConfigurationRawValue, datesModelIdValid,
  datesSettingEditable, datesSettingEffectiveText, datesStringListFromInput, datesStringListProblem, datesTicketDomainValid,
} from "../lib/datesAdmin.ts";
import { DATES_RUNTIME_HELP_GROUPS, DATES_RUNTIME_HELP_KEYS } from "../lib/datesRuntimeHelp.ts";
import { DATES_AI_PROVIDERS } from "../lib/datesIntakeAdmin.ts";
import { LEADERBOARD_SETTING_KEYS, isLeaderboardSettingKey } from "../lib/datesSuggestionLeaderboard.ts";

// T-865 P2a / P2b: the intake settings of the Dates configuration read. Core serves them only to a request that
// carries the Admin intake contract selector (D-143): the genuine body is `admin-configuration.json` of the intake
// corpus (Core a5bbba5c): 50 rows of the generic list and, after them, the four of the submission leaderboard, which
// have their own card. Without the selector the read is the 33 P1 rows (`admin-configuration-released-console`).
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/dates_event_intake_admin_wire/admin-${name}.json`, import.meta.url), "utf8"));
const page = readFileSync(new URL("../app/(dashboard)/dates/configuration/page.tsx", import.meta.url), "utf8");
const INTAKE: Array<[string, string, unknown]> = [
  ["dates_external_admin_drafts_enabled", "boolean", false], ["dates_ai_monthly_budget_usd", "integer", 50],
  ["dates_ai_provider_order", "string_list", ["openai", "gemini", "anthropic"]], ["dates_ai_openai_model", "string", "gpt-6.1-sol"],
  ["dates_ai_openai_adjudication_model", "string", "gpt-6-luna"], ["dates_ai_gemini_model", "string", "gemini-3.8-flash"],
  ["dates_event_intake_retention_days", "integer", 30], ["dates_event_ticket_domains", "string_list", ["jegy.hu", "eventim.hu", "tixa.hu", "ticketmaster.com"]],
];

// The nine settings of the member channel (P2b), as Core's default configuration serves them after the eight above.
const SUGGESTION: Array<[string, string, unknown]> = [
  ["dates_external_suggestions_enabled", "boolean", false], ["dates_event_suggestion_daily_limit", "integer", 5],
  ["dates_event_suggestion_monthly_limit", "integer", 20], ["dates_event_suggestion_open_limit", "integer", 3],
  ["dates_event_suggestion_strike_limit", "integer", 3], ["dates_event_suggestion_strike_window_days", "integer", 30],
  ["dates_event_suggestion_ban_days", "integer", 30], ["dates_event_suggestion_consent_version", "integer", 1],
  ["dates_external_autopublish_enabled", "boolean", false],
];

test("genuine configuration with the selector: the eight intake settings and the nine of the member channel follow the 33 P1 rows, each with an editor; the switches default OFF", () => {
  const served = fixture("configuration").settings as Array<Record<string, any>>;
  assert.equal(served.length, 54);
  // The last four are the submission leaderboard's (Core 7175aabe). They are not rows of the generic list - the page
  // hands them to their own card - so the list this test is about is the 50 before them.
  assert.deepEqual(served.slice(50).map((row) => row.key).sort(), [...LEADERBOARD_SETTING_KEYS].sort());
  const settings = served.filter((row) => !isLeaderboardSettingKey(row.key));
  assert.deepEqual(settings, served.slice(0, 50));
  // Core's defaults, row by row. (In this capture the three switches had been turned on for the corpus; their default is off.)
  assert.deepEqual(settings.slice(33, 41).map((row) => [row.key, row.type, row.default_value]), INTAKE);
  assert.deepEqual(settings.slice(41).map((row) => [row.key, row.type, row.default_value]), SUGGESTION);
  const SWITCHES = ["dates_external_admin_drafts_enabled", "dates_external_suggestions_enabled", "dates_external_autopublish_enabled"];
  for (const key of SWITCHES) {
    const row = settings.find((item) => item.key === key)!;
    assert.deepEqual([row.type, row.default_value, row.value, row.effective_value, row.revision], ["boolean", false, true, true, 1], key);
    assert.equal(datesSettingEffectiveText("boolean", row.default_value, { on: "ON", off: "OFF" }), "OFF");
  }
  for (const row of settings) assert.equal(datesSettingEditable(row.type), true, `${row.key}: ${row.type}`);
  for (const row of settings.slice(33)) {
    assert.deepEqual(row.effective_value, row.value);
    if (!SWITCHES.includes(row.key)) { assert.deepEqual(row.default_value, row.value); assert.equal(row.revision, 0); }
    // Never the number field's "[object Object]" or an empty box for a list.
    const raw = datesConfigurationRawValue(row.type, row.value);
    assert.doesNotMatch(raw, /object Object/);
    const text = datesSettingEffectiveText(row.type, row.effective_value, { on: "ON", off: "OFF" });
    assert.notEqual(text, "—"); assert.doesNotMatch(text, /object Object/);
    // An unchanged row saves back exactly the value Core stored.
    const saved = configurationInputValue(row.type, raw, row.key);
    assert.deepEqual(row.type === "integer" ? Number(saved) : saved, row.value, row.key);
  }
  // Without the selector Core serves the released console its 33 P1 rows: the same rows, and none of the intake's.
  const released = fixture("configuration-released-console").settings as Array<Record<string, any>>;
  assert.equal(released.length, 33); assert.deepEqual(released, settings.slice(0, 33));
  assert.equal(released.some((row) => row.key.startsWith("dates_ai_") || row.key.includes("suggestion") || row.key.includes("intake")), false);
  const order = settings[35];
  assert.deepEqual([order.minimum, order.maximum, order.allowed_values], [1, 3, [...DATES_AI_PROVIDERS]]);
  assert.equal(datesSettingEffectiveText("string_list", order.effective_value), "openai, gemini, anthropic");
  const domains = settings[40];
  assert.deepEqual([domains.minimum, domains.maximum, domains.allowed_values], [0, 50, null]);
  assert.equal(datesConfigurationRawValue("string_list", domains.value), "jegy.hu\neventim.hu\ntixa.hu\nticketmaster.com");
});

test("a model id is text for Core to validate, never a number field", () => {
  for (const key of DATES_AI_MODEL_SETTING_KEYS) {
    assert.equal(configurationInputValue("string", "  gpt-6.1-sol ", key), "gpt-6.1-sol");
    assert.equal(configurationInputValue("string", "42", key), "42", "a number typed into the field stays a string for Core to refuse");
  }
  for (const value of ["gpt-6.1-sol", "gpt-6-luna", "gemini-3.8-flash", "claude-opus-5", "o5", "a", "model_v2.1-preview"]) assert.equal(datesModelIdValid(value), true, value);
  // Core's shape: starts with a lower-case letter, lower-case letters and digits joined by . _ -, at most 64 characters and 12 parts.
  for (const value of ["", "42", "6.1-sol", "GPT-6", "gpt 6", "gpt-6-", "gpt--6", "gpt-6/luna", "models/gemini-3.8-flash", "a".repeat(65), "a.b.c.d.e.f.g.h.i.j.k.l.m"])
    assert.equal(datesModelIdValid(value), false, value);
  // The page offers a text input for a string and checks only the model keys by shape.
  assert.match(page, /setting\.type === "string" \? <label className="field"><span>\{t\("stringLabel"\)\}<\/span><input type="text"/);
  assert.match(page, /\(DATES_AI_MODEL_SETTING_KEYS as readonly string\[\]\)\.includes\(setting\.key\) && !datesModelIdValid\(value\.trim\(\)\)/);
});

test("a list of strings is edited as a list: provider order from the closed three, ticket sites as host names", () => {
  const order = { key: "dates_ai_provider_order", minimum: 1, maximum: 3, allowed_values: ["openai", "gemini", "anthropic"] };
  assert.deepEqual(datesStringListFromInput("gemini\nopenai\n"), ["gemini", "openai"]);
  assert.deepEqual(datesStringListFromInput(" jegy.hu , eventim.hu\n\n tixa.hu "), ["jegy.hu", "eventim.hu", "tixa.hu"]);
  assert.deepEqual(configurationInputValue("string_list", "gemini\nopenai", order.key), ["gemini", "openai"]);
  assert.deepEqual(configurationInputValue("string_list", "", "dates_event_ticket_domains"), [], "an empty list is a list, not an empty string");
  assert.equal(datesStringListProblem(order, ["gemini", "openai"]), null);
  assert.equal(datesStringListProblem(order, ["anthropic"]), null);
  assert.equal(datesStringListProblem(order, []), "count");
  assert.equal(datesStringListProblem(order, ["openai", "gemini", "anthropic", "openai"]), "count");
  assert.equal(datesStringListProblem(order, ["openai", "openai"]), "duplicate");
  assert.equal(datesStringListProblem(order, ["openai", "mistral"]), "value");
  const domains = { key: "dates_event_ticket_domains", minimum: 0, maximum: 50, allowed_values: null };
  assert.equal(datesStringListProblem(domains, []), null, "no ticketing site at all is allowed");
  assert.equal(datesStringListProblem(domains, ["jegy.hu", "tickets.example.co.uk", "a-b.example"]), null);
  assert.equal(datesStringListProblem(domains, Array.from({ length: 51 }, (_, index) => `site${index}.example`)), "count");
  assert.equal(datesStringListProblem(domains, ["jegy.hu", "jegy.hu"]), "duplicate");
  for (const host of ["www.jegy.hu", "https://jegy.hu", "jegy.hu/tickets", "Jegy.hu", "jegy", "jegy.h", "-jegy.hu", "jegy..hu", "192.168.1.1", "jegy.hu:443", "user@jegy.hu"]) {
    assert.equal(datesTicketDomainValid(host), false, host);
    assert.equal(datesStringListProblem(domains, ["eventim.hu", host]), "host", host);
  }
  assert.equal(datesStringListProblem(domains, ["a".repeat(251) + ".hu"]), "length", "254 bytes: Core bounds an item at 253");
  assert.equal(datesStringListProblem(domains, ["a".repeat(250) + ".hu"]), "host", "253 bytes fit, but a label is at most 63");
  // Another list Core may add later is bounded only by what its own row says.
  assert.equal(datesStringListProblem({ key: "dates_future_list", minimum: null, maximum: null, allowed_values: null }, ["Anything goes", "www.example.org"]), null);
  // The ordered editor is offered for a closed list, the one-per-line editor otherwise.
  assert.match(page, /const ordered = setting\.type === "string_list" && Array\.isArray\(setting\.allowed_values\) \? setting\.allowed_values : null;/);
  assert.match(page, /: ordered \? <div className="field"><span>\{t\("orderedListLabel"\)\}<\/span><ol className="dates-ordered-list">/);
  assert.match(page, /: setting\.type === "string_list" \? <label className="field"><span>\{t\("stringListLabel"\)\}<\/span><textarea/);
});

test("the intake budget and retention keep the raw input for Core's own integer parser", () => {
  for (const key of ["dates_ai_monthly_budget_usd", "dates_event_intake_retention_days"])
    for (const raw of ["0", "50", "1.5", "01", "20days", "", " 30 "]) assert.equal(configurationInputValue("integer", raw, key), raw);
  assert.equal(configurationInputValue("integer", "42", "dates_tbd_expiry_days"), 42, "known legacy behaviour unchanged");
});

test("a row type this console does not know is shown read-only, never through the number field, and cannot be saved", () => {
  assert.deepEqual([...DATES_SETTING_EDITOR_TYPES], ["boolean", "integer", "nullable_integer", "enum", "quiet_hours", "storefront_overrides", "string", "string_list"]);
  for (const type of ["duration", "json", "url", "String", "", null, undefined, 7]) assert.equal(datesSettingEditable(type), false, String(type));
  assert.equal(datesConfigurationRawValue("duration", { minutes: 5 }), "{\"minutes\":5}");
  assert.equal(datesConfigurationRawValue("geo_list", ["a", { b: 1 }]), "[\"a\",{\"b\":1}]");
  assert.equal(datesSettingEffectiveText("duration", { minutes: 5 }), "{\"minutes\":5}");
  // The unknown-type branch comes before every editor that could accept typing, and before the number field.
  const unknown = page.indexOf(": !editable ? <label"), number = page.indexOf(": <input type=\"number\""), text = page.indexOf("setting.type === \"string\" ? <label");
  assert.ok(unknown > 0 && unknown < text && text < number);
  assert.match(page, /const editable = datesSettingEditable\(setting\.type\);/);
  assert.match(page, /if \(!editable \|\| reason\.trim\(\)\.length < 3 \|\| busy\) return;/);
  assert.match(page, /\{canManage && editable && <><label className="field"><span>\{t\("auditReason"\)\}/);
  assert.equal((page.match(/type="number"/g) ?? []).length, 3, "the setting editor's number field, and the two order fields of the catalogue editors");
});

test("the intake settings have their own help group and full help in both languages", () => {
  const group = DATES_RUNTIME_HELP_GROUPS.find((item) => item.id === "eventIntake");
  assert.ok(group);
  assert.deepEqual([...group.settingKeys], INTAKE.map(([key]) => key));
  const suggestion = DATES_RUNTIME_HELP_GROUPS.find((item) => item.id === "eventSuggestion");
  assert.ok(suggestion);
  assert.deepEqual([...suggestion.settingKeys], SUGGESTION.map(([key]) => key));
  assert.deepEqual(DATES_RUNTIME_HELP_KEYS.slice(-17), [...INTAKE, ...SUGGESTION].map(([key]) => key));
  // Every setting the generic list shows is documented: nothing falls into the "undocumented" list of the help dialog.
  // (Not rows of that list: the section switch, and the leaderboard's four, whose help is their card's and the page's.)
  const served = (fixture("configuration").settings as Array<{ key: string }>).map((row) => row.key).filter((key) => key !== "dates_enabled" && !isLeaderboardSettingKey(key));
  assert.equal(served.length, 49);
  assert.deepEqual(served.filter((key) => !(DATES_RUNTIME_HELP_KEYS as string[]).includes(key)), []);
  for (const locale of ["en", "hu"]) {
    const configuration = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")).datesAdmin.configuration;
    assert.ok(configuration.runtimeHelp.groups.eventIntake.title.length > 10 && configuration.runtimeHelp.groups.eventIntake.copy.length > 80);
    assert.ok(configuration.runtimeHelp.groups.eventSuggestion.title.length > 10 && configuration.runtimeHelp.groups.eventSuggestion.copy.length > 80);
    for (const key of ["dates_external_suggestions_enabled", "dates_external_autopublish_enabled"])
      assert.match(configuration.runtimeHelp.settings[key].purpose, locale === "en" ? /default is OFF/ : /Alapértéke KI/, key);
    for (const [key] of [...INTAKE, ...SUGGESTION]) for (const field of ["title", "purpose", "effect", "caution"])
      assert.ok(configuration.runtimeHelp.settings[key][field].length > (field === "title" ? 8 : 40), `${locale}.${key}.${field}`);
    for (const key of ["unknownTypeLabel", "unknownTypeHelp", "stringLabel", "stringHelp", "modelIdHelp", "modelIdInvalid", "orderedListLabel", "orderedListUp",
      "orderedListDown", "orderedListRemove", "orderedListAdd", "orderedListHelp", "stringListLabel", "stringListHelp", "ticketDomainsHelp"]) assert.ok(configuration[key], `${locale}.${key}`);
    assert.deepEqual(Object.keys(configuration.stringListProblems).sort(), ["count", "duplicate", "host", "length", "value"]);
    assert.match(configuration.stringListProblems.count, /\{minimum\}.*\{maximum\}/);
    assert.match(configuration.runtimeHelp.settings.dates_external_admin_drafts_enabled.purpose, locale === "en" ? /default is OFF/ : /Alapértéke KI/);
    assert.match(configuration.runtimeHelp.settings.dates_ai_monthly_budget_usd.effect, /80%/);
  }
});
