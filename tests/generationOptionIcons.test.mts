import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { PresentationSourceDialog } from "../components/PresentationSourceDialog.tsx";
import {
  incompletePresentationOptionLabels,
  parsePresentationAdminPayload,
  presentationOptionRows,
  serializePresentationSource,
  sourceTakesOptionIcons,
  type PresentationBuiltinSource,
} from "../lib/profilePresentation.ts";

/**
 * D-122 / T-730. Everything asserted here is checked against Core's own bytes:
 * `tests/fixtures/profile_presentation_generation_wire/` is the in-process
 * output of `ProfilePresentationAdminService`, not a hand-written stand-in.
 * See that directory's README for the capture and for the Core gap it exposes.
 */
const CORPUS = new URL(
  "./fixtures/profile_presentation_generation_wire/t730-generation-console-envelopes.json",
  import.meta.url,
);
const CORPUS_SHA256 = "2cfa78253a02add9fab538435ce4280f6de7848a84fe3aaeb2e7c75c2b19dd57";

type Corpus = {
  capture: {
    presentation_seeded: {
      generation_builtin: Record<string, unknown>;
      builtin_without_option_vocabulary: Record<string, unknown>;
    };
    save_four_icons_structured: { generation_builtin: Record<string, unknown> };
    save_labels_only: { generation_builtin: Record<string, unknown> };
    save_clear_one_icon: { generation_builtin: Record<string, unknown> };
    refusals: Record<string, { status_code: number; error: string }>;
  };
};

async function corpus(): Promise<Corpus> {
  const bytes = await readFile(CORPUS);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), CORPUS_SHA256,
    "the pinned Core corpus must match its published byte hash");
  return JSON.parse(bytes.toString("utf8")) as Corpus;
}

/** The console's real read path, with Core's real builtin bodies inside it. */
function adminPayload(builtins: unknown[]) {
  return {
    schema_version: 1,
    layout: {
      schema_version: 1,
      key: "public_profile_v1",
      revision: 4,
      highlight_cloud: [],
      more_about_me: [],
    },
    sources: { fields: [], builtins },
    reserved: { fields: [], builtins: [] },
    section_order: ["hero_photos", "highlight_cloud"],
    accent_roles: ["male", "female", "neutral"],
  };
}

function builtin(payload: unknown, key: string): PresentationBuiltinSource {
  const parsed = parsePresentationAdminPayload(payload);
  assert.ok(parsed, "the admin payload must parse");
  const source = parsed.sources.builtins.find((row) => row.key === key);
  assert.ok(source, `the ${key} builtin must survive the parse`);
  return source;
}

async function render(source: PresentationBuiltinSource, locale: "en" | "hu"): Promise<string> {
  const messages = JSON.parse(
    await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"),
  );
  return renderToStaticMarkup(createElement(
    NextIntlClientProvider,
    { locale, messages },
    createElement(PresentationSourceDialog, {
      source,
      busy: false,
      error: "",
      onChange: () => {},
      onClose: () => {},
      onSave: () => {},
    }),
  ));
}

function optionKeysInMarkup(markup: string): string[] {
  return [...markup.matchAll(/data-option-key="([^"]+)"/g)].map((match) => match[1]);
}

test("the served generation source carries the four-value vocabulary", async () => {
  const { capture } = await corpus();
  const source = builtin(
    adminPayload([capture.presentation_seeded.generation_builtin]),
    "generation",
  );
  assert.equal(sourceTakesOptionIcons(source), true);
  assert.deepEqual(presentationOptionRows(source).map((row) => row.key),
    ["genZ", "millennial", "genX", "boomer"]);
  assert.deepEqual(presentationOptionRows(source).map((row) => row.labels.hu),
    ["Z generáció", "Millenniumi generáció", "X generáció", "Baby boomer"]);
  // Seeded means "the vocabulary exists and nothing is uploaded yet", which is
  // exactly the state the four upload rows are for.
  assert.deepEqual(presentationOptionRows(source).map((row) => row.icon.url), ["", "", "", ""]);
});

test("a source with no per-value vocabulary sends [] and takes no option icons", async () => {
  const { capture } = await corpus();
  const raw = capture.presentation_seeded.builtin_without_option_vocabulary;
  // The bytes, not the prose: Core writes both keys on every builtin, and an
  // empty PHP array encodes as a JSON array rather than being omitted.
  assert.deepEqual(raw.option_labels, []);
  assert.deepEqual(raw.option_icons, []);
  const source = builtin(adminPayload([raw]), "work");
  assert.equal(sourceTakesOptionIcons(source), false);
  assert.deepEqual(presentationOptionRows(source), []);
});

test("a Core that predates the vocabulary parses and takes no option icons", async () => {
  const { capture } = await corpus();
  const raw = { ...capture.presentation_seeded.generation_builtin };
  delete raw.option_labels;
  delete raw.option_icons;
  const source = builtin(adminPayload([raw]), "generation");
  assert.equal(sourceTakesOptionIcons(source), false);
  assert.deepEqual(source.option_icons, {});
  assert.deepEqual(source.option_labels, {});
});

test("a malformed vocabulary fails the read closed rather than drawing unverified rows", async () => {
  const { capture } = await corpus();
  for (const broken of [
    { option_icons: { genZ: { url: "https://example.test/x.svg", mime: "image/svg+xml" } } },
    { option_icons: { genZ: { url: "https://img.friending.co/x.svg", mime: "image/gif" } } },
    { option_labels: { genZ: { en: "Gen Z" } } },
    { option_labels: { genZ: "Gen Z" } },
  ]) {
    const raw = { ...capture.presentation_seeded.generation_builtin, ...broken };
    assert.equal(parsePresentationAdminPayload(adminPayload([raw])), null,
      `${JSON.stringify(broken)} must not parse`);
  }
});

test("the dialog draws one row per option for generation and none for work", async () => {
  const { capture } = await corpus();
  const generation = builtin(
    adminPayload([capture.save_four_icons_structured.generation_builtin]),
    "generation",
  );
  const work = builtin(
    adminPayload([capture.presentation_seeded.builtin_without_option_vocabulary]),
    "work",
  );
  for (const locale of ["en", "hu"] as const) {
    const generationMarkup = await render(generation, locale);
    assert.deepEqual(optionKeysInMarkup(generationMarkup),
      ["genZ", "millennial", "genX", "boomer"]);
    // Each row shows the uploaded icon Core served back, so an operator can see
    // which of the four is already done.
    for (const url of [
      "https://img.friending.co/api/cache/admin/profile-icons/genz.svg",
      "https://img.friending.co/api/cache/admin/profile-icons/millennial.svg",
      "https://img.friending.co/api/cache/admin/profile-icons/genx.svg",
      "https://img.friending.co/api/cache/admin/profile-icons/boomer.png",
    ]) {
      assert.ok(generationMarkup.includes(url), `${url} must be previewed in ${locale}`);
    }
    assert.deepEqual(optionKeysInMarkup(await render(work, locale)), []);
  }
});

test("the option rows are localized in both locales", async () => {
  const { capture } = await corpus();
  const source = builtin(
    adminPayload([capture.presentation_seeded.generation_builtin]),
    "generation",
  );
  const en = await render(source, "en");
  const hu = await render(source, "hu");
  assert.ok(en.includes("Per-value icons and labels"));
  assert.ok(hu.includes("Értékenkénti ikonok és címkék"));
  assert.ok(en.includes("Millennial"));
  assert.ok(hu.includes("Millenniumi generáció"));
  // The heading, the hint and the per-row upload label all resolve — a missing
  // key would render as the key itself.
  for (const markup of [en, hu]) {
    assert.ok(!markup.includes("profilePresentation."), "no unresolved message key may render");
  }
});

test("one changed icon posts that icon only, and no labels", async () => {
  const { capture } = await corpus();
  const original = builtin(
    adminPayload([capture.presentation_seeded.generation_builtin]),
    "generation",
  );
  const draft: PresentationBuiltinSource = {
    ...structuredClone(original),
    option_icons: {
      ...original.option_icons,
      millennial: {
        url: "https://img.friending.co/api/cache/admin/profile-icons/millennial.svg",
        mime: "image/svg+xml",
      },
    },
  };
  assert.deepEqual(serializePresentationSource(original, draft), {
    source_key: "generation",
    expected_revision: 0,
    labels: { en: "Generation", hu: "Generáció" },
    icon_url: "",
    icon_mime: "",
    option_icons: {
      millennial: {
        url: "https://img.friending.co/api/cache/admin/profile-icons/millennial.svg",
        mime: "image/svg+xml",
      },
    },
  });
});

test("a labels-only save mentions no option at all, so stored uploads survive", async () => {
  const { capture } = await corpus();
  const original = builtin(
    adminPayload([capture.save_four_icons_structured.generation_builtin]),
    "generation",
  );
  const draft = structuredClone(original);
  draft.labels = { ...draft.labels, hu: "Korosztály" };
  const body = serializePresentationSource(original, draft);
  assert.equal("option_icons" in body, false);
  assert.equal("option_labels" in body, false);
  assert.deepEqual(body.labels, { en: "Generation", hu: "Korosztály" });
  // And Core's own answer to that request, from the corpus: all four uploads
  // still served, one revision later.
  const after = builtin(
    adminPayload([capture.save_labels_only.generation_builtin]),
    "generation",
  );
  assert.equal(after.revision, original.revision + 1);
  assert.deepEqual(
    presentationOptionRows(after).map((row) => row.icon.url),
    presentationOptionRows(original).map((row) => row.icon.url),
  );
});

test("one changed option label posts that label only, and no icons", async () => {
  const { capture } = await corpus();
  const original = builtin(
    adminPayload([capture.save_four_icons_structured.generation_builtin]),
    "generation",
  );
  const draft = structuredClone(original);
  draft.option_labels = {
    ...draft.option_labels,
    boomer: { en: "Boomer", hu: "  Nagy generáció  " },
  };
  const body = serializePresentationSource(original, draft);
  assert.equal("option_icons" in body, false);
  assert.deepEqual(body.option_labels, { boomer: { en: "Boomer", hu: "Nagy generáció" } });
});

test("clearing one icon travels explicitly, as an empty url on that option", async () => {
  const { capture } = await corpus();
  const original = builtin(
    adminPayload([capture.save_four_icons_structured.generation_builtin]),
    "generation",
  );
  const draft = structuredClone(original);
  draft.option_icons = { ...draft.option_icons, boomer: { url: "", mime: "" } };
  const body = serializePresentationSource(original, draft);
  assert.deepEqual(body.option_icons, { boomer: { url: "", mime: "" } });
  // Which is what Core stored: three icons kept, that one back to the source.
  const after = builtin(adminPayload([capture.save_clear_one_icon.generation_builtin]), "generation");
  assert.equal(after.option_icons.boomer.url, "");
  assert.equal(after.option_icons.genZ.url,
    "https://img.friending.co/api/cache/admin/profile-icons/genz.svg");
});

test("an upload the operator undoes before saving sends nothing", async () => {
  const { capture } = await corpus();
  const original = builtin(
    adminPayload([capture.presentation_seeded.generation_builtin]),
    "generation",
  );
  const draft = structuredClone(original);
  draft.option_icons = {
    ...draft.option_icons,
    genX: { url: "https://img.friending.co/api/cache/admin/profile-icons/genx.svg", mime: "image/svg+xml" },
  };
  draft.option_icons = { ...draft.option_icons, genX: { url: "", mime: "" } };
  const body = serializePresentationSource(original, draft);
  assert.equal("option_icons" in body, false);
});

test("an emptied option label is named before the request is sent", async () => {
  const { capture } = await corpus();
  const source = builtin(
    adminPayload([capture.presentation_seeded.generation_builtin]),
    "generation",
  );
  assert.deepEqual(incompletePresentationOptionLabels(source), []);
  const draft = structuredClone(source);
  draft.option_labels = {
    ...draft.option_labels,
    genX: { en: "Gen X", hu: "   " },
    boomer: { en: "", hu: "Baby boomer" },
  };
  assert.deepEqual(incompletePresentationOptionLabels(draft), ["genX", "boomer"]);
});

test("every refusal the option fields can raise has operator copy in both locales", async () => {
  const { capture } = await corpus();
  assert.deepEqual(
    Object.values(capture.refusals).map((row) => `${row.status_code} ${row.error}`),
    [
      "422 profile-presentation-icon-unmanaged",
      "422 profile-presentation-source-definition-invalid",
      "409 profile-presentation-source-conflict",
    ],
  );
  for (const locale of ["en", "hu"] as const) {
    const messages = JSON.parse(
      await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"),
    );
    for (const key of ["sourceIconUnmanaged", "sourceDefinitionInvalid", "sourceConflict", "optionLabelValidation"]) {
      assert.equal(typeof messages.profilePresentation[key], "string");
      assert.notEqual(messages.profilePresentation[key].trim(), "");
    }
  }
});
