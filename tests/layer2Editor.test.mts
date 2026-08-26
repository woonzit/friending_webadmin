import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  CATALOG_CAPABILITIES,
  hasCatalogCapability,
  normalizeCatalogPrincipal,
} from "../lib/catalogAdmin.ts";

test("the catalog principal fails closed and is checked by capability name", () => {
  const principal = normalizeCatalogPrincipal({
    catalog: { role: "editor", rank: 20, capabilities: ["catalog_inventory_read", "catalog_layer2_edit"] },
  });
  assert.equal(principal?.role, "editor");
  assert.equal(hasCatalogCapability(principal, "catalog_layer2_edit"), true);
  assert.equal(hasCatalogCapability(principal, "catalog_promotion_approve"), false);

  // Anything the console cannot understand holds nothing, rather than inheriting a default.
  assert.equal(normalizeCatalogPrincipal(null), null);
  assert.equal(normalizeCatalogPrincipal({}), null);
  assert.equal(normalizeCatalogPrincipal({ catalog: { role: "superuser" } }), null);
  assert.equal(hasCatalogCapability(null, "catalog_layer2_edit"), false);
  // A malformed capability list yields no capabilities, not a crash.
  assert.deepEqual(normalizeCatalogPrincipal({ catalog: { role: "viewer", capabilities: "all" } })?.capabilities, []);
  assert.deepEqual(
    normalizeCatalogPrincipal({ catalog: { role: "viewer", capabilities: ["ok", 7, null] } })?.capabilities,
    ["ok"],
  );
});

test("the eight capability strings Core pins are the eight the console knows", () => {
  assert.deepEqual([...CATALOG_CAPABILITIES].sort(), [
    "catalog_dryrun_read",
    "catalog_inventory_read",
    "catalog_layer2_edit",
    "catalog_member_support_read",
    "catalog_member_support_write",
    "catalog_promotion_approve",
    "catalog_promotion_propose",
    "catalog_rule_edit",
  ]);
});

test("the four Layer 2 actions are allow-listed and no read is classified as a write", async () => {
  const actions = await readFile(new URL("../lib/adminActions.ts", import.meta.url), "utf8");
  for (const action of [
    "layer2_catalog",
    "save_layer2_item",
    "archive_layer2_item",
    "set_layer2_selection_limit",
  ]) {
    assert.match(actions, new RegExp(`"${action}"`), `${action} is not allow-listed`);
  }
  assert.match(actions, /layer2_catalog: "read"/);
  assert.match(actions, /save_layer2_item: "write"/);
  assert.match(actions, /archive_layer2_item: "write"/);
  // The limit is gated on Core's `CAP_LAYER2_EDIT`, the same capability as the two item writes.
  assert.match(actions, /set_layer2_selection_limit: "write"/);
});

test("the editor requires a reason, echoes the revision, and never merges a conflict", async () => {
  const page = await readFile(new URL("../app/(dashboard)/layer2-intents/page.tsx", import.meta.url), "utf8");
  // Every write carries a reason and the revision Core requires.
  for (const action of ["save_layer2_item", "archive_layer2_item", "set_layer2_selection_limit"]) {
    const call = page.slice(page.indexOf(`adminCall("${action}"`), page.indexOf(`adminCall("${action}"`) + 600);
    assert.match(call, /reason:/, `${action} sends no reason`);
    assert.match(call, /expected_intents_revision/, `${action} sends no revision`);
  }
  // A conflict discards the draft and shows the authoritative catalogue rather than merging.
  // Assert the behaviour, not the absence of a word: the handler replaces state from the
  // authoritative body and drops the draft. A bare /merge/i check matched the comment explaining
  // that merging is forbidden, which is the same shape of mistake as a two-character sentinel.
  const handler = page.slice(page.indexOf("function handleConflict"), page.indexOf("async function save"));
  assert.match(handler, /layer2Catalog\(authoritative\)/);
  assert.match(handler, /setCatalog\(fresh\.catalog\)/);
  assert.match(handler, /setDraft\(null\)/);
  assert.doesNotMatch(handler, /\.\.\.draft|\.\.\.catalog/, "the conflict path must not carry the stale draft forward");
  // Permissions come from the server capability, not from a hidden button.
  assert.match(page, /hasCatalogCapability\(principal, "catalog_layer2_edit"\)/);
  assert.match(page, /disabled=\{!canEdit\}/);
  // Archiving is described to the operator as retention, not deletion.
  assert.doesNotMatch(page, /adminCall\("delete/);
});

test("the operator copy states the reciprocal-only rule and the archive consequence in both locales", async () => {
  const en = JSON.parse(await readFile(new URL("../messages/en.json", import.meta.url), "utf8"));
  const hu = JSON.parse(await readFile(new URL("../messages/hu.json", import.meta.url), "utf8"));
  for (const messages of [en, hu]) {
    // §8: the marker at the point of selection is the consent — the editor must say so.
    assert.match(messages.layer2.disclosureRule, /consent|beleegyez/i);
    // DEC-011: the two halves of the rule, stated rather than implied. An operator reading only
    // "reciprocal" would still assume the answer shows on a profile to the people who qualify.
    assert.match(messages.layer2.disclosureRule, /never appears on a profile|soha nem jelenik meg a profilon/i);
    assert.match(messages.layer2.disclosureRule, /selected the same thing|ugyanezt beállították/i);
    // Archiving keeps existing selections; an operator must not read it as a delete.
    assert.match(messages.layer2.archiveCopy, /not a delete|nem törlés/i);
    // The glossary hint must state the reciprocal obligation, not just "write something".
    assert.match(messages.layer2.glossaryHint, /who will see|ki fogja látni/i);
    // The set is the boundary, and changing it on a live item is refused by Core.
    assert.match(messages.layer2.setHint, /disclosure boundary|nyilvánosságra hozatal határa/i);
    assert.match(messages.layer2.setHint, /archive|archiváld/i);
    // A stale document is named as stale, and points at the Core migration.
    assert.match(messages.layer2.stalePublicItem, /public|nyilvános/i);
    assert.match(messages.layer2.stalePublicItem, /Core/);
  }
  // The retired mode leaves no copy behind that could be reintroduced by a stray render.
  for (const messages of [en, hu]) {
    assert.equal(messages.layer2.modePublic, undefined);
    assert.equal(messages.layer2.modeReciprocal, undefined);
    assert.equal(messages.layer2.visibilityHint, undefined);
  }
});

test("the editor offers no visibility choice and no way to retarget a live set", async () => {
  const page = await readFile(new URL("../app/(dashboard)/layer2-intents/page.tsx", import.meta.url), "utf8");
  // DEC-011: every item is reciprocal, so there is nothing to choose between.
  assert.doesNotMatch(page, /modePublic|modeReciprocal|visibilityHint/);
  assert.doesNotMatch(page, /type="radio"/, "the mode radio row must be gone");
  assert.doesNotMatch(page, /visibility_mode: "public"/);
  // The mode is still SENT, and only ever as `reciprocal`: Core's normalizeEntry() requires the
  // field, so dropping it would turn every save into a 422.
  assert.match(page, /visibility_mode: draft\.visibility_mode/);
  // The set id is shown, required by the parser on every item, and not editable — Core answers
  // `layer2-reciprocal-set-immutable` for a change of set on a reciprocal item.
  assert.match(page, /value=\{value\.reciprocal_set_id\}\s+readOnly/);
  assert.doesNotMatch(page, /onChange=\{\(e\) => onChange\(\{ \.\.\.value, reciprocal_set_id/);
  // A stored public item is surfaced as a stale document rather than as a generic load failure.
  assert.match(page, /visibility-mode-public/);
  assert.match(page, /stalePublicItem/);
});

test("the selection limit is a bounded selector, and the page can never render a number outside it", async () => {
  const page = await readFile(new URL("../app/(dashboard)/layer2-intents/page.tsx", import.meta.url), "utf8");
  // The options come from the model's bounded list, not from a hand-written range in the page, so
  // the ceiling has exactly one definition and the argument for it lives beside it.
  assert.match(page, /LAYER2_SELECTION_LIMIT_CHOICES\.map/);
  // A free number field would let an operator type 6, and a stored 6 takes the whole V2 catalogue
  // down for released clients. `min`/`max` attributes are not a defence: they are advisory in
  // several browsers and absent from a programmatic change.
  assert.doesNotMatch(page, /type="number"[^>]*selection|selectionLimit[^>]*type="number"/);
  // From the control's own label to the unsaved notice below it. Not to `selectionLimitCeiling`:
  // that key is also the message for Core's range refusal, so its first occurrence is in the save
  // handler and the slice would run backwards and come out empty.
  const limitSelect = page.slice(page.indexOf("selectionLimitLabel"), page.indexOf("selectionLimitUnsaved"));
  assert.match(limitSelect, /<select/);
  assert.doesNotMatch(limitSelect, /type="number"/);

  // The write is checked locally as well, because the clamp puts an out-of-range stored value one
  // state variable away from being posted straight back.
  const call = page.slice(page.indexOf("async function saveSelectionLimit"), page.indexOf("async function applyArchive"));
  assert.match(call, /selectionLimitIsWritable\(limitDraft\)/);
  assert.match(call, /adminCall\("set_layer2_selection_limit"/);
  assert.match(call, /selection_limit: limitDraft/);
  // The two typed refusals Core answers with are handled by name; a generic retry can never clear
  // either of them.
  assert.match(call, /layer2-selection-limit-invalid/);
  assert.match(call, /layer2-selection-limit-out-of-range/);
  assert.match(call, /layer2-catalog-missing/);
  // A conflict on this write is resolved exactly like a conflict on an item write.
  assert.match(call, /handleConflict\(response\)/);
  // Core's `changed: false` no-op is reported as itself rather than as a successful change.
  assert.match(call, /response\.changed === false/);

  // Its own reason, kept apart from the item dialog's: the reason is what the audit row stores.
  assert.match(page, /limitReason/);
  assert.match(call, /limitReason\.trim\(\)\.length < MIN_REASON/);

  // The read-only capability governs the control, not merely the item buttons.
  assert.match(page, /disabled=\{!canEdit \|\| limitBusy\}/);
});

test("the subtitle states a limit only when one was actually loaded", async () => {
  const page = await readFile(new URL("../app/(dashboard)/layer2-intents/page.tsx", import.meta.url), "utf8");
  // The number is an administrator parameter now, so the page must not carry a compiled copy of it
  // anywhere. The forbidden branch previously rendered `subtitle`'s {limit} as a hard-coded 5.
  assert.doesNotMatch(page, /t\("subtitle", \{ limit: \d/);
  assert.match(page, /subtitle=\{t\("subtitleUnknownLimit"\)\}/);
  // The rendered catalogue states the clamped value, which is what every client actually honours.
  assert.match(page, /t\("subtitle", \{ limit: catalog\.selection_limit \}\)/);
  // Out of range is surfaced against the stored value, not the clamped one it is pre-filled with.
  assert.match(page, /selectionLimitOutOfRange\(catalog\)/);
  assert.match(page, /stored: catalog\.selection_limit_stored/);
});

test("the operator copy says why five is the ceiling, in both locales", async () => {
  const en = JSON.parse(await readFile(new URL("../messages/en.json", import.meta.url), "utf8"));
  const hu = JSON.parse(await readFile(new URL("../messages/hu.json", import.meta.url), "utf8"));
  for (const messages of [en, hu]) {
    // The reason must be the consequence, not "the maximum is five". An operator who is only told
    // a rule looks for the setting that relaxes it; one who is told the app discards the catalogue
    // and fails signup does not.
    assert.match(messages.layer2.selectionLimitCeiling, /iOS/);
    assert.match(messages.layer2.selectionLimitCeiling, /1–5|1 és 5/);
    assert.match(messages.layer2.selectionLimitCeiling, /discards? the entire|az egész Layer 2 katalógust eldobja/i);
    assert.match(messages.layer2.selectionLimitCeiling, /signup|regisztráci/i);
    // And it must say where the ceiling can be raised, which is not here.
    assert.match(messages.layer2.selectionLimitCeiling, /released app version|kiadott alkalmazásverzió/i);

    // The out-of-range notice names both numbers: the stored one, and the one members are actually
    // being served. Naming only the stored value would leave an operator unable to tell whether
    // anything is reaching members at all.
    assert.match(messages.layer2.selectionLimitOutOfRange, /\{stored\}/);
    assert.match(messages.layer2.selectionLimitOutOfRange, /\{effective\}/);
    assert.match(messages.layer2.selectionLimitOutOfRange, /1 (and|és) 5|1–5/);
    // And it must NOT claim an outage. Core clamps the same value on its member wire, so signup is
    // working; the defect is the stored document. An operator told signup is down starts an
    // incident, and would find nothing wrong with it.
    assert.match(messages.layer2.selectionLimitOutOfRange, /is not failing|nem hibázik/i);
    assert.doesNotMatch(messages.layer2.selectionLimitOutOfRange, /right now|broken|éppen most|elromlott/i);
    // An unsaved draft must not read as if it were live.
    assert.match(messages.layer2.selectionLimitUnsaved, /\{current\}/);
    assert.match(messages.layer2.selectionLimitUnsaved, /Not saved|Még nincs mentve/i);
    // The subtitle variant used before a catalogue is loaded claims no number at all.
    assert.doesNotMatch(messages.layer2.subtitleUnknownLimit, /\{limit\}|\b[1-9]\b/);
  }
});

test("the model admits exactly one visibility mode", async () => {
  const model = await readFile(new URL("../lib/layer2Intents.ts", import.meta.url), "utf8");
  assert.match(model, /export type IntentVisibilityMode = "reciprocal";/);
  // The parser must refuse `public` by name, not fold it into the generic invalid-mode answer.
  assert.match(model, /if \(mode === "public"\) return fail\("visibility-mode-public", id\);/);
  // No branch may still produce or blank a set id conditionally on the mode.
  assert.doesNotMatch(model, /reciprocal-set-on-public/);
});

test("the catalog principal is read only from its own block, never from the surrounding body", () => {
  // `owner` exists in both the global webadmin ladder and the catalogue ladder, so a body without a
  // catalog block must not be mistaken for a catalogue principal.
  assert.equal(normalizeCatalogPrincipal({ success: true, email: "a@b.c", role: "owner", dates: {} }), null);
  assert.equal(normalizeCatalogPrincipal({ role: "editor", capabilities: ["catalog_layer2_edit"] }), null);
  // The block itself is still read normally.
  assert.equal(
    normalizeCatalogPrincipal({ role: "owner", catalog: { role: "editor", rank: 20, capabilities: ["catalog_layer2_edit"] } })?.role,
    "editor",
  );
});
