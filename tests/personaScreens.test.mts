import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  PERSONA_SCREENS_ACTIONS,
  PERSONA_SCREENS_CONTRACT_VERSION,
  PERSONA_SCREENS_REVISION_MAX,
  PERSONA_SCREEN_KEYS,
  PERSONA_SCREEN_LANGUAGES,
  PERSONA_SCREEN_SLOTS,
  PERSONA_SCREEN_SLOT_BYTE_LIMITS,
  decodePersonaScreensSaveResponse,
  normalizePersonaScreensProxyBody,
  parsePersonaScreensAdminMe,
  personaScreenPreview,
  personaScreenSlotByteLength,
  personaScreenSlotIssue,
  personaScreensAccess,
  personaScreensProjectionFrom,
  personaScreensDocumentFromDraft,
  personaScreensDocumentsEqual,
  personaScreensDraft,
  personaScreensDraftIssues,
  personaScreensDraftWithValue,
  personaScreensForLanguage,
  personaScreensProxyCapabilityAuthorized,
  personaScreensPublishedBlock,
  personaScreensSlotCounts,
  type PersonaScreensCopyDefault,
  type PersonaScreensReference,
} from "../lib/personaScreens.ts";

/**
 * The values this suite types into the editors are DELIBERATELY unmistakable.
 *
 * T-588: Core's published corpus stores the app's own compiled Hungarian in the
 * slots it calls "served", so a rendered "served" screen is byte-identical to a
 * "nothing served" one and any assertion of the form "the served value appears"
 * passes without testing anything. Every value below could only have been typed
 * by an operator, so an assertion that finds one has actually found it.
 */
const OPERATOR_EN = {
  headline: "OPERATOR EN headline, typed by a human",
  subtitle: "OPERATOR EN subtitle, which the app has never contained.",
  cta: "OPERATOR EN button",
} as const;
const OPERATOR_HU = {
  headline: "OPERÁTOR HU főcím, ember gépelte",
  subtitle: "OPERÁTOR HU alcím, ami az appban sehol nem szerepel.",
  cta: "OPERÁTOR HU gomb",
} as const;

/** A complete two-language mirror whose strings differ from every operator value above. */
const REFERENCE: PersonaScreensReference = {
  en: {
    pre: { headline: "APP EN pre headline", subtitle: "APP EN pre subtitle", cta: "APP EN pre cta" },
    success: { headline: "APP EN success headline", subtitle: "APP EN success subtitle", cta: "APP EN success cta" },
    failed: { headline: "APP EN failed headline", subtitle: "APP EN failed subtitle", cta: "APP EN failed cta" },
  },
  hu: {
    pre: { headline: "APP HU pre főcím", subtitle: "APP HU pre alcím", cta: "APP HU pre gomb" },
    success: { headline: "APP HU success főcím", subtitle: "APP HU success alcím", cta: "APP HU success gomb" },
    failed: { headline: "APP HU failed főcím", subtitle: "APP HU failed alcím", cta: "APP HU failed gomb" },
  },
};

/** Every English slot filled, nothing in Hungarian — the shape R2 exists for. */
const ENGLISH_ONLY: PersonaScreensCopyDefault = {
  en: {
    pre: { ...OPERATOR_EN },
    success: { ...OPERATOR_EN },
    failed: { ...OPERATOR_EN },
  },
};

function adminMe(actions: string[]): Record<string, unknown> {
  return {
    success: true,
    status_code: 200,
    persona_screens: { contract_version: 1, contract_ready: true, actions },
  };
}

function successEnvelope(data: unknown): Record<string, unknown> {
  return { success: true, status_code: 200, data, message: 200, status: 200, can_send: 0 };
}

test("the closed vocabularies and byte caps are the contract's, not this console's invention", () => {
  assert.deepEqual([...PERSONA_SCREENS_ACTIONS], ["persona_screens_console", "persona_screens_save"]);
  assert.deepEqual([...PERSONA_SCREEN_KEYS], ["pre", "success", "failed"]);
  assert.deepEqual([...PERSONA_SCREEN_SLOTS], ["headline", "subtitle", "cta"]);
  assert.deepEqual([...PERSONA_SCREEN_LANGUAGES], ["en", "hu"]);
  assert.deepEqual(PERSONA_SCREEN_SLOT_BYTE_LIMITS, { headline: 120, subtitle: 320, cta: 40 });
  assert.equal(PERSONA_SCREENS_CONTRACT_VERSION, 1);
  assert.equal(PERSONA_SCREENS_REVISION_MAX, Number.MAX_SAFE_INTEGER);
});

/**
 * R2, stated the way Core states it: as a SIGNATURE. The draft builder receives
 * the stored document and nothing else, and the document builder receives the
 * draft and nothing else, so there is no reference and no sibling language in
 * scope for a future edit to fall back to.
 */
test("the draft and document builders take exactly one argument each", () => {
  assert.equal(personaScreensDraft.length, 1, "a second parameter here is where a pre-fill would enter");
  assert.equal(personaScreensDocumentFromDraft.length, 1, "a save must be buildable from the draft alone");
});

test("nine English slots and no Hungarian leave every Hungarian editor empty", () => {
  const draft = personaScreensDraft(ENGLISH_ONLY);
  for (const screen of PERSONA_SCREEN_KEYS) {
    for (const slot of PERSONA_SCREEN_SLOTS) {
      assert.equal(draft.en[screen][slot], OPERATOR_EN[slot], `en.${screen}.${slot} is the stored value`);
      assert.equal(draft.hu[screen][slot], "", `hu.${screen}.${slot} must stay empty`);
    }
  }
  // Nothing English reached the Hungarian half, and nothing from the app's own
  // copy reached either half.
  const serialized = JSON.stringify(draft.hu);
  for (const value of Object.values(OPERATOR_EN)) {
    assert.equal(serialized.includes(value), false, "an English value reached the Hungarian draft");
  }
  for (const language of PERSONA_SCREEN_LANGUAGES) {
    for (const screen of PERSONA_SCREEN_KEYS) {
      for (const slot of PERSONA_SCREEN_SLOTS) {
        assert.notEqual(draft[language][screen][slot], REFERENCE[language][screen][slot]);
      }
    }
  }
});

test("saving an untouched English-only configuration sends no Hungarian at all", () => {
  const document = personaScreensDocumentFromDraft(personaScreensDraft(ENGLISH_ONLY));
  assert.equal(Object.hasOwn(document.copy_default, "hu"), false, "an empty language is omitted, never sent");
  assert.ok(personaScreensDocumentsEqual(document.copy_default, ENGLISH_ONLY), "the round trip is exact");
  assert.deepEqual(personaScreensSlotCounts(document.copy_default), { en: 9, hu: 0 });
});

test("an empty box is dropped from the save rather than sent as an empty string", () => {
  let draft = personaScreensDraft(ENGLISH_ONLY);
  draft = personaScreensDraftWithValue(draft, "en", "pre", "subtitle", "");
  draft = personaScreensDraftWithValue(draft, "hu", "failed", "cta", OPERATOR_HU.cta);
  const { copy_default: document } = personaScreensDocumentFromDraft(draft);
  assert.deepEqual(Object.keys(document.en?.pre ?? {}), ["headline", "cta"], "the cleared slot is gone");
  assert.deepEqual(document.hu, { failed: { cta: OPERATOR_HU.cta } });
  assert.equal(JSON.stringify(document).includes('""'), false, "Core refuses an empty string; it never reaches the wire");
});

test("clearing every box is a valid save meaning 'the app's own copy everywhere'", () => {
  let draft = personaScreensDraft(ENGLISH_ONLY);
  for (const screen of PERSONA_SCREEN_KEYS) {
    for (const slot of PERSONA_SCREEN_SLOTS) {
      draft = personaScreensDraftWithValue(draft, "en", screen, slot, "");
    }
  }
  assert.deepEqual(personaScreensDocumentFromDraft(draft), { copy_default: {} });
});

test("editing one language leaves the other language's draft byte-identical", () => {
  const before = personaScreensDraft(ENGLISH_ONLY);
  const after = personaScreensDraftWithValue(before, "hu", "pre", "headline", OPERATOR_HU.headline);
  assert.deepEqual(after.en, before.en, "the English half is untouched by a Hungarian edit");
  assert.equal(after.hu.pre.headline, OPERATOR_HU.headline);
  assert.equal(after.hu.success.headline, "", "a sibling slot is untouched");
});

test("byte length is measured in UTF-8, the unit Core caps", () => {
  assert.equal(personaScreenSlotByteLength("Get started"), 11);
  assert.equal(personaScreenSlotByteLength("Kezdjük"), 8, "ü costs two bytes");
  assert.equal(personaScreenSlotByteLength("Igazold, hogy tényleg te vagy az"), 33);
  assert.equal(personaScreenSlotByteLength("\u{1F468}\u200D\u{1F469}\u200D\u{1F467}"), 18, "an astral pair costs four bytes each");
});

test("the local validator refuses exactly what Core refuses, and never an empty box", () => {
  assert.equal(personaScreenSlotIssue("", "headline"), null, "empty means 'use the app's copy', not 'invalid'");
  assert.equal(personaScreenSlotIssue("Kezdjük", "cta"), null);
  // The cap bites in bytes: 21 accented characters are 42 bytes, still under 120
  // for a headline but a 21-character `cta` of the same letters is over 40.
  assert.equal(personaScreenSlotIssue("ő".repeat(21), "headline"), null);
  assert.equal(personaScreenSlotIssue("ő".repeat(21), "cta"), "overCap");
  assert.equal(personaScreenSlotIssue("x".repeat(41), "cta"), "overCap");
  assert.equal(personaScreenSlotIssue("x".repeat(40), "cta"), null);
  assert.equal(personaScreenSlotIssue(" Kezdjük", "cta"), "untrimmed");
  assert.equal(personaScreenSlotIssue("Kezdjük ", "cta"), "untrimmed");
  assert.equal(personaScreenSlotIssue("Kezdjük\u200B", "cta"), "boundaryWhitespace");
  assert.equal(personaScreenSlotIssue("\u200BKezdjük", "cta"), "boundaryWhitespace");
  assert.equal(personaScreenSlotIssue("Kezd\u200Djük", "cta"), null, "a zero-width joiner mid-string is legitimate");
  assert.equal(personaScreenSlotIssue("Get\u0007started", "cta"), "control");
  assert.equal(personaScreenSlotIssue("Get\u2028started", "cta"), "control");
  assert.equal(personaScreenSlotIssue("Hello {{name}}", "cta"), "markup");
  assert.equal(personaScreenSlotIssue("Hello }}", "cta"), "markup");
  assert.equal(personaScreenSlotIssue("<b>Hello</b>", "cta"), "angleBrackets");
  assert.equal(personaScreenSlotIssue("Hello \ud83d", "cta"), "malformedText");
});

test("draft issues name the exact control, in Core's own field path", () => {
  const draft = personaScreensDraftWithValue(
    personaScreensDraft({}),
    "hu",
    "pre",
    "headline",
    "  untrimmed",
  );
  assert.deepEqual(personaScreensDraftIssues(draft), [
    { language: "hu", screen: "pre", slot: "headline", issue: "untrimmed" },
  ]);
});

test("the published projection reproduces R2: an English-only document publishes nothing for Hungarian", () => {
  const hungarian = personaScreensPublishedBlock(personaScreensForLanguage(ENGLISH_ONLY, "hu"), "hu");
  assert.deepEqual(hungarian, { contract_version: 1, lang: "hu", screens: {} });
  const english = personaScreensPublishedBlock(personaScreensForLanguage(ENGLISH_ONLY, "en"), "en");
  assert.deepEqual(Object.keys(english.screens), ["pre", "success", "failed"]);
  assert.deepEqual(english.screens.pre, { ...OPERATOR_EN });
  const serialized = JSON.stringify(hungarian);
  for (const value of Object.values(OPERATOR_EN)) {
    assert.equal(serialized.includes(value), false, "an operator's English reached a Hungarian block");
  }
});

test("a screen with no usable slot is omitted, never published as an empty object", () => {
  const block = personaScreensPublishedBlock(
    { pre: { headline: OPERATOR_EN.headline }, success: {}, failed: { cta: "" } },
    "en",
  );
  assert.deepEqual(block.screens, { pre: { headline: OPERATOR_EN.headline } });
});

/**
 * The T-588 trap, stated as a test. An operator may legitimately retype the
 * app's own sentence word for word; a preview that decided "operator" versus
 * "compiled" by comparing the two strings would then label their saved value
 * "compiled" and teach them that saving had done nothing.
 */
test("the preview reads its source from the draft, never by comparing text with the reference", () => {
  const retyped = personaScreensDraftWithValue(
    personaScreensDraft({}),
    "hu",
    "pre",
    "headline",
    REFERENCE.hu.pre.headline,
  );
  const preview = personaScreenPreview(retyped, REFERENCE, "hu", "pre");
  assert.deepEqual(preview.headline, { text: REFERENCE.hu.pre.headline, source: "operator" });
  assert.deepEqual(preview.subtitle, { text: REFERENCE.hu.pre.subtitle, source: "compiled" });
});

test("the preview shows the app's own copy for every slot an English-only save leaves empty", () => {
  const draft = personaScreensDraft(ENGLISH_ONLY);
  const hungarian = personaScreenPreview(draft, REFERENCE, "hu", "pre");
  for (const slot of PERSONA_SCREEN_SLOTS) {
    assert.equal(hungarian[slot].source, "compiled");
    assert.equal(hungarian[slot].text, REFERENCE.hu.pre[slot]);
    assert.notEqual(hungarian[slot].text, OPERATOR_EN[slot], "the English value never surfaces in a Hungarian preview");
  }
  const english = personaScreenPreview(draft, REFERENCE, "en", "pre");
  assert.deepEqual(english.headline, { text: OPERATOR_EN.headline, source: "operator" });
});

test("a save answer is adopted only when the revision and the document are both bound", () => {
  const submitted = { expected_revision: 4, document: { copy_default: ENGLISH_ONLY } };
  const good = decodePersonaScreensSaveResponse(
    successEnvelope({ revision: 5, copy_default: ENGLISH_ONLY }),
    submitted,
  );
  assert.ok(good.ok);
  assert.equal(good.value.revision, 5);

  const skipped = decodePersonaScreensSaveResponse(
    successEnvelope({ revision: 6, copy_default: ENGLISH_ONLY }),
    submitted,
  );
  assert.deepEqual(skipped, { ok: false, kind: "uncertain", error: "unbound-revision" });

  const drifted = decodePersonaScreensSaveResponse(
    successEnvelope({ revision: 5, copy_default: { en: { pre: { headline: OPERATOR_EN.headline } } } }),
    submitted,
  );
  assert.deepEqual(drifted, { ok: false, kind: "uncertain", error: "unbound-material" });

  assert.deepEqual(
    decodePersonaScreensSaveResponse(null, submitted),
    { ok: false, kind: "uncertain", error: "no-response" },
  );
  assert.deepEqual(
    decodePersonaScreensSaveResponse({ revision: 5 }, submitted),
    { ok: false, kind: "uncertain", error: "malformed-envelope" },
  );
});

test("the bridge's own refusals are classified from the bridge map, not Core's", () => {
  const submitted = { expected_revision: 4, document: { copy_default: {} } };
  const refused = decodePersonaScreensSaveResponse(
    { success: false, status_code: 403, error: "persona-screens-capability-required" },
    submitted,
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.kind, "refused");
  const timeout = decodePersonaScreensSaveResponse(
    { success: false, status_code: 504, error: "core-timeout" },
    submitted,
  );
  assert.deepEqual(timeout, { ok: false, kind: "uncertain", error: "core-timeout" });
  const unknown = decodePersonaScreensSaveResponse(
    { success: false, status_code: 418, error: "made-up" },
    submitted,
  );
  assert.deepEqual(unknown, { ok: false, kind: "uncertain", error: "unknown-refusal" });
});

test("Core's capability projection is the only source of access", () => {
  assert.deepEqual(
    personaScreensAccess(parsePersonaScreensAdminMe({
      contract_version: 1, contract_ready: true, actions: ["persona_screens_console"],
    })),
    { visible: true, editable: false },
  );
  assert.deepEqual(
    personaScreensAccess(parsePersonaScreensAdminMe({
      contract_version: 1, contract_ready: true, actions: PERSONA_SCREENS_ACTIONS,
    })),
    { visible: true, editable: true },
  );
  assert.deepEqual(personaScreensAccess(null), { visible: false, editable: false });
  assert.deepEqual(
    personaScreensAccess(parsePersonaScreensAdminMe({
      contract_version: 1, contract_ready: false, actions: [],
    })),
    { visible: false, editable: false },
  );

  // Anything the contract does not describe denies rather than degrades.
  for (const projection of [
    { contract_version: 2, contract_ready: true, actions: [] },
    { contract_version: 1, contract_ready: true, actions: ["persona_screens_save", "persona_screens_console"] },
    { contract_version: 1, contract_ready: true, actions: ["persona_screens_console", "persona_screens_console"] },
    { contract_version: 1, contract_ready: true, actions: ["persona_screens_delete"] },
    { contract_version: 1, contract_ready: false, actions: ["persona_screens_console"] },
    { contract_version: 1, contract_ready: true, actions: [], extra: 1 },
    { contract_version: 1, contract_ready: true },
  ]) {
    assert.equal(parsePersonaScreensAdminMe(projection), null, JSON.stringify(projection));
  }
});

test("an absent projection is a quiet closed card; an unusable one fails closed and loudly", () => {
  // Core has not released the family here: the three screens still work, they
  // simply use the app's own copy, so this is not an error to shout about.
  assert.deepEqual(personaScreensProjectionFrom({ success: true, status_code: 200 }), { kind: "absent" });
  // Present and not the contract's, or a membership answer this layer cannot
  // trust: never rendered as a proven empty state.
  assert.deepEqual(
    personaScreensProjectionFrom({ success: true, persona_screens: { contract_version: 2, contract_ready: true, actions: [] } }),
    { kind: "unreadable" },
  );
  assert.deepEqual(personaScreensProjectionFrom({ success: false, persona_screens: null }), { kind: "unreadable" });
  assert.deepEqual(personaScreensProjectionFrom(null), { kind: "unreadable" });
  const ok = personaScreensProjectionFrom(adminMe([...PERSONA_SCREENS_ACTIONS]));
  assert.equal(ok.kind, "ok");
  assert.deepEqual(
    personaScreensAccess(ok.kind === "ok" ? ok.value : null),
    { visible: true, editable: true },
  );
});

test("the proxy rechecks the exact action against Core's live projection", () => {
  assert.equal(personaScreensProxyCapabilityAuthorized("admin_me", adminMe([...PERSONA_SCREENS_ACTIONS])), null);
  assert.equal(personaScreensProxyCapabilityAuthorized("persona_screens_console", adminMe(["persona_screens_console"])), true);
  assert.equal(personaScreensProxyCapabilityAuthorized("persona_screens_save", adminMe(["persona_screens_console"])), false);
  assert.equal(personaScreensProxyCapabilityAuthorized("persona_screens_save", adminMe([...PERSONA_SCREENS_ACTIONS])), true);
  assert.equal(personaScreensProxyCapabilityAuthorized("persona_screens_save", {}), false);
});

test("the proxy forwards only the exact body Core's controller accepts", () => {
  assert.equal(normalizePersonaScreensProxyBody("admin_me", {}), undefined, "another family is not this normalizer's business");
  assert.deepEqual(normalizePersonaScreensProxyBody("persona_screens_console", {}), {});
  assert.equal(normalizePersonaScreensProxyBody("persona_screens_console", { contract_version: 1 }), null);

  const valid = { expected_revision: 4, document: { copy_default: ENGLISH_ONLY } };
  assert.deepEqual(normalizePersonaScreensProxyBody("persona_screens_save", valid), valid);
  // "Clear everything" is a legitimate save, and `{}` must survive as an object.
  assert.deepEqual(
    normalizePersonaScreensProxyBody("persona_screens_save", { expected_revision: 1, document: { copy_default: {} } }),
    { expected_revision: 1, document: { copy_default: {} } },
  );

  for (const body of [
    { expected_revision: 4 },
    { document: { copy_default: {} } },
    { expected_revision: 4, document: { copy_default: {} }, admin_email: "x@y.z" },
    { expected_revision: 0, document: { copy_default: {} } },
    { expected_revision: "4", document: { copy_default: {} } },
    { expected_revision: PERSONA_SCREENS_REVISION_MAX, document: { copy_default: {} } },
    { expected_revision: 4, document: { copy_default: [] } },
    // v1 has NO storefront overrides (D-080), and no other top-level key.
    { expected_revision: 4, document: { copy_default: {}, copy_overrides: {} } },
    { expected_revision: 4, document: { copy_default: { de: { pre: { headline: "Hallo" } } } } },
    { expected_revision: 4, document: { copy_default: { en: { welcome: { headline: "Hi" } } } } },
    { expected_revision: 4, document: { copy_default: { en: { pre: { mark: "checkmark" } } } } },
    { expected_revision: 4, document: { copy_default: { en: { pre: { headline: "" } } } } },
    { expected_revision: 4, document: { copy_default: { en: { pre: { headline: " untrimmed" } } } } },
    { expected_revision: 4, document: { copy_default: { en: { pre: { headline: "{{name}}" } } } } },
    { expected_revision: 4, document: { copy_default: { en: { pre: { headline: "<b>hi</b>" } } } } },
    { expected_revision: 4, document: { copy_default: { en: { success: { cta: "x".repeat(41) } } } } },
    { expected_revision: 4, document: { copy_default: { en: { pre: { headline: 12 } } } } },
    { expected_revision: 4, document: { copy_default: { en: { pre: {} } } } },
    { expected_revision: 4, document: { copy_default: { en: {} } } },
  ]) {
    assert.equal(normalizePersonaScreensProxyBody("persona_screens_save", body), null, JSON.stringify(body));
  }
});

/**
 * `persona_screens_save` is deliberately absent from the raised body ceilings in
 * `lib/adminActions.ts`. Rather than assert that by comment, build the largest
 * document the editor can produce — every one of the eighteen slots filled to
 * its byte cap with two-byte characters — and check that the browser body still
 * fits under both the default proxy ceiling and Core's own 16 KiB document cap.
 */
test("the maximal document the editor can produce fits the default ceiling with room to spare", () => {
  const copyDefault: PersonaScreensCopyDefault = {};
  for (const language of PERSONA_SCREEN_LANGUAGES) {
    const screens: Record<string, Record<string, string>> = {};
    for (const screen of PERSONA_SCREEN_KEYS) {
      const slots: Record<string, string> = {};
      for (const slot of PERSONA_SCREEN_SLOTS) {
        slots[slot] = "ő".repeat(PERSONA_SCREEN_SLOT_BYTE_LIMITS[slot] / 2);
        assert.equal(personaScreenSlotIssue(slots[slot], slot), null, "the maximal value is still acceptable");
      }
      screens[screen] = slots;
    }
    copyDefault[language] = screens as PersonaScreensCopyDefault["en"];
  }
  const body = JSON.stringify({ expected_revision: 1, document: { copy_default: copyDefault } });
  const bytes = Buffer.byteLength(body, "utf8");
  assert.ok(bytes < 16_384, `Core refuses a document over 16 KiB; the maximum is ${bytes} bytes`);
  assert.ok(bytes < 256_000 / 10, `the default proxy ceiling keeps an order of magnitude of headroom (${bytes})`);
});

/**
 * The console card is the surface D-077 can come back through, so two of its
 * properties are asserted from the source rather than left to review: the
 * reference is read for a placeholder and a preview only, and there is no
 * control that fills one language's editor from anything but a person typing.
 */
test("the console card never routes the reference or a sibling language into a draft", async () => {
  const source = await readFile(new URL("../components/PersonaScreensCard.tsx", import.meta.url), "utf8");

  assert.match(source, /placeholder: reference\[language\]\[screen\]\[slot\]/,
    "the compiled reference is ghost text on the control it belongs to");
  assert.match(source, /personaScreenPreview\(draft, reference, language, screen\)/,
    "the preview is the only other place the reference is read");
  assert.match(source, /aria-pressed=\{language === entry\}/,
    "the languages are tabs, so English is never sitting beside an empty Hungarian box");
  assert.doesNotMatch(source, /resetCompiled|fillFrom|copyFrom|prefill|preFill/i,
    "no control may fill an editor from the app's copy or from the other language");

  for (const line of source.split("\n")) {
    if (!/\breference\b|compiled_reference/.test(line)) continue;
    assert.doesNotMatch(line, /setDraft|personaScreensDraftWithValue|\bpatch\(/,
      `the reference must never reach a draft mutation: ${line.trim()}`);
  }
  for (const line of source.split("\n")) {
    if (!/personaScreensDraftWithValue|setDraft\(/.test(line)) continue;
    assert.doesNotMatch(line, /"en"|"hu"/,
      `a draft mutation must never name a language literally: ${line.trim()}`);
  }
});
