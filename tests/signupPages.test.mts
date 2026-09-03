import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SIGNUP_PAGE_ITEM_LIMIT,
  SIGNUP_PAGE_LIMIT,
  SIGNUP_SYSTEM_QUESTION_KEYS,
  addItem,
  addPage,
  moveItem,
  movePage,
  removeItem,
  removePage,
  sameLayout,
  serialize,
  setHidden,
  setRequired,
  setSubtitle,
  setTitle,
  signupPageConflict,
  signupPageConflictLayout,
  signupPageSaveIssues,
  signupPageSaveRevision,
  signupPagesPayload,
  validate,
  withRevision,
  type SignupPageLayout,
  type SignupPagesPayload,
} from "../lib/signupPages.ts";

const CORPUS = new URL(
  "./fixtures/signup_pages_handoff/t689-signup-composer-envelopes.json",
  import.meta.url,
);
const CORPUS_BYTES = readFileSync(CORPUS);
const envelopes = JSON.parse(CORPUS_BYTES.toString("utf8")) as Record<string, unknown>;
const SYSTEM_INTENTS_HANDOFF = new URL(
  "./fixtures/signup_pages_handoff/system-intents-handoff.json",
  import.meta.url,
);
const SYSTEM_INTENTS_HANDOFF_BYTES = readFileSync(SYSTEM_INTENTS_HANDOFF);
const systemIntentsEnvelopes = JSON.parse(
  SYSTEM_INTENTS_HANDOFF_BYTES.toString("utf8"),
) as Record<string, unknown>;

function envelope(key: string): Record<string, unknown> {
  return structuredClone(envelopes[key]) as Record<string, unknown>;
}

function systemIntentsEnvelope(key: string): Record<string, unknown> {
  return structuredClone(systemIntentsEnvelopes[key]) as Record<string, unknown>;
}

function raw(): Record<string, unknown> {
  return envelope("list_signup_options.composed");
}

function payload(): SignupPagesPayload {
  const parsed = signupPagesPayload(raw());
  assert.ok(parsed, "the captured read envelope must decode");
  return parsed;
}

function emptyLayout(): SignupPageLayout {
  return { revision: 3, updated_at: 100, updated_by: "admin@example.test", pages: [] };
}

test("the fixture is the published T-689 capture, byte for byte", () => {
  // Provenance, not decoration: Core has no committed `list_signup_options`
  // corpus, so this file IS the record of what the wire looks like. An edited
  // body must fail here rather than drift into the decoder's expectations.
  //
  // T-683 re-pins it from the T-670 capture to the T-689 one, which is the same
  // five envelopes served by a Core that finally localizes the gender options
  // (see the assertion below); the T-670 bodies carried the placeholder labels.
  assert.equal(
    createHash("sha256").update(CORPUS_BYTES).digest("hex"),
    "6aa8a94c8e510850960621307758c1d1e941627b8ce297ee899ce7b3837e610d",
    "re-copy team/handoffs/t689-signup-composer-envelopes.json and update this digest",
  );
  assert.deepEqual(Object.keys(envelopes).sort(), [
    "list_signup_options.composed",
    "list_signup_options.empty",
    "save_signup_page_layout.200",
    "save_signup_page_layout.409",
    "save_signup_page_layout.422",
  ]);
});

test("the temporary T-702 handoff appends only the contract-only intents row", () => {
  assert.equal(
    createHash("sha256").update(SYSTEM_INTENTS_HANDOFF_BYTES).digest("hex"),
    "79851687152d6193129edb9a03496e586b7b746f4dc9cd2120f77f0b33dfe1b5",
    "replace this handoff with Core T-702's real envelope when it is published",
  );
  assert.equal(SYSTEM_INTENTS_HANDOFF_BYTES.byteLength, 199_338);
  assert.deepEqual(Object.keys(systemIntentsEnvelopes).sort(), Object.keys(envelopes).sort());

  const completePayloads = [
    "list_signup_options.empty",
    "save_signup_page_layout.200",
    "list_signup_options.composed",
  ];
  let pinnedIntents: Record<string, unknown> | null = null;
  for (const key of completePayloads) {
    const deployed = envelope(key);
    const handoff = systemIntentsEnvelope(key);
    const deployedRows = deployed.system_questions as Record<string, unknown>[];
    const handoffRows = handoff.system_questions as Record<string, unknown>[];
    assert.deepEqual(handoffRows.slice(0, deployedRows.length), deployedRows, `${key}: deployed rows`);
    assert.equal(handoffRows.length, deployedRows.length + 1, `${key}: one additive row`);

    const withoutIntents = structuredClone(handoff);
    withoutIntents.system_questions = handoffRows.slice(0, deployedRows.length);
    assert.deepEqual(withoutIntents, deployed, `${key}: no other envelope material changed`);
    pinnedIntents ??= handoffRows.at(-1) ?? null;
    assert.deepEqual(handoffRows.at(-1), pinnedIntents, `${key}: identical hand-written row`);
  }

  assert.ok(pinnedIntents);
  assert.deepEqual(Object.keys(pinnedIntents).sort(), [
    "key",
    "kind",
    "labels",
    "options",
    "required_min",
    "synthetic",
  ]);
  assert.equal(pinnedIntents.key, "intents");
  assert.equal(pinnedIntents.kind, "system");
  assert.equal(pinnedIntents.synthetic, true);
  assert.equal(pinnedIntents.required_min, 1);
  assert.deepEqual(pinnedIntents.labels, {
    en: "What are you looking for?",
    hu: "Mit keresel?",
  });
  assert.deepEqual(
    (pinnedIntents.options as Array<{ key: string; labels: { en: string; hu: string } }>).map(
      (row) => [row.key, row.labels.en, row.labels.hu],
    ),
    [
      ["people_to_meet_irl", "People to meet IRL", "Élőben találkozni"],
      ["couple_friends", "Couple friends", "Páros barátok"],
      ["gaming", "Gaming", "Gaming"],
      ["volunteer", "Volunteer", "Önkénteskedés"],
      ["workouts_sports", "Workouts & Sports", "Edzés és sport"],
      ["travel", "Travel", "Utazás"],
      ["live_music", "Live music", "Élő zene"],
      ["nights_out", "Nights out", "Esti programok"],
      ["coworking", "Coworking", "Coworking"],
      ["faith_studies", "Faith studies", "Hitélet"],
      ["arts_culture", "Arts & Culture", "Művészet és kultúra"],
      ["roommate", "Roommate", "Lakótárs"],
      ["kid_playdates", "Kid playdates", "Gyerekprogramok"],
      ["anything", "Anything", "Bármi"],
    ],
  );
});

test("the captured read decodes the complete composer surface", () => {
  const parsed = payload();
  // `p_<8hex>` keys and `updated_at` are minted per capture run, so they are
  // asserted by shape and never by value.
  assert.equal(parsed.pages.revision, 1);
  assert.equal(parsed.pages.updated_by, "pages-editor@example.test");
  assert.equal(parsed.pages.pages.length, 2);
  for (const page of parsed.pages.pages) assert.match(page.key, /^p_[0-9a-f]{8}$/u);
  assert.deepEqual(parsed.pages.pages[0].title, { en: "More about you", hu: "Többet rólad" });
  assert.deepEqual(parsed.pages.pages[0].items, [
    { field_key: "smoking", required: true },
    { field_key: "relationship_status", required: false },
  ]);
  assert.equal(parsed.pages.pages[1].hidden, true, "a staged page is served hidden, not dropped");

  // Core serves both names for one identity, and the console keeps both.
  assert.deepEqual(parsed.eligible_fields.map((field) => field.key), [
    "education_level",
    "smoking",
    "profession",
    "have_kids",
    "languages",
    "relationship_status",
  ]);
  assert.deepEqual(
    parsed.eligible_fields.map((field) => field.field_key),
    parsed.eligible_fields.map((field) => field.key),
  );
  const languages = parsed.eligible_fields.find((field) => field.field_key === "languages");
  assert.deepEqual(languages?.selection, { mode: "multi", min_selected: 0, max_selected: 10 });
  assert.equal(languages?.sort_order, 70);
  assert.equal(parsed.eligible_fields[0].profile_field, "education_level");

  // D-103: relationship_status left the System block and is a plain catalogue
  // field; subgender is not offered at all.
  assert.deepEqual(parsed.system_questions.map((question) => question.key), ["gender", "visible_to"]);
  assert.deepEqual(parsed.system_questions.map((question) => question.kind), ["identity", "audience"]);
  assert.deepEqual(parsed.system_questions.map((question) => question.synthetic), [false, true]);
  assert.deepEqual(parsed.system_questions.map((question) => question.required_min), [0, 0]);
  assert.deepEqual(parsed.system_questions.map((question) => question.locked), [true, true]);
  assert.deepEqual(parsed.system_questions.map((question) => question.icon), [
    { url: "", mime: "" },
    { url: "", mime: "" },
  ]);
  assert.equal(parsed.system_questions[1].labels.hu, "Ki láthatja az adatlapomat");
  assert.equal(parsed.system_questions[1].labels.en, "Who can see my profile");
  // T-689: the gender options are localized copy, not the raw storage values
  // the T-670 capture served. The composer renders these labels verbatim, so a
  // Core that regresses to "woman"/"man" must fail here rather than ship a
  // signup screen with lowercase English in the Hungarian locale.
  assert.deepEqual(parsed.system_questions[0].options.map((row) => row.key), ["woman", "man"]);
  assert.deepEqual(parsed.system_questions[0].options.map((row) => row.labels), [
    { en: "Woman", hu: "Nő" },
    { en: "Man", hu: "Férfi" },
  ]);
  assert.deepEqual(parsed.system_questions[1].options.map((row) => row.key), ["male", "female", "both"]);
  assert.equal(JSON.stringify(parsed.system_questions).includes("relationship_status"), false);
  assert.equal(JSON.stringify(parsed).includes("subgender"), false);

  assert.deepEqual(parsed.dropped_items, []);
  assert.deepEqual(parsed.warnings, []);
});

test("the fresh-install read is a deliberate zero-page layout, not a failure", () => {
  const parsed = signupPagesPayload(envelope("list_signup_options.empty"));
  assert.ok(parsed);
  assert.equal(parsed.pages.revision, 0);
  assert.deepEqual(parsed.pages.pages, []);
  assert.equal(parsed.pages.updated_by, "");
  assert.equal(parsed.eligible_fields.length, 6);
  assert.deepEqual(parsed.dropped_items, []);
});

test("the System decoder accepts canonical subsets and warns while skipping an unknown key", () => {
  const complete = systemIntentsEnvelope("list_signup_options.composed");
  const allRows = complete.system_questions as Record<string, unknown>[];
  const completeParsed = signupPagesPayload(complete);
  assert.ok(completeParsed, "the three-row handoff body must decode");
  assert.deepEqual(
    completeParsed.system_questions.map((question) => question.key),
    SIGNUP_SYSTEM_QUESTION_KEYS,
  );
  assert.deepEqual(
    completeParsed.system_questions.map((question) => question.required_min),
    [0, 0, 1],
  );
  assert.deepEqual(completeParsed.system_questions[2].icon, { url: "", mime: "" });
  assert.equal(completeParsed.system_questions[2].locked, true);
  assert.equal(completeParsed.system_questions[2].options.length, 14);
  assert.deepEqual(completeParsed.warnings, []);

  // A read may carry any subset of the closed set while Core rolls a question
  // out or back. Relative order, not an exact pair or exact triple, is the pin.
  for (let mask = 0; mask < 2 ** allRows.length; mask += 1) {
    const value = systemIntentsEnvelope("list_signup_options.composed");
    value.system_questions = allRows.filter((_, index) => (mask & (1 << index)) !== 0);
    assert.deepEqual(
      signupPagesPayload(value)?.system_questions.map((question) => question.key),
      (value.system_questions as Record<string, unknown>[]).map((row) => row.key),
      `canonical subset ${mask.toString(2).padStart(allRows.length, "0")}`,
    );
  }

  for (const rows of [
    [allRows[1], allRows[0]],
    [allRows[0], allRows[2], allRows[1]],
    [allRows[0], allRows[0]],
  ]) {
    const value = systemIntentsEnvelope("list_signup_options.composed");
    value.system_questions = rows;
    assert.equal(signupPagesPayload(value), null, "known rows remain unique and ordered");
  }

  const withUnknown = systemIntentsEnvelope("list_signup_options.composed");
  (withUnknown.system_questions as Record<string, unknown>[]).push({
    key: "future_system_question",
    // Deliberately malformed apart from its identity: unknown material is not
    // interpreted as a known card and therefore cannot black out the page.
    kind: 42,
    options: null,
  });
  const ignored = signupPagesPayload(withUnknown);
  assert.ok(ignored, "an unknown fourth key is a warning, not a null decode");
  assert.deepEqual(ignored.system_questions.map((question) => question.key), [
    "gender",
    "visible_to",
    "intents",
  ]);
  assert.deepEqual(ignored.warnings, [{
    code: "unknown-system-question",
    key: "future_system_question",
    index: 3,
  }]);

  const interleavedUnknown = systemIntentsEnvelope("list_signup_options.composed");
  (interleavedUnknown.system_questions as Record<string, unknown>[]).splice(1, 0, {
    key: "future_identity",
  });
  assert.deepEqual(signupPagesPayload(interleavedUnknown)?.warnings, [{
    code: "unknown-system-question",
    key: "future_identity",
    index: 1,
  }]);
});

test("the additive intents row defaults required_min and fails closed on malformed known material", () => {
  const absent = systemIntentsEnvelope("list_signup_options.composed");
  delete (absent.system_questions as Record<string, unknown>[])[2].required_min;
  assert.equal(signupPagesPayload(absent)?.system_questions[2].required_min, 0);

  const cases: Array<(row: Record<string, unknown>) => void> = [
    (row) => { row.required_min = -1; },
    (row) => { row.required_min = 1.5; },
    (row) => { row.required_min = "1"; },
    (row) => { row.required_min = 15; },
    (row) => { row.kind = "audience"; },
    (row) => { row.synthetic = false; },
    (row) => { delete row.synthetic; },
    (row) => { row.locked = false; },
    (row) => { row.required = false; },
    (row) => { row.options = []; },
    (row) => { row.unknown = true; },
  ];
  for (const mutate of cases) {
    const value = systemIntentsEnvelope("list_signup_options.composed");
    mutate((value.system_questions as Record<string, unknown>[])[2]);
    assert.equal(signupPagesPayload(value), null);
  }
});

test("the legacy option catalogue travels beside the composer blocks and is ignored", () => {
  const value = raw();
  assert.ok(value.catalog, "the capture still carries the pre-composer `catalog` sibling");
  delete value.catalog;
  assert.deepEqual(signupPagesPayload(value), payload(), "the composer never reads it");
});

test("the decoder fails closed on malformed layout identity and bounds", () => {
  const cases: Array<(value: Record<string, unknown>) => void> = [
    (value) => { (value.pages as Record<string, unknown>).revision = 1.5; },
    (value) => { delete (value.pages as Record<string, unknown>).updated_at; },
    (value) => { (value.pages as Record<string, unknown>).unknown = true; },
    (value) => { (value.pages as Record<string, unknown>).schema_version = 2; },
    (value) => { (value.pages as Record<string, unknown>).key = "signup_pages_v2"; },
    (value) => { ((value.pages as Record<string, unknown>).pages as Record<string, unknown>[])[0].key = "page-1"; },
    (value) => {
      const pages = (value.pages as Record<string, unknown>).pages as Record<string, unknown>[];
      pages.push(structuredClone(pages[0]));
    },
    (value) => {
      const pages = (value.pages as Record<string, unknown>).pages as Record<string, unknown>[];
      const template = pages[0];
      (value.pages as Record<string, unknown>).pages = Array.from(
        { length: SIGNUP_PAGE_LIMIT + 1 },
        (_, index) => ({ ...structuredClone(template), key: `p_${index.toString(16).padStart(8, "0")}`, items: [] }),
      );
    },
    (value) => {
      const page = ((value.pages as Record<string, unknown>).pages as Record<string, unknown>[])[0];
      page.items = Array.from(
        { length: SIGNUP_PAGE_ITEM_LIMIT + 1 },
        (_, index) => ({ field_key: `field_${index}`, required: false }),
      );
    },
  ];
  for (const mutate of cases) {
    const value = raw();
    mutate(value);
    assert.equal(signupPagesPayload(value), null);
  }
});

test("the decoder keeps known field and System material exact", () => {
  const cases: Array<(value: Record<string, unknown>) => void> = [
    (value) => { delete (value.eligible_fields as Record<string, unknown>[])[0].labels; },
    (value) => { (value.eligible_fields as Record<string, unknown>[])[0].unknown = true; },
    (value) => {
      (value.eligible_fields as Record<string, unknown>[])[0].selection = {
        mode: "text",
        min_selected: 0,
        max_selected: 1,
      };
    },
    (value) => {
      (value.eligible_fields as Record<string, unknown>[])[0].selection = {
        mode: "single",
        min_selected: 0,
        max_selected: 3,
      };
    },
    (value) => { (value.eligible_fields as Record<string, unknown>[])[0].options = []; },
    (value) => {
      const fields = value.eligible_fields as Record<string, unknown>[];
      fields[0].field_key = fields[1].field_key;
    },
    (value) => { (value.system_questions as Record<string, unknown>[])[0].locked = false; },
    (value) => { (value.system_questions as Record<string, unknown>[])[0].kind = "composed"; },
    (value) => { (value.system_questions as Record<string, unknown>[])[1].synthetic = "yes"; },
    (value) => { (value.system_questions as Record<string, unknown>[]).push({ key: "" }); },
    (value) => {
      value.dropped_items = [
        { index: 0, page_key: "bad", field_key: "smoking", reason: "field-archived" },
      ];
    },
    (value) => {
      value.dropped_items = [
        { index: 0, page_key: "p_00000001", field_key: "smoking", reason: "invented-reason" },
      ];
    },
    (value) => { value.dropped_items = [{ page_key: "p_00000001", field_key: "smoking" }]; },
  ];
  for (const mutate of cases) {
    const value = raw();
    mutate(value);
    assert.equal(signupPagesPayload(value), null);
  }
});

test("the decoder reads a localized map the way Core writes one", () => {
  // `ProfileFieldPolicy::localizedMap` is a language-tag map, `[]` when empty
  // and free to carry a third tag. An optional subtitle nobody filled in
  // arrives as `[]`, which an exact `{en,hu}` decoder refuses.
  const blankSubtitle = raw();
  ((blankSubtitle.pages as Record<string, unknown>).pages as Record<string, unknown>[])[0].subtitle = [];
  assert.deepEqual(signupPagesPayload(blankSubtitle)?.pages.pages[0].subtitle, { en: "", hu: "" });

  const thirdLanguage = raw();
  ((thirdLanguage.pages as Record<string, unknown>).pages as Record<string, unknown>[])[0].title = {
    de: "Mehr über dich",
    en: "More about you",
    hu: "Többet rólad",
  };
  assert.deepEqual(signupPagesPayload(thirdLanguage)?.pages.pages[0].title, {
    en: "More about you",
    hu: "Többet rólad",
  });

  const blankTitle = raw();
  ((blankTitle.pages as Record<string, unknown>).pages as Record<string, unknown>[])[0].title = [];
  const decoded = signupPagesPayload(blankTitle);
  assert.deepEqual(decoded?.pages.pages[0].title, { en: "", hu: "" });
  assert.deepEqual(
    validate(decoded!.pages, decoded!.eligible_fields).filter((issue) => issue.code === "blank-title"),
    [{ code: "blank-title", page_key: decoded!.pages.pages[0].key }],
    "an unreadable stored title surfaces as a fixable row, not a dead page",
  );

  const oneLanguageLabel = raw();
  (oneLanguageLabel.eligible_fields as Record<string, unknown>[])[0].labels = { en: "Education level" };
  assert.equal(signupPagesPayload(oneLanguageLabel), null, "a required label needs both languages");

  const blankLabel = raw();
  (blankLabel.eligible_fields as Record<string, unknown>[])[0].labels = { en: "Education level", hu: "  " };
  assert.equal(signupPagesPayload(blankLabel), null, "Core never writes a blank label into the map");

  const badTag = raw();
  (badTag.eligible_fields as Record<string, unknown>[])[0].labels = {
    en: "Education level",
    hu: "Iskolai végzettség",
    "not a tag": "x",
  };
  assert.equal(signupPagesPayload(badTag), null);
});

test("an icon is accepted on any https host and refused off the known mime set", () => {
  // Core normalizes with `ProfileFieldPolicy::httpsUrl`, which pins the scheme
  // and nothing else; `/profile-fields`, which produces these icons, decodes
  // them with no host rule either.
  const managed = raw();
  (managed.eligible_fields as Record<string, unknown>[])[0].icon = {
    url: "https://img.friending.co/api/cache/admin/profile/education.png",
    mime: "image/png",
  };
  assert.equal(signupPagesPayload(managed)?.eligible_fields[0].icon.mime, "image/png");

  const otherHost = raw();
  (otherHost.eligible_fields as Record<string, unknown>[])[0].icon = {
    url: "https://cdn.example.test/education.svg",
    mime: "image/svg+xml",
  };
  assert.equal(signupPagesPayload(otherHost)?.eligible_fields[0].icon.url, "https://cdn.example.test/education.svg");

  for (const icon of [
    { url: "http://img.friending.co/education.png", mime: "image/png" },
    { url: "https://img.friending.co/education.gif", mime: "image/gif" },
    { url: "https://img.friending.co/education.png", mime: "" },
    { url: "", mime: "image/png" },
    { url: "not a url", mime: "image/png" },
  ]) {
    const value = raw();
    (value.eligible_fields as Record<string, unknown>[])[0].icon = icon;
    assert.equal(signupPagesPayload(value), null, JSON.stringify(icon));
  }
});

test("a placed field must be carried by the eligible catalogue exactly once", () => {
  const missing = raw();
  missing.eligible_fields = (missing.eligible_fields as Record<string, unknown>[])
    .filter((field) => field.field_key !== "smoking");
  assert.equal(signupPagesPayload(missing), null);

  const duplicate = raw();
  const page = ((duplicate.pages as Record<string, unknown>).pages as Record<string, unknown>[])[0];
  page.items = [
    { field_key: "smoking", required: false },
    { field_key: "smoking", required: true },
  ];
  assert.equal(signupPagesPayload(duplicate), null);
});

test("pages are added, removed and reordered without mutating their contents", () => {
  const first = addPage(emptyLayout(), "p_00000001");
  const second = addPage(first, "p_00000002");
  const third = addPage(second, "p_00000003");
  assert.deepEqual(third.pages.map((page) => page.key), ["p_00000001", "p_00000002", "p_00000003"]);
  assert.deepEqual(movePage(third, "p_00000003", 0).pages.map((page) => page.key), ["p_00000003", "p_00000001", "p_00000002"]);
  assert.deepEqual(removePage(third, "p_00000002").pages.map((page) => page.key), ["p_00000001", "p_00000003"]);
  assert.equal(addPage(third, "not-a-page"), third);

  let capped = emptyLayout();
  for (let index = 0; index < SIGNUP_PAGE_LIMIT; index += 1) {
    capped = addPage(capped, `p_${index.toString(16).padStart(8, "0")}`);
  }
  assert.equal(addPage(capped, "p_ffffffff"), capped, "the sixth page is refused");
});

test("items move between pages at an exact index and remain unique", () => {
  let layout = addPage(addPage(emptyLayout(), "p_00000001"), "p_00000002");
  layout = addItem(layout, "p_00000001", "smoking");
  layout = setRequired(layout, "smoking", true);
  layout = addItem(layout, "p_00000002", "education_level");
  layout = moveItem(layout, "smoking", "p_00000002", 0);
  assert.deepEqual(layout.pages[0].items, []);
  assert.deepEqual(layout.pages[1].items, [
    { field_key: "smoking", required: true },
    { field_key: "education_level", required: false },
  ]);
  assert.equal(addItem(layout, "p_00000001", "smoking"), layout, "an assigned field cannot be added twice");
  assert.deepEqual(removeItem(layout, "smoking").pages[1].items, [
    { field_key: "education_level", required: false },
  ]);
});

test("item moves refuse a full destination before removing the source", () => {
  let layout = addPage(addPage(emptyLayout(), "p_00000001"), "p_00000002");
  layout = addItem(layout, "p_00000001", "source_field");
  for (let index = 0; index < SIGNUP_PAGE_ITEM_LIMIT; index += 1) {
    layout = addItem(layout, "p_00000002", `target_${index}`);
  }
  const next = moveItem(layout, "source_field", "p_00000002");
  assert.equal(next, layout);
  assert.deepEqual(next.pages[0].items, [{ field_key: "source_field", required: false }]);
});

test("placement and bilingual page setters change only their named value", () => {
  let layout = addPage(emptyLayout(), "p_00000001");
  layout = addItem(layout, "p_00000001", "smoking");
  layout = setRequired(layout, "smoking", true);
  layout = setHidden(layout, "p_00000001", true);
  layout = setTitle(layout, "p_00000001", "en", " More about you ");
  layout = setTitle(layout, "p_00000001", "hu", " Még rólad ");
  layout = setSubtitle(layout, "p_00000001", "en", " Optional details ");
  layout = setSubtitle(layout, "p_00000001", "hu", " Opcionális részletek ");
  assert.deepEqual(layout.pages[0], {
    key: "p_00000001",
    hidden: true,
    title: { en: " More about you ", hu: " Még rólad " },
    subtitle: { en: " Optional details ", hu: " Opcionális részletek " },
    items: [{ field_key: "smoking", required: true }],
  });
});

test("validation reports the handoff policy codes at their page and item", () => {
  const known = payload().eligible_fields;
  const layout: SignupPageLayout = {
    ...emptyLayout(),
    pages: [
      {
        key: "p_00000001",
        hidden: false,
        title: { en: "   ", hu: "Cím" },
        subtitle: { en: "", hu: "" },
        items: [],
      },
      {
        key: "p_00000002",
        hidden: false,
        title: { en: "Title", hu: "Cím" },
        subtitle: { en: "", hu: "" },
        items: [
          { field_key: "missing_field", required: false },
          { field_key: "missing_field", required: true },
        ],
      },
    ],
  };
  assert.deepEqual(validate(layout, known), [
    { code: "item-limit", page_key: "p_00000001" },
    { code: "blank-title", page_key: "p_00000001" },
    { code: "unknown-field", page_key: "p_00000002", field_key: "missing_field" },
    { code: "unknown-field", page_key: "p_00000002", field_key: "missing_field" },
    { code: "duplicate-field", page_key: "p_00000002", field_key: "missing_field" },
  ]);

  const overLimit: SignupPageLayout = {
    ...emptyLayout(),
    pages: Array.from({ length: SIGNUP_PAGE_LIMIT + 1 }, (_, pageIndex) => ({
      key: `p_${pageIndex.toString(16).padStart(8, "0")}`,
      hidden: false,
      title: { en: "Title", hu: "Cím" },
      subtitle: { en: "", hu: "" },
      items: Array.from({ length: SIGNUP_PAGE_ITEM_LIMIT + 1 }, (_, itemIndex) => ({
        field_key: `overflow_${pageIndex}_${itemIndex}`,
        required: false,
      })),
    })),
  };
  assert.deepEqual(validate(overLimit, known).filter((issue) => issue.code === "page-limit"), [
    { code: "page-limit" },
  ]);
  assert.equal(
    validate(overLimit, known).filter((issue) => issue.code === "item-limit").length,
    SIGNUP_PAGE_LIMIT + 1,
  );
});

test("serialization trims bilingual copy and carries one optimistic revision", () => {
  let layout = addPage(emptyLayout(), "p_00000001");
  layout = addItem(layout, "p_00000001", "smoking");
  layout = setTitle(setTitle(layout, "p_00000001", "en", " Title "), "p_00000001", "hu", " Cím ");
  layout = setSubtitle(setSubtitle(layout, "p_00000001", "en", " Subtitle "), "p_00000001", "hu", " Alcím ");
  assert.deepEqual(serialize(layout), {
    expected_revision: 3,
    pages: [{
      key: "p_00000001",
      hidden: false,
      title: { en: "Title", hu: "Cím" },
      subtitle: { en: "Subtitle", hu: "Alcím" },
      items: [{ field_key: "smoking", required: false }],
    }],
  });
  const revised = withRevision(layout, 4);
  assert.equal(revised?.revision, 4);
  assert.equal(sameLayout(layout, revised as SignupPageLayout), true);
  assert.equal(withRevision(layout, 1.5), null);
  assert.equal(withRevision(layout, 5), null, "a save result must be the exact CAS successor");
});

test("the captured accepted save answers with the whole payload beside its revision", () => {
  const accepted = envelope("save_signup_page_layout.200");
  assert.equal(signupPageSaveRevision(accepted), 1);
  const parsed = signupPagesPayload(accepted);
  assert.ok(parsed, "an accepted save is a complete read, so the console never needs a second one");
  assert.equal(parsed.pages.revision, 1);
  assert.equal(parsed.eligible_fields.length, 6);
  assert.equal(parsed.system_questions.length, 2);
  assert.deepEqual(parsed.dropped_items, []);
  assert.equal(signupPageConflict(accepted), false);
  assert.equal(signupPageSaveIssues(accepted), null);

  assert.equal(signupPageSaveRevision({ success: true, revision: 8 }), null);
  assert.equal(signupPageSaveRevision({ success: true, status_code: 200, revision: "8" }), null);
});

test("the captured 409 is signup-page-conflict and carries the winning document", () => {
  const conflict = envelope("save_signup_page_layout.409");
  assert.equal(conflict.error, "signup-page-conflict");
  assert.equal(signupPageConflict(conflict), true);
  const current = signupPageConflictLayout(conflict);
  assert.ok(current, "the 409 body IS the reload");
  assert.equal(current.revision, 1);
  assert.equal(current.pages.length, 2);
  assert.deepEqual(current.pages[0].items.map((item) => item.field_key), ["smoking", "relationship_status"]);
  assert.equal(signupPageSaveIssues(conflict), null);

  // The name this console shipped with is not one Core has ever sent.
  assert.equal(
    signupPageConflict({ success: false, status_code: 409, error: "signup-page-layout-conflict" }),
    false,
  );
  assert.equal(signupPageConflict({ ...conflict, status_code: 200 }), false);
  assert.equal(signupPageConflictLayout({ ...conflict, pages: { revision: 1 } }), null);
});

test("the captured 422 is signup-page-layout-refused with a reason per item", () => {
  const refusal = envelope("save_signup_page_layout.422");
  assert.equal(refusal.error, "signup-page-layout-refused");
  const details = refusal.details as { items: Array<Record<string, unknown>> };
  assert.deepEqual(Object.keys(details.items[0]).sort(), ["field_key", "index", "page_key", "reason"]);

  const issues = signupPageSaveIssues(refusal);
  assert.ok(issues);
  assert.equal(issues.length, 2);
  assert.deepEqual(issues[0], {
    code: "duplicate-field",
    page_key: details.items[0].page_key as string,
    field_key: "smoking",
  });
  // An empty `field_key` means the reason is about the page, so the row lands
  // on the page card rather than on an item that does not exist.
  assert.deepEqual(issues[1], {
    code: "blank-title",
    page_key: details.items[1].page_key as string,
  });
  assert.equal(signupPageConflict(refusal), false);
  assert.equal(signupPageSaveRevision(refusal), null);
});

test("the 422 decoder refuses the shapes Core does not send", () => {
  const refusal = envelope("save_signup_page_layout.422");
  const rows = (refusal.details as { items: Array<Record<string, unknown>> }).items;
  const cases: Array<Record<string, unknown>> = [
    // The name this console shipped with, with the payload it expected.
    { ...refusal, error: "signup-page-layout-invalid" },
    { ...refusal, details: undefined, errors: [{ code: "blank-title", page_key: rows[1].page_key }] },
    { ...refusal, details: { items: [] } },
    { ...refusal, details: { items: rows, extra: 1 } },
    { ...refusal, details: { items: [{ ...rows[0], reason: "invented-reason" }] } },
    { ...refusal, details: { items: [{ ...rows[0], page_key: "" }] } },
    { ...refusal, details: { items: [{ ...rows[0], index: -1 }] } },
    { ...refusal, details: { items: [{ page_key: rows[0].page_key, field_key: "", reason: "blank-title" }] } },
    { ...refusal, status_code: 400 },
    { ...refusal, success: true },
  ];
  for (const value of cases) {
    assert.equal(signupPageSaveIssues(value), null, JSON.stringify(value.error ?? value.details));
  }

  // Every reason Core can send stays decodable at its page and item.
  for (const reason of [
    "page-limit",
    "item-limit",
    "unknown-field",
    "field-not-selectable",
    "field-archived",
    "duplicate-field",
    "blank-title",
  ]) {
    const value = { ...refusal, details: { items: [{ ...rows[0], reason }] } };
    assert.deepEqual(signupPageSaveIssues(value), [{
      code: reason,
      page_key: rows[0].page_key,
      field_key: "smoking",
    }], reason);
  }
});
