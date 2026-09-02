import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SIGNUP_PAGE_ITEM_LIMIT,
  SIGNUP_PAGE_LIMIT,
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
  signupPageSaveIssues,
  signupPageSaveRevision,
  signupPagesPayload,
  validate,
  withRevision,
  type SignupPageLayout,
  type SignupPagesPayload,
} from "../lib/signupPages.ts";

const fixture = JSON.parse(readFileSync(
  new URL("./fixtures/signup_pages_handoff/list-signup-options.json", import.meta.url),
  "utf8",
));

function raw(): Record<string, unknown> {
  return structuredClone(fixture) as Record<string, unknown>;
}

function payload(): SignupPagesPayload {
  const parsed = signupPagesPayload(raw());
  assert.ok(parsed, "the handoff fixture must decode");
  return parsed;
}

function emptyLayout(): SignupPageLayout {
  return { revision: 3, updated_at: 100, updated_by: "admin@example.test", pages: [] };
}

test("the marked handoff fixture decodes the complete composer surface", () => {
  const parsed = payload();
  assert.equal(parsed.pages.revision, 7);
  assert.deepEqual(parsed.pages.pages.map((page) => page.key), ["p_12ab34cd"]);
  assert.deepEqual(parsed.eligible_fields.map((field) => field.field_key), ["smoking", "education_level"]);
  assert.deepEqual(parsed.system_questions.map((question) => question.key), ["gender", "visible_to"]);
  assert.equal(parsed.system_questions[1].labels.hu, "Ki láthatja az adatlapomat");
  assert.deepEqual(parsed.dropped_items, [{ page_key: "p_deadbeef", field_key: "retired_question" }]);
  assert.equal(JSON.stringify(parsed).includes("relationship_status"), false);
  assert.equal(JSON.stringify(parsed).includes("subgender"), false);
});

test("the decoder fails closed on malformed layout identity and bounds", () => {
  const cases: Array<(value: Record<string, unknown>) => void> = [
    (value) => { (value.pages as Record<string, unknown>).revision = 1.5; },
    (value) => { delete (value.pages as Record<string, unknown>).updated_at; },
    (value) => { (value.pages as Record<string, unknown>).unknown = true; },
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
    (value) => { (value.eligible_fields as Record<string, unknown>[])[0].selection = { mode: "text", max_selected: 1 }; },
    (value) => { (value.eligible_fields as Record<string, unknown>[])[0].options = []; },
    (value) => { (value.eligible_fields as Record<string, unknown>[])[1].field_key = "smoking"; },
    (value) => { (value.system_questions as Record<string, unknown>[]).reverse(); },
    (value) => { (value.system_questions as Record<string, unknown>[])[1].key = "relationship_status"; },
    (value) => { (value.system_questions as Record<string, unknown>[])[0].locked = false; },
    (value) => { value.dropped_items = [{ page_key: "bad", field_key: "smoking" }]; },
  ];
  for (const mutate of cases) {
    const value = raw();
    mutate(value);
    assert.equal(signupPagesPayload(value), null);
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

test("save responses distinguish revision, conflict and typed 422 rows", () => {
  assert.equal(signupPageSaveRevision({ success: true, status_code: 200, revision: 8 }), 8);
  assert.equal(signupPageSaveRevision({ success: true, revision: 8 }), null);
  assert.equal(signupPageSaveRevision({ success: true, revision: "8" }), null);
  assert.equal(signupPageConflict({ success: false, status_code: 409, error: "signup-page-layout-conflict" }), true);
  assert.equal(signupPageConflict({ success: false, status_code: 409, error: "other" }), false);

  const refusal = {
    success: false,
    status_code: 422,
    error: "signup-page-layout-invalid",
    errors: [
      { code: "blank-title", page_key: "p_00000001" },
      { code: "field-archived", page_key: "p_00000001", field_key: "smoking" },
      { code: "field-not-selectable", page_key: "p_00000001", field_key: "smoking" },
    ],
  };
  assert.deepEqual(signupPageSaveIssues(refusal), refusal.errors);
  assert.equal(signupPageSaveIssues({ ...refusal, errors: [{ code: "invented", page_key: "p_00000001" }] }), null);
  assert.equal(signupPageSaveIssues({ ...refusal, errors: [{ code: "unknown-field", page_key: "p_00000001" }] }), null);
});
