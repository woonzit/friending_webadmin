import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import {
  MODE_CARDS,
  MODE_CARDS_APP_CONTRACT_VERSION,
  MODE_CARDS_CONTRACT_VERSION,
  MODE_CARDS_ERROR_STATUSES,
  MODE_CARDS_FIELD_POINTERS,
  MODE_CARD_LANGUAGES,
  modeCardsAppBlock,
  modeCardsConflictResponse,
  modeCardsError,
  modeCardsFieldPointer,
  modeCardsMutationResponse,
  modeCardsStateResponse,
} from "../lib/modeCards.ts";

/**
 * Core's production-generated wire corpus (`tests/fixtures/mode_cards_wire/`),
 * copied byte-identically from the accepted Core P0 handoff. Every body
 * came out of the production projection and the production encoders, so this
 * console's decoder is verified against what Core actually publishes rather
 * than against a reading of the contract.
 *
 * The corpus is deliberately not vacuous: it carries the compiled copy, an
 * edited copy with a managed PNG, a card whose icon origin is FOREIGN (served
 * as no icon at all), and a half-written document whose untouched leaves fall
 * back — the four cases a decoder can get wrong without noticing.
 */
const FIXTURE_DIRECTORY = new URL("./fixtures/mode_cards_wire/", import.meta.url);
// T-865: copied from Core tip 3f715f3245211c933bfaae53b2398847d42d514e.
// Three fallback subtitle bodies now use friendship copy (AYI-051). The
// manifest records the newest scoped source commit, not the mechanical tip.
const FIXTURE_SOURCE_COMMIT = "bb3a7d6d1046aa2484d700fe40d592fb5edc4a65";
const FIXTURE_MANIFEST_SHA256 =
  "40ce1b0003fba129d1846d60833be997d9b8b4c5be7d89e95d79d1f07ca5da3f";
const FIXTURE_SET_SHA256 =
  "d89d998020d2a1b08ffddc31fc5ddc99455574adf99bfffef490d361d5209836";
const FIXTURE_CONTRACT_MANIFEST_SHA256 =
  "2541cd803a068d62cbd442e72a56fa5d3dac515e553cabb6e90a07c0498e3c9e";
const FIXTURE_GENERATOR_SHA256 =
  "099413b62ef880a39022d54ac0038aeb158d67f2bc3cc3922fc966722f453bec";
const FIXTURE_BODY_COUNT = 33;

/** D-116, pinned as bytes: the mode names the owner ruled, in both languages. */
const COMPILED_TITLES: Readonly<Record<string, string>> = {
  people: "People",
  dates: "AreYouIn",
};

type Json = Record<string, any>;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fixture(file: string): Promise<Json> {
  return JSON.parse(await readFile(new URL(file, FIXTURE_DIRECTORY), "utf8"));
}

test("the published mode-card corpus is byte-identical, complete and traceable to its Core source commit", async () => {
  const manifestBytes = await readFile(new URL("manifest.json", FIXTURE_DIRECTORY));
  assert.equal(sha256(manifestBytes), FIXTURE_MANIFEST_SHA256,
    "manifest.json must match its published byte hash");
  const published = await fixture("manifest.json");
  assert.deepEqual(Object.keys(published).sort(), [
    "app_contract_version",
    "contract_manifest_sha256",
    "contract_version",
    "fixture_set_sha256",
    "fixtures",
    "provenance",
    "schema_version",
    "source_commit",
  ]);
  assert.equal(published.schema_version, 1);
  assert.equal(published.contract_version, MODE_CARDS_CONTRACT_VERSION);
  assert.equal(published.app_contract_version, MODE_CARDS_APP_CONTRACT_VERSION);
  assert.equal(published.source_commit, FIXTURE_SOURCE_COMMIT);
  assert.equal(published.contract_manifest_sha256, FIXTURE_CONTRACT_MANIFEST_SHA256);
  assert.equal(published.fixture_set_sha256, FIXTURE_SET_SHA256);
  assert.equal(published.provenance.generator, "tests/mode_cards_fixture_dump.php");
  assert.equal(published.provenance.generator_sha256, FIXTURE_GENERATOR_SHA256);
  assert.equal(published.fixtures.length, FIXTURE_BODY_COUNT);

  const onDisk = (await readdir(FIXTURE_DIRECTORY))
    .filter((name) => name !== "manifest.json")
    .sort();
  const declared = published.fixtures
    .map((entry: Json) => String(entry.file))
    .sort();
  assert.deepEqual(onDisk, declared, "the directory and the manifest must agree");

  const lines: string[] = [];
  for (const entry of published.fixtures) {
    const bytes = await readFile(new URL(String(entry.file), FIXTURE_DIRECTORY));
    assert.equal(sha256(bytes), entry.sha256, `${entry.file} must match its published hash`);
    lines.push(`${entry.file}\u0000${entry.sha256}`);
  }
  assert.equal(sha256(lines.join("\n")), FIXTURE_SET_SHA256, "the set hash must hold");
});

test("every published app-config body decodes into exactly two cards in Core's order", async () => {
  for (const file of [
    "appconfig-compiled-defaults.json",
    "appconfig-edited.json",
    "appconfig-foreign-icon-dropped.json",
    "appconfig-partial-row.json",
  ]) {
    const body = await fixture(file);
    const block = modeCardsAppBlock(body.data.mode_cards);
    assert.ok(block, `${file} must decode`);
    assert.equal(block.contract_version, MODE_CARDS_APP_CONTRACT_VERSION);
    assert.deepEqual(block.cards.map((card) => card.key), [...MODE_CARDS]);
    for (const card of block.cards) {
      assert.deepEqual(Object.keys(card.title).sort(), [...MODE_CARD_LANGUAGES].sort());
      assert.deepEqual(Object.keys(card.subtitle).sort(), [...MODE_CARD_LANGUAGES].sort());
    }
  }
});

test("the compiled body carries the ruled mode names and no retired one", async () => {
  const body = await fixture("appconfig-compiled-defaults.json");
  const block = modeCardsAppBlock(body.data.mode_cards);
  assert.ok(block);
  assert.deepEqual(block.cards.find((card) => card.key === "dates")?.subtitle, {
    en: "AreYouIn — join or host activities near you",
    hu: "AreYouIn — csatlakozz programokhoz, vagy szervezz egyet a közeledben",
  });
  for (const card of block.cards) {
    for (const language of MODE_CARD_LANGUAGES) {
      assert.equal(card.title[language], COMPILED_TITLES[card.key],
        `${card.key}.${language} must be the ruled mode name`);
      for (const value of [card.title[language], card.subtitle[language]]) {
        assert.ok(!value.includes("Randik"), `${card.key}.${language} still names Randik`);
        assert.ok(!value.includes("Love"), `${card.key}.${language} still names Love`);
      }
    }
    assert.equal(card.icon, null, "the compiled copy carries no icon");
  }
});

test("a foreign icon origin reaches the console as no icon, with its copy untouched", async () => {
  const foreign = modeCardsAppBlock((await fixture("appconfig-foreign-icon-dropped.json")).data.mode_cards);
  const edited = modeCardsAppBlock((await fixture("appconfig-edited.json")).data.mode_cards);
  assert.ok(foreign && edited);
  assert.equal(foreign.cards[0].icon, null);
  assert.deepEqual(edited.cards[0].icon, {
    url: edited.cards[0].icon?.url,
    mime: "image/png",
  });
  assert.ok(edited.cards[0].icon?.url.startsWith("https://img.friending.co/"));
  assert.deepEqual(foreign.cards[0].title, edited.cards[0].title);
});

test("a half-written document serves the compiled copy for every untouched leaf", async () => {
  const partial = modeCardsAppBlock((await fixture("appconfig-partial-row.json")).data.mode_cards);
  const compiled = modeCardsAppBlock((await fixture("appconfig-compiled-defaults.json")).data.mode_cards);
  assert.ok(partial && compiled);
  assert.equal(partial.cards[1].title.hu, "AreYouIn HU", "the one stored leaf is served");
  assert.equal(partial.cards[1].title.en, compiled.cards[1].title.en, "the untouched language falls back");
  assert.deepEqual(partial.cards[0], compiled.cards[0], "the untouched card falls back entirely");
});

test("the console read and the save result decode through their own paths", async () => {
  const read = modeCardsStateResponse(await fixture("get-edited.json"));
  assert.ok(read, "the console read must decode");
  assert.equal(read.revision, 4);
  assert.equal(read.updated_by, "owner@friending.com");

  // A mutation body must never decode as a read: `no_change`/`replayed` select
  // the mutation variant.
  const saved = await fixture("save-committed.json");
  assert.equal(modeCardsStateResponse(saved), null, "a save body is not a read body");
  const mutation = modeCardsMutationResponse(saved);
  assert.ok(mutation);
  assert.equal(mutation.no_change, false);
  assert.equal(mutation.replayed, false);
  assert.deepEqual(mutation.cards, read.cards, "both carry the same projection");

  const noChange = modeCardsMutationResponse(await fixture("save-no-change.json"));
  assert.ok(noChange);
  assert.equal(noChange.no_change, true);
  assert.equal(noChange.revision, read.revision, "a no-op does not move the revision");

  const replayed = modeCardsMutationResponse(await fixture("save-replayed.json"));
  assert.ok(replayed);
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.no_change, false);

  const compiledRead = modeCardsStateResponse(await fixture("get-compiled-defaults.json"));
  assert.ok(compiledRead);
  assert.equal(compiledRead.revision, 0, "an unsaved singleton reads revision 0");
  assert.equal(compiledRead.updated_by, "");
});

test("the conflict is the only refusal that carries state, and it decodes fully", async () => {
  const body = await fixture("save-conflict.json");
  const conflict = modeCardsConflictResponse(body);
  assert.ok(conflict, "the conflict must decode");
  assert.equal(conflict.current.revision, 4);
  assert.deepEqual(conflict.current.cards.map((card) => card.key), [...MODE_CARDS]);
  // The conflict is excluded from the plain error decoder so a malformed one
  // cannot clear the durable identity.
  assert.equal(modeCardsError(body), null);
});

test("every published refusal decodes with the exact status this console pinned", async () => {
  const published = await fixture("manifest.json");
  const refusals = published.fixtures
    .map((entry: Json) => String(entry.file))
    .filter((file: string) => file.startsWith("error-"));
  assert.ok(refusals.length >= 20, "the corpus must carry the whole refusal vocabulary");
  for (const file of refusals) {
    const body = await fixture(file);
    const error = String(body.error);
    assert.ok(Object.hasOwn(MODE_CARDS_ERROR_STATUSES, error),
      `${error} is served by Core but unknown to this console`);
    assert.equal(MODE_CARDS_ERROR_STATUSES[error], body.status_code,
      `${error} status disagrees with Core`);
    assert.equal(modeCardsError(body), error, `${file} must decode as a refusal`);
    if (Object.hasOwn(body, "field")) {
      assert.equal(modeCardsFieldPointer(body), body.field,
        `${file} names a leaf this console does not render`);
      assert.ok(MODE_CARDS_FIELD_POINTERS.includes(String(body.field)));
    }
  }
});

test("a refusal whose status disagrees with Core is not believed", async () => {
  const body = await fixture("error-mode-cards-title-invalid.json");
  assert.equal(modeCardsError({ ...body, status_code: 409 }), null);
  assert.equal(modeCardsError({ ...body, error: "mode-cards-not-a-real-name" }), null);
});
