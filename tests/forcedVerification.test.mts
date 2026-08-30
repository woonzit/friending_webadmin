import test from "node:test";
import assert from "node:assert/strict";
import {
  FORCED_BRIDGE_REFUSAL_STATUSES,
  FORCED_BRIDGE_UNCERTAIN_STATUSES,
  FORCED_CORE_REFUSAL_STATUSES,
  FORCED_CORE_UNCERTAIN_STATUSES,
  FORCED_STOREFRONTS,
  FORCED_VERIFICATION_ACTIONS,
  FORCED_VERIFICATION_REVISION_MAX,
  WAITING_ROOM_COMPILED_COPY,
  WAITING_ROOM_HELP_URL_MAX_BYTES,
  decodeForcedConsoleResponse,
  emptyWaitingRoomCopyOverrideDraft,
  waitingRoomCopyDraft,
  waitingRoomHelpUrlByteLength,
  waitingRoomHelpUrlIssue,
  decodeForcedImpactResponse,
  decodeForcedSaveResponse,
  forcedMethodList,
  forcedStorefrontName,
  forcedVerificationAccess,
  forcedVerificationDocumentFromDraft,
  forcedVerificationDocumentsEqual,
  forcedVerificationDraft,
  forcedVerificationProxyCapabilityAuthorized,
  forcedVerificationStorefronts,
  isForcedStorefront,
  localizedForcedStorefronts,
  normalizeForcedVerificationProxyBody,
  parseForcedVerificationAdminMe,
  parseForcedVerificationConsole,
  forcedCopyTrim,
  hasBoundaryWhitespace,
  parseForcedVerificationDocument,
  parseForcedVerificationImpact,
  parseForcedVerificationSaved,
  resolveForcedMethods,
  resolveWaitingRoomCopy,
  forcedVerificationDraftStorefronts,
  previewWaitingRoomCopy,
  resolveDraftForcedMethods,
  validateForcedVerificationDraft,
  waitingRoomTextLength,
  type ForcedVerificationDocument,
} from "../lib/forcedVerification.ts";
import { ADMIN_ACTIONS, adminActionAccess } from "../lib/adminActions.ts";
import { FORCED_VERIFICATION_CONTRACT_READY } from "../lib/contractReadiness.ts";

const LEGACY = { message: 200, status: 200, can_send: 0 } as const;

function success(data: unknown) {
  return { ...LEGACY, success: true, status_code: 200, data };
}

function refusal(error: string, status_code: number, data?: unknown) {
  return data === undefined ? { ...LEGACY, success: false, status_code, error } : { ...LEGACY, success: false, status_code, error, data };
}

function bridge(error: string, status_code: number) {
  return { success: false, error, status_code };
}

function document(overrides: Partial<ForcedVerificationDocument> = {}): ForcedVerificationDocument {
  return {
    default: { persona: false, video: false },
    overrides: {},
    copy_default: { en: { ...WAITING_ROOM_COMPILED_COPY.en }, hu: { ...WAITING_ROOM_COMPILED_COPY.hu } },
    copy_overrides: {},
    ...overrides,
  };
}

function consolePayload(overrides: Record<string, unknown> = {}) {
  return {
    revision: 1,
    ...document(),
    compiled_defaults: { copy: { en: { ...WAITING_ROOM_COMPILED_COPY.en }, hu: { ...WAITING_ROOM_COMPILED_COPY.hu } } },
    storefront_catalogue_hint: "alpha-3",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

test("the storefront catalogue is ISO alpha-3 only, sorted, localized in both languages", () => {
  assert.ok(FORCED_STOREFRONTS.length > 200);
  assert.ok(FORCED_STOREFRONTS.every((country) => /^[A-Z]{3}$/.test(country.alpha3) && /^[A-Z]{2}$/.test(country.alpha2)));
  assert.deepEqual(FORCED_STOREFRONTS.map((country) => country.alpha3), [...FORCED_STOREFRONTS.map((country) => country.alpha3)].sort());
  assert.equal(isForcedStorefront("USA"), true);
  assert.equal(isForcedStorefront("DEU"), true);
  assert.equal(isForcedStorefront("usa"), false);
  assert.equal(isForcedStorefront("US"), false);
  assert.equal(isForcedStorefront("XXX"), false);
  assert.equal(isForcedStorefront(""), false);
  const hu = localizedForcedStorefronts("hu");
  const en = localizedForcedStorefronts("en");
  assert.equal(hu.length, FORCED_STOREFRONTS.length);
  assert.equal(en.find((country) => country.alpha3 === "HUN")?.name, "Hungary");
  assert.equal(hu.find((country) => country.alpha3 === "HUN")?.name, "Magyarország");
  assert.equal(forcedStorefrontName("DEU", "en"), "Germany");
  assert.equal(forcedStorefrontName("DEU", "hu"), "Németország");
  assert.equal(forcedStorefrontName("XXX", "en"), "XXX");
});

// ---------------------------------------------------------------------------
// Strict parsers
// ---------------------------------------------------------------------------

test("the document parser accepts exactly the four-key contract shape and refuses every loose variant", () => {
  const valid = document({
    default: { persona: true, video: false },
    overrides: { DEU: { persona: false, video: false }, USA: { persona: true, video: true } },
    copy_overrides: { USA: { en: { title: "Verify to continue" }, hu: { description: "Rövid magyar leírás." } } },
  });
  assert.deepEqual(parseForcedVerificationDocument(valid), valid);
  assert.deepEqual(parseForcedVerificationDocument({ ...valid, overrides: { USA: valid.overrides.USA, DEU: valid.overrides.DEU } })?.overrides, valid.overrides, "keys are re-sorted");

  assert.equal(parseForcedVerificationDocument(null), null);
  assert.equal(parseForcedVerificationDocument([]), null);
  assert.equal(parseForcedVerificationDocument({ ...valid, extra: 1 }), null, "unknown key");
  const { copy_overrides: _dropped, ...missing } = valid;
  assert.equal(parseForcedVerificationDocument(missing), null, "missing key");
  assert.equal(parseForcedVerificationDocument({ ...valid, default: { persona: true } }), null, "partial methods");
  assert.equal(parseForcedVerificationDocument({ ...valid, default: { persona: "true", video: false } }), null, "string flag");
  assert.equal(parseForcedVerificationDocument({ ...valid, default: { persona: 1, video: 0 } }), null, "numeric flag");
  assert.equal(parseForcedVerificationDocument({ ...valid, overrides: [] }), null, "an array is not an override map");
  assert.equal(parseForcedVerificationDocument({ ...valid, overrides: { usa: { persona: true, video: true } } }), null, "lowercase storefront");
  assert.equal(parseForcedVerificationDocument({ ...valid, overrides: { US: { persona: true, video: true } } }), null, "alpha-2 storefront");
  assert.equal(parseForcedVerificationDocument({ ...valid, overrides: { USA: { persona: true } } }), null, "partial override methods");
  assert.equal(parseForcedVerificationDocument({ ...valid, copy_default: { en: valid.copy_default.en } }), null, "missing locale");
  assert.equal(parseForcedVerificationDocument({ ...valid, copy_default: { ...valid.copy_default, en: { ...valid.copy_default.en, title: "" } } }), null, "blank default title");
  assert.equal(parseForcedVerificationDocument({ ...valid, copy_default: { ...valid.copy_default, en: { ...valid.copy_default.en, title: "x".repeat(61) } } }), null, "title over 60");
  assert.equal(parseForcedVerificationDocument({ ...valid, copy_default: { ...valid.copy_default, en: { ...valid.copy_default.en, subtitle: "x".repeat(91) } } }), null, "subtitle over 90");
  assert.equal(parseForcedVerificationDocument({ ...valid, copy_default: { ...valid.copy_default, en: { ...valid.copy_default.en, description: "x".repeat(401) } } }), null, "description over 400");
  assert.equal(parseForcedVerificationDocument({ ...valid, copy_default: { ...valid.copy_default, en: { ...valid.copy_default.en, description: "bad\u0007" } } }), null, "control character");
  assert.equal(parseForcedVerificationDocument({ ...valid, copy_default: { ...valid.copy_default, en: { ...valid.copy_default.en, extra: "x" } } }), null, "unknown copy key");
  assert.equal(parseForcedVerificationDocument({ ...valid, copy_overrides: [] }), null, "array copy overrides");
  assert.equal(parseForcedVerificationDocument({ ...valid, copy_overrides: { USA: { fr: { title: "x" } } } }), null, "unknown locale");
  assert.equal(parseForcedVerificationDocument({ ...valid, copy_overrides: { USA: { en: { title: "" } } } }), null, "blank override field");
  assert.equal(parseForcedVerificationDocument({ ...valid, copy_overrides: { USA: { en: { headline: "x" } } } }), null, "unknown override field");
  assert.equal(parseForcedVerificationDocument({ ...valid, copy_overrides: { USA: { en: null } } }), null, "null locale override");
  assert.equal(waitingRoomTextLength("🇭🇺ab"), 4, "code points, not UTF-16 units");
  assert.ok(parseForcedVerificationDocument({ ...valid, copy_default: { ...valid.copy_default, en: { ...valid.copy_default.en, title: "🙂".repeat(60) } } }), "60 astral code points fit");
});

test("the console, save and impact materials are exact and closed", () => {
  const parsed = parseForcedVerificationConsole(consolePayload());
  assert.ok(parsed);
  assert.equal(parsed.revision, 1);
  assert.deepEqual(parsed.document, document());
  assert.deepEqual(parsed.compiled_defaults.copy, WAITING_ROOM_COMPILED_COPY);
  assert.equal(parseForcedVerificationConsole(consolePayload({ revision: 0 })), null, "revision below 1");
  assert.equal(parseForcedVerificationConsole(consolePayload({ revision: FORCED_VERIFICATION_REVISION_MAX + 2 })), null, "revision above 2^53 − 1");
  assert.ok(parseForcedVerificationConsole(consolePayload({ revision: FORCED_VERIFICATION_REVISION_MAX })));
  assert.equal(parseForcedVerificationConsole(consolePayload({ revision: "1" })), null, "string revision");
  assert.equal(parseForcedVerificationConsole(consolePayload({ storefront_catalogue_hint: "alpha-2" })), null, "wrong hint");
  assert.equal(parseForcedVerificationConsole(consolePayload({ compiled_defaults: { copy: { en: WAITING_ROOM_COMPILED_COPY.en } } })), null, "partial compiled copy");
  assert.equal(parseForcedVerificationConsole(consolePayload({ compiled_defaults: { copy: WAITING_ROOM_COMPILED_COPY, extra: 1 } })), null, "unknown compiled key");
  assert.equal(parseForcedVerificationConsole(consolePayload({ extra: true })), null, "unknown console key");
  const { compiled_defaults: _c, ...noCompiled } = consolePayload();
  assert.equal(parseForcedVerificationConsole(noCompiled), null, "missing compiled defaults");

  const saved = parseForcedVerificationSaved({ revision: 2, ...document() });
  assert.ok(saved);
  assert.equal(saved.revision, 2);
  assert.equal(parseForcedVerificationSaved({ revision: 1, ...document() }), null, "a saved revision is at least 2");
  assert.equal(parseForcedVerificationSaved({ revision: 2, ...document(), storefront_catalogue_hint: "alpha-3" }), null, "console-only key on the save material");

  const impact = parseForcedVerificationImpact({
    by_storefront: [{ storefront: "USA", members_seen: 10, would_be_gated: 4, satisfied: 6 }],
    unknown_storefront: { members_seen: 3, would_be_gated: 3, satisfied: 0 },
    computed_at: "2026-08-29T14:00:00Z",
  });
  assert.ok(impact);
  assert.equal(impact.by_storefront[0]?.would_be_gated, 4);
  assert.equal(parseForcedVerificationImpact({ by_storefront: [], unknown_storefront: { members_seen: 0, would_be_gated: 0, satisfied: 0 }, computed_at: "2026-08-29T14:00:00Z" })?.by_storefront.length, 0);
  assert.equal(parseForcedVerificationImpact({ by_storefront: [{ storefront: "USA", members_seen: 1, would_be_gated: 2, satisfied: 0 }], unknown_storefront: { members_seen: 0, would_be_gated: 0, satisfied: 0 }, computed_at: "2026-08-29T14:00:00Z" }), null, "gated above seen");
  assert.equal(parseForcedVerificationImpact({ by_storefront: [{ storefront: "USA", members_seen: 1, would_be_gated: 0, satisfied: 0 }, { storefront: "USA", members_seen: 1, would_be_gated: 0, satisfied: 0 }], unknown_storefront: { members_seen: 0, would_be_gated: 0, satisfied: 0 }, computed_at: "2026-08-29T14:00:00Z" }), null, "duplicate storefront row");
  assert.equal(parseForcedVerificationImpact({ by_storefront: [{ storefront: "USA", members_seen: 1, would_be_gated: 0, satisfied: 0, uids: [] }], unknown_storefront: { members_seen: 0, would_be_gated: 0, satisfied: 0 }, computed_at: "2026-08-29T14:00:00Z" }), null, "identities never enter the console");
  assert.equal(parseForcedVerificationImpact({ by_storefront: [], unknown_storefront: { members_seen: 0, would_be_gated: 0, satisfied: 0 }, computed_at: "2026-08-29T14:00:00" }), null, "timestamp without Z");
  assert.equal(parseForcedVerificationImpact({ by_storefront: [], unknown_storefront: { members_seen: 0, would_be_gated: 0, satisfied: 0 }, computed_at: "2026-13-29T14:00:00Z" }), null, "impossible month");
  assert.equal(parseForcedVerificationImpact({ by_storefront: [], unknown_storefront: { members_seen: "0", would_be_gated: 0, satisfied: 0 }, computed_at: "2026-08-29T14:00:00Z" }), null, "string count");
  assert.equal(parseForcedVerificationImpact({ by_storefront: [], unknown_storefront: { members_seen: -1, would_be_gated: 0, satisfied: 0 }, computed_at: "2026-08-29T14:00:00Z" }), null, "negative count");
});

test("the admin_me projection is a closed block and the access derives only from it plus the release switch", () => {
  const ready = parseForcedVerificationAdminMe({ contract_version: 1, contract_ready: true, actions: ["verification_forced_console", "verification_forced_save", "verification_forced_impact_preview"] });
  assert.deepEqual(ready?.actions, [...FORCED_VERIFICATION_ACTIONS]);
  const reader = parseForcedVerificationAdminMe({ contract_version: 1, contract_ready: true, actions: ["verification_forced_console"] });
  assert.ok(reader);
  const dormant = parseForcedVerificationAdminMe({ contract_version: 1, contract_ready: false, actions: [] });
  assert.ok(dormant);
  assert.equal(parseForcedVerificationAdminMe(undefined), null, "absent block");
  assert.equal(parseForcedVerificationAdminMe({ contract_version: 2, contract_ready: true, actions: [] }), null, "unknown contract version");
  assert.equal(parseForcedVerificationAdminMe({ contract_version: 1, contract_ready: false, actions: ["verification_forced_console"] }), null, "actions while not ready");
  assert.equal(parseForcedVerificationAdminMe({ contract_version: 1, contract_ready: true, actions: ["verification_console"] }), null, "foreign action name");
  assert.equal(parseForcedVerificationAdminMe({ contract_version: 1, contract_ready: true, actions: ["verification_forced_save", "verification_forced_console"] }), null, "not in canonical order");
  assert.equal(parseForcedVerificationAdminMe({ contract_version: 1, contract_ready: true, actions: ["verification_forced_console", "verification_forced_console"] }), null, "duplicate");
  assert.equal(parseForcedVerificationAdminMe({ contract_version: 1, contract_ready: true, actions: [], principal: {} }), null, "unknown key");

  assert.deepEqual(forcedVerificationAccess(ready, true), { visible: true, editable: true });
  assert.deepEqual(forcedVerificationAccess(reader, true), { visible: true, editable: false });
  assert.deepEqual(forcedVerificationAccess(dormant, true), { visible: false, editable: false });
  assert.deepEqual(forcedVerificationAccess(ready, false), { visible: false, editable: false }, "the local switch hides, never grants");
  assert.deepEqual(forcedVerificationAccess(null, true), { visible: false, editable: false });
  const saveOnly = parseForcedVerificationAdminMe({ contract_version: 1, contract_ready: true, actions: ["verification_forced_save"] });
  assert.deepEqual(forcedVerificationAccess(saveOnly, true), { visible: false, editable: false }, "no console action means no tab at all");

  const membership = { verification_forced: { contract_version: 1, contract_ready: true, actions: ["verification_forced_console"] } };
  assert.equal(forcedVerificationProxyCapabilityAuthorized("verification_forced_console", membership), true);
  assert.equal(forcedVerificationProxyCapabilityAuthorized("verification_forced_save", membership), false);
  assert.equal(forcedVerificationProxyCapabilityAuthorized("verification_forced_save", {}), false);
  assert.equal(forcedVerificationProxyCapabilityAuthorized("verification_console", membership), null, "outside the family");
});

// ---------------------------------------------------------------------------
// Draft ↔ document, validation, resolution
// ---------------------------------------------------------------------------

test("the draft round-trips the stored document and blank override fields inherit", () => {
  const stored = document({
    default: { persona: true, video: false },
    overrides: { DEU: { persona: false, video: false }, USA: { persona: true, video: true } },
    copy_overrides: { USA: { en: { title: "Verify to continue" }, hu: { description: "Rövid magyar leírás." } } },
  });
  const draft = forcedVerificationDraft(stored);
  assert.deepEqual(draft.overrides, [{ storefront: "DEU", persona: false, video: false }, { storefront: "USA", persona: true, video: true }]);
  assert.equal(draft.copy_overrides.USA?.en.title, "Verify to continue");
  assert.equal(draft.copy_overrides.USA?.en.subtitle, "", "absent override field is a blank editor field");
  assert.equal(draft.copy_overrides.USA?.hu.description, "Rövid magyar leírás.");
  const rebuilt = forcedVerificationDocumentFromDraft(draft);
  assert.ok(rebuilt);
  assert.deepEqual(rebuilt, stored);
  assert.equal(forcedVerificationDocumentsEqual(rebuilt, stored), true);

  draft.overrides.reverse();
  draft.copy_overrides.DEU = { en: { title: "  ", subtitle: "", description: "", help_url: "" }, hu: { title: "", subtitle: "", description: "", help_url: "" } };
  draft.copy_overrides.USA!.en.title = "  Verify to continue  ";
  const canonical = forcedVerificationDocumentFromDraft(draft);
  assert.ok(canonical);
  assert.deepEqual(Object.keys(canonical.overrides), ["DEU", "USA"], "storefront keys are sorted");
  assert.deepEqual(Object.keys(canonical.copy_overrides), ["USA"], "an all-blank override is dropped");
  assert.equal(canonical.copy_overrides.USA?.en?.title, "Verify to continue", "trimmed");
  assert.equal(forcedVerificationDocumentsEqual(canonical, stored), true);
});

test("draft validation mirrors the contract limits and every issue has a stable code", () => {
  const draft = forcedVerificationDraft(document());
  assert.equal(validateForcedVerificationDraft(draft), null);
  draft.overrides.push({ storefront: "", persona: true, video: false });
  assert.equal(validateForcedVerificationDraft(draft), "storefront");
  draft.overrides[0]!.storefront = "USA";
  draft.overrides.push({ storefront: "USA", persona: false, video: false });
  assert.equal(validateForcedVerificationDraft(draft), "duplicateStorefront");
  draft.overrides.pop();
  draft.copy_default.hu.title = "   ";
  assert.equal(validateForcedVerificationDraft(draft), "copyRequired");
  draft.copy_default.hu.title = "x".repeat(61);
  assert.equal(validateForcedVerificationDraft(draft), "copyTooLong");
  draft.copy_default.hu.title = "Két\nsor";
  assert.equal(validateForcedVerificationDraft(draft), "copyControl", "no line break in a title");
  draft.copy_default.hu.title = "Cím";
  draft.copy_default.hu.description = "Első sor\nMásodik sor";
  assert.equal(validateForcedVerificationDraft(draft), null, "a description may break lines");
  draft.copy_default.hu.description = "tab\there";
  assert.equal(validateForcedVerificationDraft(draft), null, "a tab is not a control character Core refuses");
  draft.copy_default.hu.description = "bell\u0007here";
  assert.equal(validateForcedVerificationDraft(draft), "copyControl");
  // T-475 B1: Core's `copyText` class ends at U+009F, so DEL and every C1 control are refused inside a text too.
  draft.copy_default.hu.description = "sor\u0085sor";
  assert.equal(validateForcedVerificationDraft(draft), "copyControl", "interior NEL (C1) is a control, not content");
  draft.copy_default.hu.description = "sor\u009Fsor";
  assert.equal(validateForcedVerificationDraft(draft), "copyControl", "the last C1 control U+009F");
  draft.copy_default.hu.description = "sor\u007Fsor";
  assert.equal(validateForcedVerificationDraft(draft), "copyControl", "DEL");
  draft.copy_default.hu.description = "sor\u00A0sor";
  assert.equal(validateForcedVerificationDraft(draft), null, "U+00A0 is the first code point past the class: interior NBSP stays content");
  draft.copy_default.hu.description = "Rendben.";
  draft.copy_overrides.USA = { en: { title: "", subtitle: "x".repeat(91), description: "", help_url: "" }, hu: { title: "", subtitle: "", description: "", help_url: "" } };
  assert.equal(validateForcedVerificationDraft(draft), "copyTooLong");
  draft.copy_overrides.USA.en.subtitle = "";
  assert.equal(validateForcedVerificationDraft(draft), null, "blank override fields are fine");
  assert.equal(forcedVerificationDocumentFromDraft({ ...draft, overrides: [{ storefront: "US", persona: true, video: true }] }), null, "an invalid draft never becomes a document");
});

test("Waiting Room copy is well-formed UTF-16 on every default and storefront text field", () => {
  const high = String.fromCharCode(0xd83d);
  const low = String.fromCharCode(0xde42);
  const astralPair = `${high}${low}`;
  const fields = ["title", "subtitle", "description"] as const;
  const locales = ["en", "hu"] as const;

  for (const field of fields) {
    for (const locale of locales) {
      for (const [label, malformed] of [["lone high surrogate", high], ["lone low surrogate", low]] as const) {
        const defaultDraft = forcedVerificationDraft(document());
        defaultDraft.copy_default[locale][field] = `copy${malformed}`;
        assert.equal(validateForcedVerificationDraft(defaultDraft), "copyMalformedText", `default ${locale}.${field}: ${label}`);
        const defaultWire = document();
        defaultWire.copy_default[locale][field] = `copy${malformed}`;
        assert.equal(parseForcedVerificationDocument(defaultWire), null, `published default ${locale}.${field}: ${label}`);

        const overrideDraft = forcedVerificationDraft(document());
        overrideDraft.copy_overrides.USA = emptyWaitingRoomCopyOverrideDraft();
        overrideDraft.copy_overrides.USA[locale][field] = `copy${malformed}`;
        assert.equal(validateForcedVerificationDraft(overrideDraft), "copyMalformedText", `override ${locale}.${field}: ${label}`);
        const overrideWire = document({ copy_overrides: { USA: { en: {}, hu: {} } } });
        overrideWire.copy_overrides.USA![locale][field] = `copy${malformed}`;
        assert.equal(parseForcedVerificationDocument(overrideWire), null, `published override ${locale}.${field}: ${label}`);
      }
    }
  }

  const validDraft = forcedVerificationDraft(document());
  validDraft.copy_overrides.USA = emptyWaitingRoomCopyOverrideDraft();
  for (const locale of locales) {
    for (const field of fields) {
      validDraft.copy_default[locale][field] = `Default ${astralPair}`;
      validDraft.copy_overrides.USA[locale][field] = `Override ${astralPair}`;
    }
  }
  assert.equal(validateForcedVerificationDraft(validDraft), null, "a valid astral surrogate pair passes every text field");
  const validWire = forcedVerificationDocumentFromDraft(validDraft);
  assert.ok(validWire && parseForcedVerificationDocument(validWire), "the valid astral pair survives canonicalization and strict parsing");
});

test("resolution follows the contract: override replaces the method set, copy inherits per field", () => {
  const stored = document({
    default: { persona: true, video: false },
    overrides: { DEU: { persona: false, video: false }, USA: { persona: true, video: true } },
    copy_overrides: { USA: { en: { title: "Verify to continue" }, hu: { description: "Rövid magyar leírás." } } },
  });
  assert.deepEqual(forcedMethodList(resolveForcedMethods(stored, null)), ["persona"], "unknown storefront → global");
  assert.deepEqual(forcedMethodList(resolveForcedMethods(stored, "FRA")), ["persona"], "no override → global");
  assert.deepEqual(forcedMethodList(resolveForcedMethods(stored, "DEU")), [], "an empty override means not forced there");
  assert.deepEqual(forcedMethodList(resolveForcedMethods(stored, "USA")), ["persona", "video"]);
  const usaEn = resolveWaitingRoomCopy(stored, "USA", "en");
  assert.equal(usaEn.title, "Verify to continue");
  assert.equal(usaEn.subtitle, WAITING_ROOM_COMPILED_COPY.en.subtitle, "inherits the global field of the same language");
  const usaHu = resolveWaitingRoomCopy(stored, "USA", "hu");
  assert.equal(usaHu.title, WAITING_ROOM_COMPILED_COPY.hu.title, "the English override does not leak into Hungarian");
  assert.equal(usaHu.description, "Rövid magyar leírás.");
  assert.deepEqual(resolveWaitingRoomCopy(stored, "DEU", "hu"), WAITING_ROOM_COMPILED_COPY.hu);
  assert.deepEqual(resolveWaitingRoomCopy(stored, null, "en"), WAITING_ROOM_COMPILED_COPY.en);
  assert.deepEqual(forcedVerificationStorefronts(stored), ["DEU", "USA"]);
});

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------

test("decoders adopt only exact success material bound to the request and classify refusals by envelope source", () => {
  const console_ = decodeForcedConsoleResponse(success(consolePayload()));
  assert.ok(console_.ok && console_.value.revision === 1);
  assert.deepEqual(decodeForcedConsoleResponse(null), { ok: false, kind: "uncertain", error: "no-response" });
  assert.deepEqual(decodeForcedConsoleResponse({ success: true }), { ok: false, kind: "uncertain", error: "malformed-envelope" });
  assert.deepEqual(decodeForcedConsoleResponse(success({ ...consolePayload(), extra: 1 })), { ok: false, kind: "uncertain", error: "malformed-material" });
  assert.deepEqual(decodeForcedConsoleResponse(refusal("verification-forced-unavailable", 503)), { ok: false, kind: "uncertain", error: "verification-forced-unavailable" }, "the malformed-stored-document state");
  assert.deepEqual(decodeForcedConsoleResponse(refusal("unauthorized", 401)), { ok: false, kind: "refused", error: "unauthorized", status: 401 });
  assert.deepEqual(decodeForcedConsoleResponse(refusal("unauthorized", 403)), { ok: false, kind: "uncertain", error: "unknown-refusal" }, "a known name at the wrong status is not a refusal");
  assert.deepEqual(decodeForcedConsoleResponse(refusal("verification-forced-conflict", 409, { revision: 3 })), { ok: false, kind: "uncertain", error: "refusal-with-data" }, "refusals never carry data");
  assert.deepEqual(decodeForcedConsoleResponse(bridge("auth-required", 401)), { ok: false, kind: "refused", error: "auth-required", status: 401 });
  assert.deepEqual(decodeForcedConsoleResponse(bridge("verification-capability-required", 403)), { ok: false, kind: "refused", error: "verification-capability-required", status: 403 });
  assert.deepEqual(decodeForcedConsoleResponse(bridge("core-timeout", 504)), { ok: false, kind: "uncertain", error: "core-timeout" });
  assert.deepEqual(decodeForcedConsoleResponse(bridge("verification-forced-conflict", 409)), { ok: false, kind: "uncertain", error: "unknown-refusal" }, "a Core name in the bridge envelope is never a refusal");

  const submitted = { expected_revision: 1, document: document({ default: { persona: true, video: false } }) };
  const saved = decodeForcedSaveResponse(success({ revision: 2, ...submitted.document }), submitted);
  assert.ok(saved.ok && saved.value.revision === 2);
  assert.deepEqual(decodeForcedSaveResponse(success({ revision: 1, ...submitted.document }), submitted), { ok: false, kind: "uncertain", error: "malformed-material" }, "a saved revision below 2 is not the save material");
  assert.deepEqual(decodeForcedSaveResponse(success({ revision: 2, ...submitted.document }), { ...submitted, expected_revision: 3 }), { ok: false, kind: "uncertain", error: "unbound-revision" }, "revision must be the exact successor of the expected one");
  assert.deepEqual(decodeForcedSaveResponse(success({ revision: 2, ...document() }), submitted), { ok: false, kind: "uncertain", error: "unbound-material" }, "a different stored document is never adopted");
  assert.deepEqual(decodeForcedSaveResponse(refusal("verification-forced-conflict", 409), submitted), { ok: false, kind: "refused", error: "verification-forced-conflict", status: 409 });
  assert.deepEqual(decodeForcedSaveResponse(refusal("verification-forced-invalid", 422), submitted), { ok: false, kind: "refused", error: "verification-forced-invalid", status: 422 });
  assert.deepEqual(decodeForcedSaveResponse(refusal("verification-forced-write-failed", 503), submitted), { ok: false, kind: "uncertain", error: "verification-forced-write-failed" });
  assert.deepEqual(decodeForcedSaveResponse(refusal("verification-forced-title-invalid", 422), submitted), { ok: false, kind: "uncertain", error: "unknown-refusal" }, "field codes are bound from the published status map, not guessed");
  assert.deepEqual(decodeForcedSaveResponse({ ...LEGACY, success: true, status_code: 200 }, submitted), { ok: false, kind: "uncertain", error: "malformed-envelope" }, "an empty success is not a save");

  const impact = decodeForcedImpactResponse(success({ by_storefront: [], unknown_storefront: { members_seen: 0, would_be_gated: 0, satisfied: 0 }, computed_at: "2026-08-29T14:00:00Z" }));
  assert.ok(impact.ok && impact.value.by_storefront.length === 0);
  assert.deepEqual(decodeForcedImpactResponse(success({ by_storefront: [] })), { ok: false, kind: "uncertain", error: "malformed-material" });
});

test("the refusal maps are closed, status-bound and disjoint per envelope source", () => {
  for (const [name, status] of FORCED_CORE_REFUSAL_STATUSES) assert.ok(status >= 400 && status < 500, `${name} is a definitive refusal`);
  for (const [name, status] of FORCED_CORE_UNCERTAIN_STATUSES) assert.equal(status, 503, name);
  for (const [name] of FORCED_CORE_UNCERTAIN_STATUSES) assert.equal(FORCED_CORE_REFUSAL_STATUSES.has(name), false, name);
  for (const [name, status] of FORCED_BRIDGE_UNCERTAIN_STATUSES) assert.ok(status === 502 || status === 504, name);
  for (const [name] of FORCED_BRIDGE_UNCERTAIN_STATUSES) assert.equal(FORCED_BRIDGE_REFUSAL_STATUSES.has(name), false, name);
  assert.deepEqual([...FORCED_CORE_REFUSAL_STATUSES.keys()].sort(), [
    "admin-revoked", "admin-session-invalid", "admin-write-required", "unauthorized",
    "verification-forced-conflict", "verification-forced-copy-default-invalid", "verification-forced-copy-overrides-invalid",
    "verification-forced-default-invalid", "verification-forced-invalid", "verification-forced-overrides-invalid",
    "verification-forced-revision-invalid",
  ]);
  assert.deepEqual([...FORCED_CORE_UNCERTAIN_STATUSES.keys()].sort(), ["verification-forced-unavailable", "verification-forced-write-failed"]);
});

// ---------------------------------------------------------------------------
// Proxy normalization and dormant registration
// ---------------------------------------------------------------------------

test("the proxy forwards only exact bodies and the actions stay dormant behind the release switch", () => {
  const valid = document({ default: { persona: true, video: false } });
  assert.deepEqual(normalizeForcedVerificationProxyBody("verification_forced_console", {}), {});
  assert.equal(normalizeForcedVerificationProxyBody("verification_forced_console", { page: 1 }), null);
  assert.deepEqual(normalizeForcedVerificationProxyBody("verification_forced_save", { expected_revision: 1, document: valid }), { expected_revision: 1, document: valid });
  assert.equal(normalizeForcedVerificationProxyBody("verification_forced_save", { expected_revision: 0, document: valid }), null, "revision below 1");
  assert.equal(normalizeForcedVerificationProxyBody("verification_forced_save", { expected_revision: "1", document: valid }), null, "string revision");
  assert.equal(normalizeForcedVerificationProxyBody("verification_forced_save", { expected_revision: 1, document: JSON.stringify(valid) }), null, "the browser sends an object, the proxy serialises");
  assert.equal(normalizeForcedVerificationProxyBody("verification_forced_save", { expected_revision: 1, document: valid, admin_email: "x" }), null, "reserved key");
  assert.equal(normalizeForcedVerificationProxyBody("verification_forced_save", { expected_revision: 1, document: { ...valid, revision: 1 } }), null, "the revision is Core-owned, never inside the document");
  assert.equal(normalizeForcedVerificationProxyBody("verification_forced_save", { document: valid }), null, "missing revision");
  assert.deepEqual(normalizeForcedVerificationProxyBody("verification_forced_impact_preview", { document: valid }), { document: valid });
  assert.equal(normalizeForcedVerificationProxyBody("verification_forced_impact_preview", { document: valid, expected_revision: 1 }), null);
  assert.equal(normalizeForcedVerificationProxyBody("verification_console", { anything: 1 }), undefined, "other families untouched");

  for (const action of FORCED_VERIFICATION_ACTIONS) {
    assert.equal((ADMIN_ACTIONS as readonly string[]).includes(action), FORCED_VERIFICATION_CONTRACT_READY, `${action} allow-listed only with the switch`);
    assert.equal(adminActionAccess(action) ?? null, FORCED_VERIFICATION_CONTRACT_READY ? (action === "verification_forced_save" ? "write" : "read") : null);
  }
});

test("copy whitespace mirrors Core: PHP trim, Unicode boundary whitespace refused, interior NBSP kept", () => {
  assert.equal(forcedCopyTrim(" \t\n\r\0\x0BCím \t\n\r\0\x0B"), "Cím", "PHP trim strips exactly its ASCII set");
  assert.equal(forcedCopyTrim("\u00A0Cím\u00A0"), "\u00A0Cím\u00A0", "PHP trim never strips Unicode whitespace");
  assert.equal(hasBoundaryWhitespace("Nem\u00A0törhető"), false, "interior NBSP is not boundary whitespace");
  for (const edge of ["\u00A0", "\u1680", "\u2000", "\u2003", "\u200A", "\u2028", "\u2029", "\u202F", "\u205F", "\u3000", "\u0085", "\uFEFF"]) {
    const label = `U+${edge.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
    assert.equal(hasBoundaryWhitespace(`${edge}Cim`), true, `leading ${label}`);
    assert.equal(hasBoundaryWhitespace(`Cim${edge}`), true, `trailing ${label}`);
    assert.equal(hasBoundaryWhitespace(`Ci${edge}m`), false, `interior ${label}`);
  }

  const draft = forcedVerificationDraft(document());
  draft.copy_default.hu.title = "\u00A0Cím";
  assert.equal(validateForcedVerificationDraft(draft), "copyWhitespace", "leading NBSP");
  draft.copy_default.hu.title = "Cím\u00A0";
  assert.equal(validateForcedVerificationDraft(draft), "copyWhitespace", "trailing NBSP");
  draft.copy_default.hu.title = "\u00A0";
  assert.equal(validateForcedVerificationDraft(draft), "copyWhitespace", "NBSP-only is a whitespace refusal, not a blank field");
  draft.copy_default.hu.title = " \u00A0\u2003 ";
  assert.equal(validateForcedVerificationDraft(draft), "copyWhitespace", "Unicode-whitespace-only after the ASCII edges are trimmed");
  draft.copy_default.hu.title = "\uFEFFCím";
  assert.equal(validateForcedVerificationDraft(draft), "copyWhitespace", "BOM edge");
  draft.copy_default.hu.title = "Cím\u0085";
  assert.equal(validateForcedVerificationDraft(draft), "copyControl", "an edge NEL is boundary whitespace AND a C1 control; the control refusal is reported first (T-475 B1)");
  draft.copy_default.hu.title = "Cí\u0085m";
  assert.equal(validateForcedVerificationDraft(draft), "copyControl", "interior NEL");
  draft.copy_default.hu.title = "Nem\u00A0törhető cím";
  assert.equal(validateForcedVerificationDraft(draft), null, "interior NBSP is content");
  draft.copy_default.hu.title = " \tNem\u00A0törhető cím\r\n";
  assert.equal(validateForcedVerificationDraft(draft), null, "ASCII edges are trimmed, never refused");
  const canonical = forcedVerificationDocumentFromDraft(draft);
  assert.ok(canonical);
  assert.equal(canonical.copy_default.hu.title, "Nem\u00A0törhető cím", "the canonical text keeps the interior NBSP and drops only the ASCII edges");
  assert.equal(waitingRoomTextLength(forcedCopyTrim(" a\u00A0b ")), 3, "the editor counter counts the NBSP");

  draft.copy_default.hu.title = "Cím";
  draft.copy_overrides.USA = { en: { title: "", subtitle: "", description: "", help_url: "" }, hu: { title: "", subtitle: "", description: "", help_url: "" } };
  draft.copy_overrides.USA!.en.title = "Verify\u00A0";
  assert.equal(validateForcedVerificationDraft(draft), "copyWhitespace", "per-storefront override copy: trailing NBSP");
  draft.copy_overrides.USA!.en.title = "\u00A0";
  assert.equal(validateForcedVerificationDraft(draft), "copyWhitespace", "an override made only of NBSP is refused, not dropped as blank");
  draft.copy_overrides.USA!.en.title = "Verify\u00A0to continue";
  assert.equal(validateForcedVerificationDraft(draft), null);
  assert.equal(forcedVerificationDocumentFromDraft(draft)?.copy_overrides.USA?.en?.title, "Verify\u00A0to continue", "override text keeps the interior NBSP");

  const valid = document();
  const withTitle = (title: string) => ({ ...valid, copy_default: { ...valid.copy_default, en: { ...valid.copy_default.en, title } } });
  assert.equal(parseForcedVerificationDocument(withTitle("\u00A0Verify")), null, "published leading NBSP fails closed");
  assert.equal(parseForcedVerificationDocument(withTitle("Verify\u00A0")), null, "published trailing NBSP fails closed");
  assert.equal(parseForcedVerificationDocument(withTitle("\u00A0")), null, "published NBSP-only fails closed");
  assert.equal(parseForcedVerificationDocument(withTitle(" Verify")), null, "published untrimmed ASCII edge fails closed");
  assert.equal(parseForcedVerificationDocument(withTitle("Verify\u0085")), null, "published NEL edge fails closed");
  assert.equal(parseForcedVerificationDocument(withTitle("Ver\u0085ify")), null, "published interior NEL fails closed: a C1 control (T-475 B1)");
  assert.equal(parseForcedVerificationDocument(withTitle("Ver\u009Fify")), null, "published interior U+009F fails closed");
  assert.equal(parseForcedVerificationDocument({ ...valid, copy_overrides: { USA: { en: { subtitle: "Ver\u0085ify" }, hu: {} } } }), null, "an override text carries the same control class");
  assert.ok(parseForcedVerificationDocument(withTitle("Verify\u00A0now")), "published interior NBSP is content");
});

test("preview: a malformed copy value degrades to the compiled text per field while the draft methods stand (Amendment v1.4)", () => {
  const compiled = { en: { ...WAITING_ROOM_COMPILED_COPY.en }, hu: { ...WAITING_ROOM_COMPILED_COPY.hu } };
  const draft = forcedVerificationDraft(document());
  draft.default = { persona: true, video: false };
  draft.overrides = [{ storefront: "USA", persona: false, video: true }, { storefront: "", persona: true, video: true }];
  draft.copy_default.hu.title = "x".repeat(61);
  assert.equal(validateForcedVerificationDraft(draft), "storefront", "the draft is not saveable");
  assert.deepEqual(resolveDraftForcedMethods(draft, null), { persona: true, video: false });
  assert.deepEqual(resolveDraftForcedMethods(draft, "USA"), { persona: false, video: true }, "an exact row replaces the whole set");
  assert.deepEqual(resolveDraftForcedMethods(draft, "DEU"), { persona: true, video: false }, "no row falls back to the global default");
  const hu = previewWaitingRoomCopy(draft, null, "hu", compiled);
  assert.deepEqual(hu.compiledFields, ["title"]);
  assert.equal(hu.copy.title, compiled.hu.title, "the over-limit title degrades to the compiled title");
  assert.equal(hu.copy.subtitle, draft.copy_default.hu.subtitle, "valid fields keep the draft text");
  assert.equal(hu.copy.description, draft.copy_default.hu.description);
  assert.deepEqual(previewWaitingRoomCopy(draft, null, "en", compiled).compiledFields, [], "the other locale is untouched");

  draft.copy_overrides.USA = { en: { title: "  Verify  ", subtitle: "\u00A0", description: "", help_url: "" }, hu: { title: "", subtitle: "", description: "", help_url: "" } };
  const usa = previewWaitingRoomCopy(draft, "USA", "en", compiled);
  assert.equal(usa.copy.title, "Verify", "a valid override is PHP-trimmed and used");
  assert.equal(usa.copy.subtitle, compiled.en.subtitle, "an NBSP-only override degrades to the compiled subtitle");
  assert.equal(usa.copy.description, draft.copy_default.en.description, "a blank override inherits the global default");
  assert.deepEqual(usa.compiledFields, ["subtitle"]);
  draft.copy_default.en.description = "";
  assert.deepEqual(previewWaitingRoomCopy(draft, "USA", "en", compiled).compiledFields, ["subtitle", "description"], "a missing default is a degraded field too");
  assert.deepEqual(previewWaitingRoomCopy(draft, "DEU", "en", compiled).compiledFields, ["description"], "a storefront without overrides degrades only the missing default");

  const storefronts = forcedVerificationDraftStorefronts(draft);
  assert.ok(storefronts.includes("USA") && !storefronts.includes(""), "blank rows are skipped");
  assert.deepEqual(storefronts, [...storefronts].sort());
});

test("a storefront copy override carries exactly both locale containers (T-471b finding 1)", () => {
  const valid = document();
  const withOverrides = (copy_overrides: unknown) => ({ ...valid, copy_overrides });
  const full = { HUN: { en: { title: "Verify to continue" }, hu: { title: "Hitelesíts a folytatáshoz" } } };

  // Reader: Core stores exactly `en` and `hu` on every storefront entry.
  assert.ok(parseForcedVerificationDocument(withOverrides(full)), "both containers parse");
  assert.ok(parseForcedVerificationDocument(withOverrides({ HUN: { en: {}, hu: {} } })), "two empty containers are the valid inherit-everything shape");
  assert.equal(parseForcedVerificationDocument(withOverrides({ HUN: { en: { title: "Verify to continue" } } })), null, "a missing hu container is never proven state");
  assert.equal(parseForcedVerificationDocument(withOverrides({ HUN: { hu: { title: "Hitelesíts a folytatáshoz" } } })), null, "a missing en container is never proven state");
  assert.equal(parseForcedVerificationDocument(withOverrides({ HUN: {} })), null, "neither locale");
  assert.equal(parseForcedVerificationDocument(withOverrides({ HUN: { en: {}, hu: {}, de: {} } })), null, "an extra locale");

  // Proxy normalisation decodes with the same reader before forwarding.
  assert.equal(
    normalizeForcedVerificationProxyBody("verification_forced_save", { expected_revision: 1, document: withOverrides({ HUN: { en: { title: "Verify to continue" } } }) }),
    null,
    "the proxy refuses to forward a partial locale container",
  );
  assert.ok(
    normalizeForcedVerificationProxyBody("verification_forced_save", { expected_revision: 1, document: withOverrides(full) }),
    "the proxy forwards a document with both containers",
  );

  // Draft canonicalisation: a blank locale travels as an empty object.
  const draft = forcedVerificationDraft(document());
  draft.copy_overrides.USA = { en: { title: "Verify to continue", subtitle: "", description: "", help_url: "" }, hu: { title: "", subtitle: "", description: "", help_url: "" } };
  const canonical = forcedVerificationDocumentFromDraft(draft);
  assert.ok(canonical);
  assert.deepEqual(canonical.copy_overrides.USA, { en: { title: "Verify to continue" }, hu: {} }, "the untranslated locale is an empty container, not a missing key");
  assert.deepEqual(Object.keys(canonical.copy_overrides.USA), ["en", "hu"], "en is emitted before hu, the key order Core compares");
  assert.ok(parseForcedVerificationDocument(canonical), "what the console emits is exactly what the reader accepts");

  draft.copy_overrides.DEU = { en: { title: "", subtitle: "", description: "", help_url: "" }, hu: { title: "", subtitle: "", description: "", help_url: "" } };
  assert.deepEqual(Object.keys(forcedVerificationDocumentFromDraft(draft)!.copy_overrides), ["USA"], "a storefront that overrides nothing at all is dropped whole");
});

test("save success is adopted only on the exact revision successor (T-471b finding 2)", () => {
  const submitted = { expected_revision: 7, document: document({ default: { persona: true, video: false } }) };
  const answer = (revision: number) => decodeForcedSaveResponse(success({ revision, ...submitted.document }), submitted);

  const adopted = answer(8);
  assert.ok(adopted.ok && adopted.value.revision === 8, "the exact successor is the only adopted success");
  for (const [revision, label] of [[7, "unchanged"], [9, "skipped"], [6, "stale"], [Number.MAX_SAFE_INTEGER, "maximum safe integer"]] as const) {
    assert.deepEqual(
      answer(revision),
      { ok: false, kind: "uncertain", error: "unbound-revision" },
      `a ${label} revision is uncertain, never adopted as authoritative`,
    );
  }

  const ceiling = { expected_revision: FORCED_VERIFICATION_REVISION_MAX - 1, document: submitted.document };
  const atCeiling = decodeForcedSaveResponse(success({ revision: FORCED_VERIFICATION_REVISION_MAX, ...ceiling.document }), ceiling);
  assert.ok(atCeiling.ok && atCeiling.value.revision === FORCED_VERIFICATION_REVISION_MAX, "the successor at the contract ceiling is still a success");
  assert.deepEqual(
    decodeForcedSaveResponse(success({ revision: FORCED_VERIFICATION_REVISION_MAX + 1, ...ceiling.document }), ceiling),
    { ok: false, kind: "uncertain", error: "malformed-material" },
    "a revision past the contract ceiling is not a readable saved document",
  );
});

// ---------------------------------------------------------------------------
// Waiting Room help URL (contract Amendment v1.5, D-057)
// ---------------------------------------------------------------------------

const HELP_PREFIX = "https://help.friending.com/";
const HELP_URL = `${HELP_PREFIX}waiting-room`;
/** Exactly 2048 UTF-8 bytes after the trim: the last accepted length. */
const HELP_URL_AT_LIMIT = HELP_PREFIX + "a".repeat(WAITING_ROOM_HELP_URL_MAX_BYTES - HELP_PREFIX.length);
/** Characters the test source keeps out of literals: BEL (C0), NEL (C1), a lone high surrogate, TAB, LF and backslash. */
const BEL = String.fromCharCode(0x07);
const NEL = String.fromCharCode(0x85);
const LONE_SURROGATE = String.fromCharCode(0xd83d);
const TAB = String.fromCharCode(0x09);
const LF = String.fromCharCode(0x0a);
const BACKSLASH = String.fromCharCode(0x5c);

function withHelp(defaultEn: string | null, copy_overrides: ForcedVerificationDocument["copy_overrides"] = {}): ForcedVerificationDocument {
  const base = document({ copy_overrides });
  return { ...base, copy_default: { ...base.copy_default, en: { ...base.copy_default.en, help_url: defaultEn } } };
}

function withDefault(base: ForcedVerificationDocument, help_url: unknown): unknown {
  return { ...base, copy_default: { ...base.copy_default, en: { ...base.copy_default.en, help_url } } };
}

function withOverride(base: ForcedVerificationDocument, help_url: unknown): unknown {
  return { ...base, copy_overrides: { USA: { en: { help_url }, hu: {} } } };
}

/**
 * Accept/refuse vectors copied from Core c0a4212
 * `tests/forced_verification_policy_test.php` (the v1.5 Waiting Room help URL table).
 * The two backslash cases additionally pin B16's named character-pattern edge.
 */
test("help_url validator agrees with every Core c0a4212 acceptance and refusal vector", () => {
  const coreHelpUrl = "https://friending.com/help/verification";
  const coreMaximumHelpUrl = "https://friending.com/help/".padEnd(WAITING_ROOM_HELP_URL_MAX_BYTES, "a");
  const accepted = [
    coreHelpUrl,
    "https://xn--sg-fka.friending.com:8443/p/%C3%BA?q=1&r=2#top",
    coreMaximumHelpUrl,
    "https://friending.com:443/help",
    "https://friending.com:1/",
    "https://friending.com:65535",
    "https://friending.com/help?next=:1x#:+1",
  ] as const;
  const refused: ReadonlyArray<readonly [string, unknown]> = [
    ["null is not a URL string", null],
    ["wrong type", 123],
    ["empty", ""],
    ["http scheme", "http://friending.com/help"],
    ["uppercase scheme", "HTTPS://friending.com/help"],
    ["scheme only", "https://"],
    ["credentials", "https://user:secret@friending.com/help"],
    ["empty user-info", "https://@friending.com/help"],
    ["one byte over the limit", `${coreMaximumHelpUrl}a`],
    ["C0 control character", `https://friending.com/help${BEL}`],
    ["C1 control character", `https://friending.com/help${NEL}`],
    ["interior whitespace", "https://friending.com/help page"],
    ["boundary whitespace", " https://friending.com/help"],
    ["trailing newline", `https://friending.com/help${LF}`],
    ["raw non-ASCII path", "https://friending.com/súgó"],
    ["raw IDN host", "https://súgó.friending.com/"],
    ["malformed percent escape", "https://friending.com/%zz"],
    ["invalid host label", "https://-friending.com/"],
    ["IPv6 host", "https://[2001:db8::1]/help"],
    ["empty authority", "https:///help"],
    ["empty host before a port", "https://:443/"],
    ["invalid port", "https://friending.com:abc/"],
    ["empty port", "https://friending.com:/"],
    ["port zero", "https://friending.com:0/"],
    ["port above 65535", "https://friending.com:65536/"],
    ["two ports", "https://friending.com:443:1/"],
    ["port with a trailing letter", "https://friending.com:1x/"],
    ["signed port", "https://friending.com:+1/"],
    ["fractional port", "https://friending.com:1.5/"],
    ["exponent port", "https://friending.com:1e2/"],
    ["leading-zero port", "https://friending.com:0443/"],
    ["credentials after a port", "https://friending.com:443@evil.test/"],
    ["backslash in a path", `https://friending.com${BACKSLASH}help`],
    ["credentials behind a backslash", `https://example.com${BACKSLASH}@evil.test/`],
  ];

  const base = withHelp(HELP_URL);
  for (const value of accepted) {
    assert.equal(waitingRoomHelpUrlIssue(value), null, `Core accepts ${value.slice(0, 80)}`);
    assert.ok(parseForcedVerificationDocument(withDefault(base, value)), `published default accepts ${value.slice(0, 80)}`);
    assert.ok(parseForcedVerificationDocument(withOverride(base, value)), `published override accepts ${value.slice(0, 80)}`);
  }
  for (const [label, value] of refused) {
    assert.notEqual(waitingRoomHelpUrlIssue(value), null, `Core refuses: ${label}`);
    assert.equal(parseForcedVerificationDocument(withOverride(base, value)), null, `published override refuses: ${label}`);
    if (value !== null) assert.equal(parseForcedVerificationDocument(withDefault(base, value)), null, `published default refuses: ${label}`);
  }
});

test("help_url (Amendment v1.5): null or a well-formed https URL on the global default, a URL or absent on an override", () => {
  assert.equal(WAITING_ROOM_COMPILED_COPY.en.help_url, null, "the compiled default has no help button");
  assert.equal(WAITING_ROOM_COMPILED_COPY.hu.help_url, null);
  assert.equal(new TextEncoder().encode(HELP_URL_AT_LIMIT).length, WAITING_ROOM_HELP_URL_MAX_BYTES);
  const valid = withHelp(HELP_URL, { USA: { en: { help_url: `${HELP_PREFIX}us` }, hu: {} } });
  assert.deepEqual(parseForcedVerificationDocument(valid), valid, "a valid https URL parses on both levels");
  assert.deepEqual(parseForcedVerificationDocument(withHelp(null)), withHelp(null), "null on the global default is the explicit no-button form");
  const { help_url: _absent, ...withoutHelp } = valid.copy_default.en;
  const legacy = parseForcedVerificationDocument({ ...valid, copy_default: { ...valid.copy_default, en: withoutHelp } });
  assert.equal(legacy?.copy_default.en.help_url, null, "an absent help_url reads as null (the corpus before T-477)");
  assert.deepEqual(Object.keys(legacy!.copy_default.en), ["title", "subtitle", "description", "help_url"], "the parsed block always carries the key, last");
  assert.ok(parseForcedVerificationConsole(consolePayload({ ...withHelp(HELP_URL) })), "console material with a help URL");
  assert.ok(parseForcedVerificationSaved({ revision: 2, ...withHelp(HELP_URL) }), "save material with a help URL");
  assert.ok(parseForcedVerificationDocument(withDefault(valid, HELP_URL_AT_LIMIT)), "exactly 2048 bytes fits");
  assert.ok(parseForcedVerificationDocument(withDefault(valid, `${HELP_PREFIX}k%C3%A9rd%C3%A9s?x=1#top`)), "a percent-encoded non-ASCII path is kept raw, never re-serialised");
  assert.ok(parseForcedVerificationDocument(withOverride(valid, HELP_URL_AT_LIMIT)), "the byte limit is the same on an override");

  for (const [value, label] of [
    ["http://help.friending.com/", "http"],
    ["https:help.friending.com", "a form new URL() would repair"],
    ["https:///help.friending.com", "empty authority"],
    ["https://", "no authority"],
    ["javascript:alert(1)", "foreign scheme"],
    ["", "an empty string is not the null form"],
    [` ${HELP_URL}`, "a published untrimmed URL fails closed"],
    [`${HELP_URL}${LF}`, "trailing line break"],
    [`${HELP_URL_AT_LIMIT}a`, "2049 bytes"],
    [`${HELP_PREFIX}${"é".repeat(1011)}`, "2049 bytes of multibyte text (1038 code points)"],
    [`${HELP_PREFIX}${BEL}`, "C0 control"],
    [`${HELP_PREFIX}${NEL}`, "C1 control"],
    [`${HELP_PREFIX}${LONE_SURROGATE}`, "lone surrogate"],
    ["https://user:secret@help.friending.com/", "credentials"],
    ["https://user@help.friending.com/", "user-only credentials"],
    [`https://example.com${BACKSLASH}@evil.test/`, "credentials behind a backslash: PHP parse_url reads user example.com\\ at host evil.test (T-475 B11)"],
    [1, "number"],
    [true, "boolean"],
    [[HELP_URL], "array"],
  ] as const) {
    assert.equal(parseForcedVerificationDocument(withDefault(valid, value)), null, `global default: ${label}`);
    assert.equal(parseForcedVerificationDocument(withOverride(valid, value)), null, `override: ${label}`);
  }
  assert.equal(parseForcedVerificationDocument(withOverride(valid, null)), null, "an override inherits by omitting the key, never with null");
  assert.equal(parseForcedVerificationDocument({ ...valid, copy_overrides: { USA: { en: { help_url: `${HELP_PREFIX}us`, headline: "x" }, hu: {} } } }), null, "unknown key beside help_url");
  assert.equal(parseForcedVerificationDocument({ ...valid, copy_default: { ...valid.copy_default, en: { ...valid.copy_default.en, help: HELP_URL } } }), null, "a misspelt key is unknown, not the optional field");
});

test("help_url: draft round trip keeps null / URL / inherit and every refusal has a stable issue code", () => {
  const stored = withHelp(HELP_URL, { USA: { en: { help_url: `${HELP_PREFIX}us` }, hu: { title: "Cím" } } });
  const draft = forcedVerificationDraft(stored);
  assert.equal(draft.copy_default.en.help_url, HELP_URL);
  assert.equal(draft.copy_default.hu.help_url, "", "null edits as a blank field");
  assert.equal(draft.copy_overrides.USA?.en.help_url, `${HELP_PREFIX}us`);
  assert.equal(draft.copy_overrides.USA?.hu.help_url, "", "an absent override URL is a blank (inherit) field");
  const rebuilt = forcedVerificationDocumentFromDraft(draft);
  assert.deepEqual(rebuilt, stored, "round trip");
  assert.deepEqual(Object.keys(rebuilt!.copy_default.hu), ["title", "subtitle", "description", "help_url"], "the emitted block carries help_url last, the order Core compares");
  assert.equal(rebuilt!.copy_default.hu.help_url, null, "the global default always carries the key: null = no button");
  assert.ok(forcedVerificationDocumentsEqual(rebuilt!, stored));
  assert.deepEqual(waitingRoomCopyDraft(WAITING_ROOM_COMPILED_COPY.en), { ...WAITING_ROOM_COMPILED_COPY.en, help_url: "" });
  assert.deepEqual(emptyWaitingRoomCopyOverrideDraft().hu, { title: "", subtitle: "", description: "", help_url: "" });

  draft.copy_default.en.help_url = ` ${HELP_URL}`;
  assert.equal(validateForcedVerificationDraft(draft), "copyHelpUrlInvalid", "the URL validator never repairs a Core-invalid boundary space");
  assert.equal(forcedVerificationDocumentFromDraft(draft), null);
  draft.copy_default.en.help_url = "";
  assert.equal(forcedVerificationDocumentFromDraft(draft)?.copy_default.en.help_url, null, "a blank global URL is explicit null");
  draft.copy_overrides.USA!.en.help_url = "";
  assert.equal(Object.hasOwn(forcedVerificationDocumentFromDraft(draft)!.copy_overrides.USA!.en, "help_url"), false, "a blank override URL is an absent key (inherit)");
  draft.copy_overrides.USA!.hu.title = "";
  assert.deepEqual(Object.keys(forcedVerificationDocumentFromDraft(draft)!.copy_overrides), [], "an override that sets nothing at all is dropped whole");
  draft.copy_overrides.USA!.en.help_url = `${HELP_PREFIX}us`;
  assert.deepEqual(forcedVerificationDocumentFromDraft(draft)!.copy_overrides.USA, { en: { help_url: `${HELP_PREFIX}us` }, hu: {} }, "a URL-only override is a real override");

  assert.equal(waitingRoomHelpUrlIssue(""), "copyHelpUrlInvalid", "the strict URL validator mirrors Core; only the draft wrapper treats empty as absence");
  assert.equal(waitingRoomHelpUrlIssue(HELP_URL_AT_LIMIT), null, "exactly 2048 bytes fits");
  // T-475 B11: the credential span is PHP's authority — closed by `/`, `?` or `#` only — so an `@` past
  // any of those is path, query or fragment content for Core as well.
  for (const suffix of ["/@x", "/?@x", "/#@x", "?@x", "#@x"]) {
    assert.equal(waitingRoomHelpUrlIssue(`https://help.friending.com${suffix}`), null, `an @ after ${JSON.stringify(suffix[0])} is not a credential`);
  }
  assert.equal(waitingRoomHelpUrlByteLength(" https://é.example "), 20, "bytes of the raw value, not code points");
  for (const [value, issue] of [
    ["http://help.friending.com/", "copyHelpUrlInvalid"],
    ["help.friending.com", "copyHelpUrlInvalid"],
    ["https://", "copyHelpUrlInvalid"],
    [`https:${BACKSLASH}${BACKSLASH}help.friending.com`, "copyHelpUrlInvalid"],
    ["https:help.friending.com", "copyHelpUrlInvalid"],
    [`${HELP_URL_AT_LIMIT}a`, "copyHelpUrlTooLong"],
    [`${HELP_PREFIX}${"é".repeat(1011)}`, "copyHelpUrlTooLong"],
    [`${HELP_PREFIX}${BEL}`, "copyHelpUrlControl"],
    [`${HELP_PREFIX}a${TAB}b`, "copyHelpUrlControl"],
    [`${HELP_PREFIX}${NEL}`, "copyHelpUrlControl"],
    [`${HELP_PREFIX}${LONE_SURROGATE}`, "copyHelpUrlControl"],
    [`${HELP_PREFIX}súgó`, "copyHelpUrlInvalid"],
    [`${HELP_PREFIX}bad%zz`, "copyHelpUrlInvalid"],
    ["https://-help.friending.com/", "copyHelpUrlInvalid"],
    ["https://help.friending.com:65536/", "copyHelpUrlInvalid"],
    ["https://help.friending.com:0443/", "copyHelpUrlInvalid"],
    ["https://user:secret@help.friending.com/", "copyHelpUrlCredentials"],
    ["https://user@help.friending.com/", "copyHelpUrlCredentials"],
    ["https://@help.friending.com/", "copyHelpUrlCredentials"],
    [`https://example.com${BACKSLASH}@evil.test/`, "copyHelpUrlInvalid"],
  ] as const) {
    assert.equal(waitingRoomHelpUrlIssue(value), issue, JSON.stringify(value.slice(0, 40)));
    draft.copy_default.en.help_url = value;
    assert.equal(validateForcedVerificationDraft(draft), issue, `global: ${issue}`);
    assert.equal(forcedVerificationDocumentFromDraft(draft), null, "an invalid draft never becomes a document");
    draft.copy_default.en.help_url = "";
    draft.copy_overrides.USA!.hu.help_url = value;
    assert.equal(validateForcedVerificationDraft(draft), issue, `override: ${issue}`);
    draft.copy_overrides.USA!.hu.help_url = "";
  }
  assert.equal(validateForcedVerificationDraft(draft), null);
});

test("help_url: storefront inherit resolution and the preview's button-only-with-a-URL rule", () => {
  const stored = withHelp(HELP_URL, { DEU: { en: { title: "Verify" }, hu: {} }, USA: { en: { help_url: `${HELP_PREFIX}us` }, hu: {} } });
  assert.equal(resolveWaitingRoomCopy(stored, "USA", "en").help_url, `${HELP_PREFIX}us`, "an override URL wins");
  assert.equal(resolveWaitingRoomCopy(stored, "DEU", "en").help_url, HELP_URL, "an override without help_url inherits the global URL");
  assert.equal(resolveWaitingRoomCopy(stored, "FRA", "en").help_url, HELP_URL, "no override → global");
  assert.equal(resolveWaitingRoomCopy(stored, null, "en").help_url, HELP_URL, "unknown storefront → global");
  assert.equal(resolveWaitingRoomCopy(stored, "USA", "hu").help_url, null, "the English URL never leaks into Hungarian, whose default is null");
  assert.equal(resolveWaitingRoomCopy(withHelp(null), "USA", "en").help_url, null, "null everywhere → no button");

  const compiled = { en: { ...WAITING_ROOM_COMPILED_COPY.en }, hu: { ...WAITING_ROOM_COMPILED_COPY.hu } };
  const draft = forcedVerificationDraft(stored);
  assert.equal(previewWaitingRoomCopy(draft, "USA", "en", compiled).copy.help_url, `${HELP_PREFIX}us`);
  assert.equal(previewWaitingRoomCopy(draft, "DEU", "en", compiled).copy.help_url, HELP_URL);
  const none = previewWaitingRoomCopy(draft, null, "hu", compiled);
  assert.equal(none.copy.help_url, null, "no URL anywhere → no button");
  assert.deepEqual(none.compiledFields, [], "no button is a legitimate state, not a degraded field");
  draft.copy_overrides.USA!.en.help_url = ` ${HELP_PREFIX}us`;
  const untrimmed = previewWaitingRoomCopy(draft, "USA", "en", compiled);
  assert.equal(untrimmed.copy.help_url, null, "the preview never repairs a Core-invalid URL");
  assert.deepEqual(untrimmed.compiledFields, ["help_url"]);
  draft.copy_overrides.USA!.en.help_url = "http://help.friending.com/us";
  const degraded = previewWaitingRoomCopy(draft, "USA", "en", compiled);
  assert.equal(degraded.copy.help_url, null, "a malformed override URL degrades to no button — never to the global URL");
  assert.deepEqual(degraded.compiledFields, ["help_url"], "and is reported like a degraded text");
  draft.copy_overrides.USA!.en.help_url = "";
  draft.copy_default.en.help_url = "https://user:pw@help.friending.com/";
  const degradedDefault = previewWaitingRoomCopy(draft, "DEU", "en", compiled);
  assert.equal(degradedDefault.copy.help_url, null);
  assert.deepEqual(degradedDefault.compiledFields, ["help_url"]);
  assert.equal(degradedDefault.copy.title, "Verify", "the texts stand; copy is presentation only (Amendment v1.4)");
  draft.copy_default.hu.title = "x".repeat(61);
  assert.deepEqual(previewWaitingRoomCopy(draft, null, "hu", compiled).compiledFields, ["title"], "text and URL degradation are independent");
});

test("help_url: the proxy forwards null and https strings exactly, and the save binding sees a dropped URL as another document", () => {
  const valid = withHelp(HELP_URL, { USA: { en: { help_url: `${HELP_PREFIX}us` }, hu: {} } });
  const forwarded = normalizeForcedVerificationProxyBody("verification_forced_save", { expected_revision: 1, document: valid });
  assert.deepEqual(forwarded, { expected_revision: 1, document: valid });
  assert.deepEqual(
    Object.keys((forwarded as { document: ForcedVerificationDocument }).document.copy_default.en),
    ["title", "subtitle", "description", "help_url"],
    "the forwarded copy block keeps help_url last — Core compares the key list in order",
  );
  assert.deepEqual(normalizeForcedVerificationProxyBody("verification_forced_impact_preview", { document: withHelp(null) }), { document: withHelp(null) });
  for (const [help_url, label] of [
    ["http://help.friending.com/", "http"],
    ["", "empty string"],
    [1, "number"],
    [true, "boolean"],
    ["https://user:pw@help.friending.com/", "credentials"],
    [`https://example.com${BACKSLASH}@evil.test/`, "backslash is outside Core's ASCII URL character set"],
    [`${HELP_URL_AT_LIMIT}a`, "2049 bytes"],
  ] as const) {
    assert.equal(normalizeForcedVerificationProxyBody("verification_forced_save", { expected_revision: 1, document: withDefault(valid, help_url) }), null, `refused before Core: ${label}`);
    assert.equal(normalizeForcedVerificationProxyBody("verification_forced_save", { expected_revision: 1, document: withOverride(valid, help_url) }), null, `refused before Core on an override: ${label}`);
    assert.equal(normalizeForcedVerificationProxyBody("verification_forced_impact_preview", { document: withDefault(valid, help_url) }), null, `refused before Core on the preview: ${label}`);
  }
  assert.equal(normalizeForcedVerificationProxyBody("verification_forced_save", { expected_revision: 1, document: withOverride(valid, null) }), null, "null on an override is refused before Core");

  const submitted = { expected_revision: 1, document: valid };
  const adopted = decodeForcedSaveResponse(success({ revision: 2, ...valid }), submitted);
  assert.ok(adopted.ok && adopted.value.document.copy_default.en.help_url === HELP_URL && adopted.value.document.copy_overrides.USA?.en.help_url === `${HELP_PREFIX}us`);
  assert.deepEqual(decodeForcedSaveResponse(success({ revision: 2, ...withHelp(null, valid.copy_overrides) }), submitted), { ok: false, kind: "uncertain", error: "unbound-material" }, "an echo without the global URL is another document");
  const { help_url: _dropped, ...withoutHelp } = valid.copy_default.en;
  assert.deepEqual(
    decodeForcedSaveResponse(success({ revision: 2, ...valid, copy_default: { ...valid.copy_default, en: withoutHelp } }), submitted),
    { ok: false, kind: "uncertain", error: "unbound-material" },
    "an echo that drops the key reads as null and is not the submitted material",
  );
});
