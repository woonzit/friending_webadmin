import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import {
  PERSONA_SCREENS_CORE_REFUSAL_STATUSES,
  PERSONA_SCREENS_CORE_UNCERTAIN_STATUSES,
  PERSONA_SCREENS_REFERENCE_AUTHORITY,
  PERSONA_SCREEN_EXTERNAL_LINK_FIELD_BYTE_LIMITS,
  PERSONA_SCREEN_EXTERNAL_LINK_FIELDS,
  PERSONA_SCREEN_EXTERNAL_LINK_URL_SCHEMES,
  PERSONA_SCREEN_KEYS,
  PERSONA_SCREEN_LANGUAGES,
  PERSONA_SCREEN_PRESENTATION_SLOTS,
  PERSONA_SCREEN_SLOTS,
  decodePersonaScreensConsoleResponse,
  decodePersonaScreensSaveResponse,
  normalizePersonaScreensProxyBody,
  personaScreensForLanguage,
  personaScreensPublishedBlock,
  type PersonaScreenLanguage,
  type PersonaScreenMap,
  type PersonaScreensCopyDefault,
} from "../lib/personaScreens.ts";

/**
 * T-550's production-generated wire corpus (Core `tests/fixtures/persona_screens_wire/`),
 * rebound by T-593 to released provider tip `955eba61217a70f12a993e1ca5324e96f843f203`
 * and D-089 behaviour commit `5e4591b6…`, copied byte-identically. Every body here came out of the
 * production resolver, the production admin service and the production
 * encoders, so the Webadmin decoders are verified against what Core actually
 * publishes rather than against a reading of the contract.
 *
 * KNOWN CORPUS DEFECT, T-588: the mid-translation fixture stores the app's OWN
 * compiled Hungarian in both of its translated slots, and four of the nine
 * English slots have the same property. So an assertion of the form "the stored
 * value is the one that appears" is partly vacuous ON THIS CORPUS — it would
 * pass against a console that had served nothing at all. The structural half of
 * every binding below (which slots appear, and for which language) is not
 * vacuous, and the value half is covered separately in
 * `tests/personaScreens.test.mts` with values no app string could be mistaken
 * for.
 *
 * T-593's additive D-089 release changed the provider contract digest but no
 * body in this 17-case corpus. Link-bearing decoder/publication cases therefore
 * live in the focused model/editor suites with explicit OPERATOR sentinels;
 * pretending an unchanged body exercised the new slot would be vacuous.
 */
const FIXTURE_DIRECTORY = new URL("./fixtures/persona_screens_wire/", import.meta.url);
const FIXTURE_CONTRACT_VERSION = 1;
const FIXTURE_SOURCE_COMMIT = "5e4591b6a9ae41a283798654eaa2ae3bae95c4ef";
const FIXTURE_MANIFEST_SHA256 = "43d60ab09910a591d6deb0ad50c3308af3dddbd1816fd59405b30877078c083f";
const FIXTURE_SET_SHA256 = "7b9f1642acf40d7f16840824642c8a78bd317b8f0f82fbfc552695ae869e770c";
const FIXTURE_CONTRACT_MANIFEST_SHA256 =
  "68bc244bc2781d1679bb88b87d4145a24fb1d9cafaf9c87bafdb7e9757a29f74";
const FIXTURE_GENERATOR_SHA256 = "b440fd6cffdd4a904bae4d1ccc206ea9a7d7d24b42bbe9cffe54a15f9cd88077";
const FIXTURE_BODY_COUNT = 17;

/** Contract §6 — the complete refusal vocabulary and its exact statuses. */
const PUBLISHED_ERROR_STATUSES: Readonly<Record<string, number>> = {
  "admin-session-invalid": 401,
  "admin-revoked": 403,
  "admin-write-required": 403,
  "persona-screens-conflict": 409,
  "persona-screens-invalid": 422,
  "persona-screens-copy-default-invalid": 422,
  "persona-screens-revision-invalid": 422,
  "persona-screens-write-failed": 503,
  "persona-screens-unavailable": 503,
};

type Json = Record<string, any>;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fixture(file: string): Promise<Json> {
  return JSON.parse(await readFile(new URL(file, FIXTURE_DIRECTORY), "utf8"));
}

async function manifest(): Promise<Json> {
  return fixture("manifest.json");
}

/** The one stored configuration most cases resolve against, read from the corpus itself. */
async function storedMidTranslation(): Promise<PersonaScreensCopyDefault> {
  return (await fixture("console-read-clean.json")).data.copy_default as PersonaScreensCopyDefault;
}

function publishedScreens(stored: unknown, language: PersonaScreenLanguage): Json {
  const block = personaScreensPublishedBlock(
    personaScreensForLanguage(stored as PersonaScreensCopyDefault, language),
    language,
  );
  return { contract_version: block.contract_version, lang: block.lang, screens: block.screens };
}

test("the published Persona screens corpus is byte-identical, complete and traceable to its Core source commit", async () => {
  const manifestBytes = await readFile(new URL("manifest.json", FIXTURE_DIRECTORY));
  assert.equal(sha256(manifestBytes), FIXTURE_MANIFEST_SHA256, "manifest.json must match its published byte hash");
  const published = await manifest();
  assert.deepEqual(Object.keys(published).sort(), [
    "contract_manifest_sha256",
    "contract_version",
    "fixture_set_sha256",
    "fixtures",
    "provenance",
    "schema_version",
    "source_commit",
  ]);
  assert.equal(published.schema_version, 1);
  assert.equal(published.contract_version, FIXTURE_CONTRACT_VERSION);
  assert.equal(published.source_commit, FIXTURE_SOURCE_COMMIT);
  assert.equal(published.contract_manifest_sha256, FIXTURE_CONTRACT_MANIFEST_SHA256);
  assert.equal(published.fixture_set_sha256, FIXTURE_SET_SHA256);
  assert.deepEqual(Object.keys(published.provenance).sort(), [
    "generator", "generator_sha256", "source_paths", "wire_adapters",
  ]);
  assert.equal(published.provenance.generator, "tests/persona_screens_fixture_dump.php");
  assert.equal(published.provenance.generator_sha256, FIXTURE_GENERATOR_SHA256);
  assert.deepEqual(published.provenance.wire_adapters, {
    app_config: "Friending\\Core\\Response::wirePayload",
    webadmin: "Friending\\Support\\Webadmin::noStoreReply",
  });
  assert.equal(published.provenance.source_paths.length, 15);
  for (const path of [
    "src/Http/Controllers/PersonaScreensAdminController.php",
    "src/Services/PersonaScreensAdminService.php",
    "src/Support/PersonaScreensAdminPolicy.php",
    "src/Support/PersonaScreensPolicy.php",
  ]) {
    assert.ok(published.provenance.source_paths.includes(path), path);
  }

  const rows = published.fixtures as Json[];
  assert.equal(rows.length, FIXTURE_BODY_COUNT);
  const files = rows.map((row) => row.file as string);
  assert.deepEqual(files, [...files].sort(), "the manifest lists fixtures in sorted order");
  assert.equal(new Set(files).size, files.length);
  assert.deepEqual((await readdir(FIXTURE_DIRECTORY)).sort(), [...files, "manifest.json"].sort());

  const consumers = new Map<string, number>();
  const setLines: string[] = [];
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ["case", "consumer", "file", "route", "sha256"]);
    assert.match(row.file, /^[a-z0-9-]+\.json$/u);
    assert.ok(["webadmin", "ios"].includes(row.consumer), row.file);
    if (row.consumer === "webadmin") {
      assert.match(row.route, /^\/v1\/webadmin\/persona_screens_(?:console|save)$/u, row.file);
    } else {
      assert.equal(row.route, "/v1/app/ios_appconfig", row.file);
    }
    const bytes = await readFile(new URL(row.file, FIXTURE_DIRECTORY));
    assert.equal(sha256(bytes), row.sha256, `${row.file} must match its published byte hash`);
    assert.doesNotThrow(() => JSON.parse(bytes.toString("utf8")));
    consumers.set(row.consumer, (consumers.get(row.consumer) ?? 0) + 1);
    setLines.push(`${row.file}\0${row.sha256}`);
  }
  assert.deepEqual(Object.fromEntries([...consumers].sort()), { ios: 8, webadmin: 9 });
  assert.equal(sha256(setLines.join("\n")), FIXTURE_SET_SHA256, "the fixture-set hash is the sha256 over `file\\0sha256` rows");
});

test("the local D-089 vocabulary matches the provider contract bound by the corpus manifest", () => {
  assert.deepEqual(PERSONA_SCREEN_PRESENTATION_SLOTS, {
    pre: ["headline", "subtitle", "external_link", "cta"],
    success: ["headline", "subtitle", "cta"],
    failed: ["headline", "subtitle", "cta"],
  });
  assert.deepEqual([...PERSONA_SCREEN_EXTERNAL_LINK_FIELDS], ["label", "url"]);
  assert.deepEqual(PERSONA_SCREEN_EXTERNAL_LINK_FIELD_BYTE_LIMITS, { label: 80, url: 2048 });
  assert.deepEqual([...PERSONA_SCREEN_EXTERNAL_LINK_URL_SCHEMES], ["https"]);
});

test("the production refusal maps equal Core's published vocabulary exactly", () => {
  const local = new Map<string, number>([
    ...PERSONA_SCREENS_CORE_REFUSAL_STATUSES,
    ...PERSONA_SCREENS_CORE_UNCERTAIN_STATUSES,
  ]);
  assert.equal(
    local.size,
    PERSONA_SCREENS_CORE_REFUSAL_STATUSES.size + PERSONA_SCREENS_CORE_UNCERTAIN_STATUSES.size,
    "no name is both refused and uncertain",
  );
  assert.deepEqual(
    [...local].sort(([left], [right]) => left.localeCompare(right)),
    Object.entries(PUBLISHED_ERROR_STATUSES).sort(([left], [right]) => left.localeCompare(right)),
  );
  // Only the 503 family leaves the outcome unknown; every other name proves the
  // write did not land, so the console may say so without re-reading.
  for (const [error, status] of Object.entries(PUBLISHED_ERROR_STATUSES)) {
    assert.equal(PERSONA_SCREENS_CORE_UNCERTAIN_STATUSES.has(error), status === 503, error);
  }
});

test("the console read decodes with its revision, its stored document and the complete reference", async () => {
  const clean = decodePersonaScreensConsoleResponse(await fixture("console-read-clean.json"));
  assert.ok(clean.ok, "console-read-clean");
  assert.equal(clean.value.revision, 4);
  assert.equal(clean.value.reference_authority, PERSONA_SCREENS_REFERENCE_AUTHORITY);
  assert.deepEqual(clean.value.slot_byte_limits, { headline: 120, subtitle: 320, cta: 40 });
  assert.deepEqual(Object.keys(clean.value.copy_default).sort(), ["en", "hu"]);
  assert.deepEqual(Object.keys(clean.value.copy_default.en ?? {}), ["pre", "success", "failed"]);
  // Mid-translation: two Hungarian slots out of nine, and Core stores nothing else.
  assert.deepEqual(clean.value.copy_default.hu, {
    pre: { headline: "Igazold, hogy tényleg te vagy az" },
    failed: { cta: "Próbáljuk újra" },
  });
  for (const language of PERSONA_SCREEN_LANGUAGES) {
    for (const screen of PERSONA_SCREEN_KEYS) {
      for (const slot of PERSONA_SCREEN_SLOTS) {
        const value = clean.value.compiled_reference[language][screen][slot];
        assert.equal(typeof value, "string");
        assert.notEqual(value, "", `${language}.${screen}.${slot} reference is complete`);
      }
    }
  }
  // T-588 again, stated so a reader is not misled: on THIS corpus both stored
  // Hungarian slots are byte-identical to the app's own compiled Hungarian, so
  // they cannot demonstrate precedence. At least one stored slot must differ
  // from the reference, or nothing in this fixture could.
  const distinct = PERSONA_SCREEN_KEYS.flatMap((screen) => PERSONA_SCREEN_SLOTS
    .filter((slot) => {
      const stored = clean.value.copy_default.en?.[screen]?.[slot];
      return stored !== undefined && stored !== clean.value.compiled_reference.en[screen][slot];
    }));
  assert.ok(distinct.length > 0, "every stored slot equals the app's own copy; this fixture proves nothing");

  const empty = decodePersonaScreensConsoleResponse(await fixture("console-read-empty.json"));
  assert.ok(empty.ok, "console-read-empty");
  assert.equal(empty.value.revision, 1);
  assert.deepEqual(empty.value.copy_default, {}, "nothing stored is an object, never an array");
});

test("the save answer binds to the exact document and successor revision the console submitted", async () => {
  const stored = await storedMidTranslation();
  const bound = decodePersonaScreensSaveResponse(await fixture("console-saved.json"), {
    expected_revision: 4,
    document: { copy_default: stored },
  });
  assert.ok(bound.ok, "console-saved");
  assert.equal(bound.value.revision, 5);
  assert.deepEqual(bound.value.copy_default, stored);

  // The same body against a different expectation is not a proof of anything.
  const unbound = decodePersonaScreensSaveResponse(await fixture("console-saved.json"), {
    expected_revision: 7,
    document: { copy_default: stored },
  });
  assert.deepEqual(unbound, { ok: false, kind: "uncertain", error: "unbound-revision" });
});

test("every published refusal classifies with its status, its field and its conflict revision", async () => {
  const submitted = { expected_revision: 4, document: { copy_default: {} } };

  const conflict = decodePersonaScreensSaveResponse(await fixture("refusal-conflict.json"), submitted);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.kind, "refused");
  assert.equal(conflict.error, "persona-screens-conflict");
  assert.equal(conflict.status, 409);
  // The console RELOADS to this revision; it never replays the save.
  assert.equal(conflict.currentRevision, 7);
  assert.equal(conflict.field, null);

  const fieldRefusals: ReadonlyArray<[string, string, string]> = [
    ["refusal-slot-empty.json", "persona-screens-copy-default-invalid", "copy_default.hu.pre.headline"],
    ["refusal-slot-over-cap.json", "persona-screens-copy-default-invalid", "copy_default.en.success.cta"],
    ["refusal-highlight-markup.json", "persona-screens-copy-default-invalid", "copy_default.en.pre.headline"],
    ["refusal-unknown-language.json", "persona-screens-copy-default-invalid", "copy_default.de"],
    ["refusal-storefront-override-rejected.json", "persona-screens-invalid", "document"],
  ];
  for (const [file, error, field] of fieldRefusals) {
    const decoded = decodePersonaScreensSaveResponse(await fixture(file), submitted);
    assert.equal(decoded.ok, false, file);
    assert.equal(decoded.kind, "refused", file);
    assert.equal(decoded.error, error, file);
    assert.equal(decoded.status, 422, file);
    // The console marks the control the operator typed into, not the form.
    assert.equal(decoded.field, field, file);
    assert.equal(decoded.currentRevision, null, file);
  }
});

/**
 * The documents Core refuses in the corpus must not leave this browser at all:
 * the local mirror of R4/R5 is what turns a round trip into immediate feedback,
 * and a mirror that let one of these through would be decoration.
 */
test("the proxy normalizer refuses every document the corpus shows Core refusing", () => {
  const refused = [
    { copy_default: { hu: { pre: { headline: "" } } } },
    { copy_default: { en: { success: { cta: "x".repeat(41) } } } },
    { copy_default: { en: { pre: { headline: "Verify {{name}} now" } } } },
    { copy_default: { de: { pre: { headline: "Hallo" } } } },
    { copy_default: {}, copy_overrides: { HUN: {} } },
  ];
  for (const document of refused) {
    assert.equal(
      normalizePersonaScreensProxyBody("persona_screens_save", { expected_revision: 4, document }),
      null,
      JSON.stringify(document),
    );
  }
});

/**
 * THE BINDING THAT MATTERS. The console tells an operator how many of the nine
 * slots their save actually reaches in each language; that projection is
 * compared here against the block Core really published for the same stored
 * document, on all eight `ios_appconfig` fixtures.
 *
 * `appconfig-hu-session-en-only.json` is the file the whole corpus exists for:
 * nine English slots, a Hungarian session, and a published block with no
 * screens in it. A projection that implemented an English fallback could not
 * match it.
 */
test("the console's published projection equals Core's published block on every appconfig fixture", async () => {
  const midTranslation = await storedMidTranslation();
  const englishOnly: PersonaScreensCopyDefault = { en: midTranslation.en };

  const cases: ReadonlyArray<[string, unknown, PersonaScreenLanguage]> = [
    ["appconfig-hu-session-en-only.json", englishOnly, "hu"],
    ["appconfig-en-session-en-only.json", englishOnly, "en"],
    ["appconfig-hu-session-partial-translation.json", midTranslation, "hu"],
    ["appconfig-en-session-partial-translation.json", midTranslation, "en"],
    ["appconfig-nothing-stored-hu.json", {}, "hu"],
    // An unknown `lang` narrows to `en` before resolution, exactly as the rest
    // of `ios_appconfig` narrows it, so the console projects the English block.
    ["appconfig-unknown-language.json", midTranslation, "en"],
    // R3: one over-cap slot is dropped and its two siblings still publish.
    ["appconfig-slot-degrades-alone.json", {
      en: {
        pre: {
          headline: "Verify that it’s really you",
          subtitle: "x".repeat(321),
          cta: "Start verification",
        },
      },
    }, "en"],
    // R4 read tolerance: an unknown screen, slot and language are ignored.
    ["appconfig-unknown-vocabulary-tolerated.json", {
      en: {
        pre: { headline: "Kept", mark: "checkmark" },
        welcome: { headline: "From a later contract version" },
      },
      de: { pre: { headline: "Ignoriert" } },
    }, "en"],
  ];

  for (const [file, stored, language] of cases) {
    const wire = (await fixture(file)).data.persona_screens as Json;
    assert.deepEqual(publishedScreens(stored, language), wire, file);
  }
});

test("the Hungarian session of an English-only configuration publishes none of the English bytes", async () => {
  const midTranslation = await storedMidTranslation();
  const englishOnly: PersonaScreensCopyDefault = { en: midTranslation.en };
  const projected = publishedScreens(englishOnly, "hu");
  assert.deepEqual(projected.screens, {}, "R2: nothing is published, so the app uses its compiled Hungarian");

  const serialized = JSON.stringify(projected);
  const english = midTranslation.en as PersonaScreenMap;
  let checked = 0;
  for (const screen of PERSONA_SCREEN_KEYS) {
    for (const slot of PERSONA_SCREEN_SLOTS) {
      const value = english[screen]?.[slot];
      if (value === undefined) continue;
      checked += 1;
      assert.equal(serialized.includes(value), false, `${screen}.${slot} leaked into a Hungarian block`);
    }
  }
  assert.equal(checked, 9, "all nine English slots were checked");
});
