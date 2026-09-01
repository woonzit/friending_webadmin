import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  layer2Catalog,
  intentsRevisionIsCurrent,
  emptyReciprocalSets,
  selectableIntents,
  clampSelectionLimit,
  selectionLimitIsWritable,
  selectionLimitOutOfRange,
  LAYER2_SELECTION_LIMIT_CHOICES,
  LAYER2_SELECTION_LIMIT_MAX,
  LAYER2_SELECTION_LIMIT_MIN,
  type Layer2Catalog,
} from "../lib/layer2Intents.ts";

/**
 * Field names are Core's, taken from config/layer2_intent_catalog_v1.json.
 *
 * Every item is reciprocal and carries a set (DEC-011). The two items sit in different sets on
 * purpose: a single-set fixture would pass a parser that ignored the set id entirely.
 */
const valid = {
  schema_version: 1,
  catalog_revision: 7,
  glossary_revision: 1,
  selection_limit: 5,
  reciprocal_sets: ["kink", "long_term"],
  items: [
    {
      id: "long_term",
      labels: { en: "Long-term connections", hu: "Hosszú távú kapcsolat" },
      glossary: { en: "Looking for something lasting.", hu: "Tartós kapcsolatot keresel." },
      layer1: ["love"],
      visibility_mode: "reciprocal",
      reciprocal_set_id: "long_term",
      order: 10,
      archived: false,
    },
    {
      id: "kink",
      labels: { en: "Kinks and desires", hu: "Kink és vágyak" },
      glossary: { en: "Shared only with others who opt in.", hu: "Csak a szintén jelentkezőkkel." },
      layer1: ["sex"],
      visibility_mode: "reciprocal",
      reciprocal_set_id: "kink",
      order: 20,
      archived: false,
    },
  ],
};

function parsed(value: unknown): Layer2Catalog {
  const result = layer2Catalog(value);
  assert.equal(result.ok, true, result.ok ? "" : `unexpected ${result.error} ${result.item_id ?? ""}`);
  if (!result.ok) throw new Error("unreachable");
  return result.catalog;
}

function rejects(value: unknown, error: string, itemId?: string): void {
  const result = layer2Catalog(value);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected a rejection");
  assert.equal(result.error, error);
  if (itemId !== undefined) assert.equal(result.item_id, itemId);
}

/** Core's seed after its DEC-011 migration, vendored verbatim from config/. */
const SEED_URL = new URL("./fixtures/layer2_intent_catalog_v1.json", import.meta.url);

/**
 * The same file as Core shipped it BEFORE DEC-011: eleven items, nine of them `public`. Kept, and
 * kept pinned, because it is the exact document a Core that has not been migrated still serves —
 * better evidence that the console refuses a stale catalogue than anything written by hand here.
 */
const PRE_DEC011_SEED_URL = new URL("./fixtures/layer2_intent_catalog_v1_pre_dec011.json", import.meta.url);

test("Core's pre-DEC-011 seed is refused, not shown as reciprocal", async () => {
  const raw = await readFile(PRE_DEC011_SEED_URL, "utf8");
  // Pinned: this fixture is a historical document and must never drift.
  assert.equal(
    createHash("sha256").update(raw).digest("hex"),
    "27bacac75cb87c0916268e9b8621cbfbe1acc98473a3ae4a85832ac6ab708fc5",
  );
  const seed = JSON.parse(raw);
  // The shape is still the shape: eleven items, limit 5, two declared sets, every glossary present.
  assert.equal(seed.items.length, 11);
  assert.equal(seed.selection_limit, 5);
  assert.deepEqual(seed.reciprocal_sets, ["enm", "kink"]);
  assert.equal(seed.items.filter((item: { visibility_mode: string }) => item.visibility_mode === "public").length, 9);
  for (const item of seed.items) {
    assert.ok(String(item.glossary?.en ?? "").trim(), `${item.id} has no EN glossary`);
    assert.ok(String(item.glossary?.hu ?? "").trim(), `${item.id} has no HU glossary`);
  }

  // DEC-011: `public` is no longer a Layer 2 visibility mode. The whole document is refused, and
  // it is refused by its own name — the operator's next step is a Core migration, not an edit.
  // `dating` is the first stored item and the first public one, so it is the id reported.
  rejects(seed, "visibility-mode-public", "dating");
});

test("Core's migrated seed parses, and its shape is pinned", async () => {
  const raw = await readFile(SEED_URL, "utf8");
  // Pinned to Core commit cdba701 so a Core shape change breaks this build loudly rather than at
  // integration time.
  assert.equal(
    createHash("sha256").update(raw).digest("hex"),
    "603f9293c55d003daf3b0a79a3d877372fc2a3de3318fff0b631836a04bcdf99",
  );
  const catalog = parsed(JSON.parse(raw));
  assert.equal(catalog.items.length, 11);
  // The value a fresh bootstrap writes, at the pinned commit. Core lowered its seed to 3 in the
  // same change that made this an administrator parameter; when that lands, re-vendor the file and
  // this line moves with it. The number is not a contract — the bound below is.
  assert.equal(catalog.selection_limit, 5);
  assert.equal(selectionLimitOutOfRange(catalog), false, "the seeded limit is inside the client bound");
  // Every item is reciprocal and every one carries a set — the whole of DEC-011, on the real file.
  assert.equal(catalog.items.every((item) => item.visibility_mode === "reciprocal"), true);
  assert.equal(catalog.items.every((item) => item.reciprocal_set_id !== ""), true);
  // §8's two original sets keep their ids, so an existing selection resolves as it always did, and
  // the nine migrating items each got a set of their own rather than being pooled: pooling would
  // mean choosing "Making new friends" revealed someone's "Casual play and fun".
  assert.deepEqual(catalog.items.map((item) => item.reciprocal_set_id), catalog.items.map((item) => item.id));
  assert.equal(catalog.reciprocal_sets.length, 11);
  // Every glossary string is present, so Core will serve every row.
  for (const item of catalog.items) {
    assert.ok(item.glossary.en?.trim(), `${item.id} has no EN glossary`);
    assert.ok(item.glossary.hu?.trim(), `${item.id} has no HU glossary`);
  }
  // Every declared set has a live item in it, so nobody can opt into an empty one.
  assert.deepEqual(emptyReciprocalSets(catalog), []);
  // Nothing is archived in the seed, so everything is selectable.
  assert.equal(selectableIntents(catalog).length, 11);
});

test("a well-formed catalogue parses and carries its declared set registry", () => {
  const catalog = parsed(valid);
  assert.equal(catalog.items.length, 2);
  assert.deepEqual(catalog.reciprocal_sets, ["kink", "long_term"]);
  assert.equal(catalog.selection_limit, 5);
  // Every item carries its own boundary; the set is never blanked out on the way through.
  assert.deepEqual(catalog.items.map((item) => item.reciprocal_set_id), ["long_term", "kink"]);
  rejects({ ...valid, selection_limit: "5" }, "selection-limit-invalid");
});

test("the selection limit is required, never invented, and never widened", () => {
  // 1..5 is the released-client bound, not a house style. Pinned so a later "let's allow more"
  // has to change this line and read why.
  assert.equal(LAYER2_SELECTION_LIMIT_MIN, 1);
  assert.equal(LAYER2_SELECTION_LIMIT_MAX, 5);
  assert.deepEqual([...LAYER2_SELECTION_LIMIT_CHOICES], [1, 2, 3, 4, 5]);

  // Absence is a refusal, not a default. The page pre-fills an editable control from this number,
  // so a substituted constant is a value an operator can confirm and save without ever having been
  // shown what Core holds.
  const absent = structuredClone(valid) as Record<string, any>;
  delete absent.selection_limit;
  rejects(absent, "selection-limit-invalid");
  rejects({ ...valid, selection_limit: null }, "selection-limit-invalid");
  rejects({ ...valid, selection_limit: 2.5 }, "selection-limit-invalid");
  // A digit string is refused rather than coerced. Core accepts one on the way IN, because Webadmin
  // posts URL-encoded and a number arrives as a string, but `catalog()` resolves it through
  // `IntentsPolicy::selectionLimit()` and answers with an int — so a string on the way OUT is a
  // payload from somewhere this page should not be editing against.
  rejects({ ...valid, selection_limit: "3" }, "selection-limit-invalid");

  // Every value inside the bound survives verbatim, and none of them is flagged.
  for (const limit of LAYER2_SELECTION_LIMIT_CHOICES) {
    const catalog = parsed({ ...valid, selection_limit: limit });
    assert.equal(catalog.selection_limit, limit);
    assert.equal(catalog.selection_limit_stored, limit);
    assert.equal(selectionLimitOutOfRange(catalog), false);
  }

  // Outside the bound the catalogue still parses — refusing would blank the page including the one
  // control that repairs it — but the clamped value is what everything renders, and the stored one
  // survives so the page can say signup is currently failing on it. Both ends behave alike, which
  // is also how Core's own read path behaves: 0 fails the released-client guard exactly as 6 does.
  const tooHigh = parsed({ ...valid, selection_limit: 6 });
  assert.equal(tooHigh.selection_limit, 5, "the clamp is what every render uses");
  assert.equal(tooHigh.selection_limit_stored, 6, "and the truth is still available to report");
  assert.equal(selectionLimitOutOfRange(tooHigh), true);
  assert.equal(parsed({ ...valid, selection_limit: 1000 }).selection_limit, 5);

  const tooLow = parsed({ ...valid, selection_limit: 0 });
  assert.equal(tooLow.selection_limit, 1);
  assert.equal(tooLow.selection_limit_stored, 0);
  assert.equal(selectionLimitOutOfRange(tooLow), true);
  assert.equal(parsed({ ...valid, selection_limit: -4 }).selection_limit, 1);
});

test("the write bound is stricter than the read bound, and both are total", () => {
  // Read: clamped, always inside the contract, for any number.
  assert.equal(clampSelectionLimit(0), 1);
  assert.equal(clampSelectionLimit(-7), 1);
  assert.equal(clampSelectionLimit(3), 3);
  assert.equal(clampSelectionLimit(6), 5);
  assert.equal(clampSelectionLimit(Number.MAX_SAFE_INTEGER), 5);

  // Write: refused, never clamped. A clamp on the write path would store 5 for an operator who
  // asked for 7 and leave them believing the catalogue offers seven.
  assert.equal(selectionLimitIsWritable(1), true);
  assert.equal(selectionLimitIsWritable(5), true);
  assert.equal(selectionLimitIsWritable(0), false);
  assert.equal(selectionLimitIsWritable(6), false);
  assert.equal(selectionLimitIsWritable(2.5), false);
  assert.equal(selectionLimitIsWritable("3"), false);
  assert.equal(selectionLimitIsWritable(null), false);
  assert.equal(selectionLimitIsWritable(undefined), false);
});

test("archived is the stored polarity and is never confused with active", () => {
  const archived = structuredClone(valid) as Record<string, any>;
  archived.items[1].archived = true;
  const catalog = parsed(archived);
  assert.equal(catalog.items.length, 2, "an archived item is still parsed");
  assert.equal(catalog.items[1]?.archived, true);
  assert.deepEqual(selectableIntents(catalog).map((item) => item.id), ["long_term"]);
  // Absent means live, not archived — the inverse mapping would hide the whole catalogue.
  const absent = structuredClone(valid) as Record<string, any>;
  delete absent.items[0].archived;
  assert.equal(parsed(absent).items[0]?.archived, false);
  assert.equal(selectableIntents(parsed(absent)).length, 2);
  // Only a literal true archives; a truthy string does not.
  const truthy = structuredClone(valid) as Record<string, any>;
  truthy.items[0].archived = "yes";
  assert.equal(parsed(truthy).items[0]?.archived, false);
});

test("every item carries a set, and the failure shapes are distinct", () => {
  const noSet = structuredClone(valid) as Record<string, any>;
  delete noSet.items[1].reciprocal_set_id;
  rejects(noSet, "reciprocal-set-required", "kink");

  // The set is required on every item now, not only on ones that opted into a mode.
  const blankSet = structuredClone(valid) as Record<string, any>;
  blankSet.items[0].reciprocal_set_id = "";
  rejects(blankSet, "reciprocal-set-required", "long_term");

  // DEC-011: a stored public item is a stale document, and says so under its own error rather
  // than being rendered as reciprocal or lumped in with a typo'd mode.
  const stillPublic = structuredClone(valid) as Record<string, any>;
  stillPublic.items[0].visibility_mode = "public";
  stillPublic.items[0].reciprocal_set_id = "";
  rejects(stillPublic, "visibility-mode-public", "long_term");
  // Even carrying a valid set id, `public` is refused — the mode is gone, not merely redundant.
  const publicWithSet = structuredClone(valid) as Record<string, any>;
  publicWithSet.items[0].visibility_mode = "public";
  rejects(publicWithSet, "visibility-mode-public", "long_term");

  const badMode = structuredClone(valid) as Record<string, any>;
  badMode.items[1].visibility_mode = "private";
  rejects(badMode, "visibility-mode-invalid", "kink");
  const missingMode = structuredClone(valid) as Record<string, any>;
  delete missingMode.items[1].visibility_mode;
  rejects(missingMode, "visibility-mode-invalid", "kink");

  // A set the catalogue never declared is a typo that would create a private island.
  const undeclared = structuredClone(valid) as Record<string, any>;
  undeclared.items[1].reciprocal_set_id = "kimk";
  rejects(undeclared, "reciprocal-set-undeclared", "kink");
});

test("every item needs a Layer 1 mapping from a closed vocabulary", () => {
  const empty = structuredClone(valid) as Record<string, any>;
  empty.items[0].layer1 = [];
  rejects(empty, "layer1-mapping-missing", "long_term");

  const unknown = structuredClone(valid) as Record<string, any>;
  unknown.items[0].layer1 = ["dating"]; // a Layer 2 id, not a Layer 1 group
  rejects(unknown, "layer1-mapping-invalid", "long_term");

  const duplicated = structuredClone(valid) as Record<string, any>;
  duplicated.items[0].layer1 = ["love", "love"];
  rejects(duplicated, "layer1-mapping-invalid", "long_term");

  // Multi-mapping is legitimate: `fwb` maps to both sex and friends in the spec table.
  const multi = structuredClone(valid) as Record<string, any>;
  multi.items[0].layer1 = ["sex", "friends"];
  assert.deepEqual(parsed(multi).items[0]?.layer1, ["sex", "friends"]);
});

test("EN and HU are required for both label and glossary, and future locales survive", () => {
  const noHuLabel = structuredClone(valid) as Record<string, any>;
  delete noHuLabel.items[0].labels.hu;
  rejects(noHuLabel, "label-translation-missing", "long_term");

  const blankGlossary = structuredClone(valid) as Record<string, any>;
  blankGlossary.items[1].glossary.hu = "   ";
  rejects(blankGlossary, "glossary-translation-missing", "kink");

  const future = structuredClone(valid) as Record<string, any>;
  future.items[0].labels.de = "Langfristige Verbindungen";
  assert.equal(parsed(future).items[0]?.labels.de, "Langfristige Verbindungen");

  const badLocale = structuredClone(valid) as Record<string, any>;
  badLocale.items[0].labels["not a locale"] = "x";
  rejects(badLocale, "label-translation-missing", "long_term");
});

test("stable ids are enforced and duplicates are refused by id", () => {
  const duplicate = structuredClone(valid) as Record<string, any>;
  duplicate.items[1].id = "long_term";
  rejects(duplicate, "item-id-duplicate", "long_term");

  const renamed = structuredClone(valid) as Record<string, any>;
  renamed.items[0].id = "Long-Term";
  rejects(renamed, "item-id-invalid", undefined);
});

test("both revisions are required, and staleness is an explicit check", () => {
  rejects({ ...valid, catalog_revision: -1 }, "revision-invalid");
  rejects({ ...valid, catalog_revision: "7" }, "revision-invalid");
  rejects({ ...valid, glossary_revision: 1.5 }, "revision-invalid");
  rejects({ ...valid, schema_version: 2 }, "schema-version-unsupported");

  assert.equal(intentsRevisionIsCurrent(7, 7), true);
  assert.equal(intentsRevisionIsCurrent(6, 7), false, "a stale client must not resurrect an archived item");
  assert.equal(intentsRevisionIsCurrent(7.5, 7), false);
});

test("a declared set with nothing live in it is surfaced, and a one-item set is not", () => {
  // The canonical catalogue gives each set exactly one item, so a "single item is suspicious"
  // heuristic would fire on the correct data. The real hazard is a set members can join and never
  // see anything in.
  assert.deepEqual(emptyReciprocalSets(parsed(valid)), []);

  const archivedLast = structuredClone(valid) as Record<string, any>;
  archivedLast.items[1].archived = true;
  assert.deepEqual(emptyReciprocalSets(parsed(archivedLast)), ["kink"]);

  const declaredButUnused = structuredClone(valid) as Record<string, any>;
  declaredButUnused.reciprocal_sets = ["kink", "long_term", "enm"];
  assert.deepEqual(emptyReciprocalSets(parsed(declaredButUnused)), ["enm"]);
});

test("render order is deterministic and never depends on input order", () => {
  const tied = structuredClone(valid) as Record<string, any>;
  tied.items[0].order = 20;
  assert.deepEqual(selectableIntents(parsed(tied)).map((item) => item.id), ["kink", "long_term"]);

  const badOrder = structuredClone(valid) as Record<string, any>;
  badOrder.items[0].order = -1;
  rejects(badOrder, "order-invalid", "long_term");
});

test("the model hard-codes no catalogue content", async () => {
  const source = await readFile(new URL("../lib/layer2Intents.ts", import.meta.url), "utf8");
  assert.match(source, /friending-audience-signup-spec-v2\.5\.md/);
  assert.doesNotMatch(source, /adminCall|coreCall|fetch\(/);
  // Spec §2 [v2.5]: "No client may ship a temporarily hard-coded Layer 2 list." The rows live in
  // Core; only the Layer 1 group names and the id grammar are structural.
  for (const item of ["dating", "long_term", "monogamy", "short_term", "casual", "fwb", "new_friends", "community", "open_to_all"]) {
    assert.doesNotMatch(source, new RegExp(`["'\`]${item}["'\`]`), `${item} must not be hard-coded`);
  }
});

test("the wire payload Core actually builds parses, including its PHP quirks", async () => {
  const seed = JSON.parse(await readFile(SEED_URL, "utf8"));
  const items = seed.items;
  // Rebuilt field-for-field from Layer2CatalogAdminService::catalog(). It carries neither
  // reciprocal_sets nor glossary_revision, and names the revision intents_revision.
  //
  // `selection_limit` is 3 because that is what Core now serves for a document that has never been
  // configured: it resolves the stored field through `IntentsPolicy::selectionLimit()`, which falls
  // back to `MAX_LAYER2_SELECTIONS`, lowered to 3 on 2026-08-07. The console holds no default of
  // its own — it renders whatever Core resolved — so this asserts the wire, not a shared constant.
  const wire = {
    catalog: "layer2_intents_v1",
    schema_version: 1,
    intents_revision: 4,
    selection_limit: 3,
    items,
    publishable_ids: items.map((item: { id: string }) => item.id),
    blockers: [] as unknown,
  };
  const all = layer2Catalog(wire);
  assert.equal(all.ok, true, all.ok ? "" : `rejected: ${all.error}`);
  if (!all.ok) throw new Error("unreachable");
  assert.equal(all.catalog.catalog_revision, 4, "intents_revision is the wire name for the revision");
  assert.equal(all.catalog.selection_limit, 3, "Core's unconfigured default arrives as an ordinary value");
  assert.equal(selectionLimitOutOfRange(all.catalog), false);
  assert.equal(all.catalog.publishable_ids.length, 11);
  assert.deepEqual(all.catalog.blockers, []);
  // reciprocal_sets is absent on the wire, so it is derived from the sets the items name. Every
  // item has one now, so the registry is the full list rather than the two that opted in.
  assert.deepEqual(all.catalog.reciprocal_sets, [...items.map((item: { id: string }) => item.id)].sort());

  // Blockers arrive as a map from id to a single code; the locale lives in the code.
  const blocked = layer2Catalog({ ...wire, blockers: { dating: "layer2-glossary-missing-hu" } });
  assert.equal(blocked.ok, true);
  if (!blocked.ok) throw new Error("unreachable");
  assert.deepEqual(blocked.catalog.blockers, [{ id: "dating", error: "layer2-glossary-missing-hu", locale: "hu" }]);
  // A code without a locale suffix has no locale rather than a guessed one.
  const archived = layer2Catalog({ ...wire, blockers: { dating: "layer2-archived" } });
  assert.equal(archived.ok, true);
  if (!archived.ok) throw new Error("unreachable");
  assert.equal(archived.catalog.blockers[0]?.locale, null);

  // A non-empty list is still malformed: Core never sends one.
  assert.equal(layer2Catalog({ ...wire, blockers: ["layer2-archived"] }).ok, false);
  assert.equal(layer2Catalog({ ...wire, blockers: { dating: 7 } }).ok, false);
});

/** Frozen v1 contract evidence retained after the Admin surfaces were retired. */
test("the model admits exactly one visibility mode", async () => {
  const model = await readFile(new URL("../lib/layer2Intents.ts", import.meta.url), "utf8");
  assert.match(model, /export type IntentVisibilityMode = "reciprocal";/);
  // The parser must refuse `public` by name, not fold it into the generic invalid-mode answer.
  assert.match(model, /if \(mode === "public"\) return fail\("visibility-mode-public", id\);/);
  // No branch may still produce or blank a set id conditionally on the mode.
  assert.doesNotMatch(model, /reciprocal-set-on-public/);
});
