import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import {
  ADMIN_ACTIONS,
  adminActionAccess,
  adminActionBodyLimit,
  isAdminActionAllowed,
  isAdminActionAuthorized,
} from "../lib/adminActions.ts";
import {
  SECTION_TEASERS_APP_CONTRACT_VERSION,
  SECTION_TEASERS_ACTIONS,
  SECTION_TEASERS_AUDIT_REASON_MAX,
  SECTION_TEASERS_COMPILED_COPY,
  SECTION_TEASERS_CONTRACT_VERSION,
  SECTION_TEASERS_CORE_EDIT_CAPABILITY,
  SECTION_TEASERS_CORE_READ_CAPABILITY,
  SECTION_TEASERS_DESCRIPTION_MAX,
  SECTION_TEASERS_ERROR_STATUSES,
  SECTION_TEASERS_FIELD_POINTERS,
  SECTION_TEASERS_TITLE_MAX,
  SECTION_TEASER_LANGUAGES,
  SECTION_TEASER_SECTIONS,
  normalizeSectionTeasersProxyBody,
  sectionTeaserCopyIsValid,
  sectionTeaserPreview,
  sectionTeasersAppBlock,
  sectionTeasersAuditReasonIsValid,
  sectionTeasersConflictResponse,
  sectionTeasersDraftAfterConflict,
  sectionTeasersDraftFrom,
  sectionTeasersDraftIssue,
  sectionTeasersError,
  sectionTeasersErrorKey,
  sectionTeasersFieldPointer,
  sectionTeasersMutationConverged,
  sectionTeasersMutationResponse,
  sectionTeasersSavePayload,
  sectionTeasersShouldRetainMutation,
  sectionTeasersStateConverged,
  sectionTeasersStateResponse,
  type SectionTeasersDraft,
  type SectionTeasersState,
} from "../lib/sectionTeasers.ts";
import SectionAvailabilityConfigurationCard from "../components/SectionAvailabilityConfigurationCard.tsx";
import { SectionTeaserControls } from "../components/SectionTeasersPanel.tsx";
import type { SectionAvailabilityConfiguration } from "../lib/sectionAvailability.ts";

/**
 * Core's production-generated wire corpus (`tests/fixtures/section_teasers_wire/`),
 * copied byte-identically from the Core commit that introduced it (T-722,
 * D-120). Every body came out of the production projection and the production
 * encoders, so this console's decoder is verified against what Core actually
 * publishes rather than against a reading of the contract.
 *
 * The corpus is deliberately not vacuous: it carries the bootstrapped singleton
 * (everything hidden, revision 0), an edited row beside a BLANK row that still
 * publishes, the compiled English and Hungarian modals, the storefront-on case
 * that never teases, and the whole refusal vocabulary with its field pointers.
 */
const FIXTURE_DIRECTORY = new URL("./fixtures/section_teasers_wire/", import.meta.url);
/** The Core tip this console was accepted against; the corpus commit is below. */
const FIXTURE_ACCEPTED_CORE_TIP = "a426ef4b4d1ea5855b487a393214de4bfa7476a2";
const FIXTURE_SOURCE_COMMIT = "75437c5798504f77249082e283e959f8079233da";
const FIXTURE_MANIFEST_SHA256 =
  "60f3f4ff0d2c759f059cf95efa3d48f17c781c629f25886fad4d74d2fce9d3e0";
const FIXTURE_SET_SHA256 =
  "1d863d45a2c7b30731984f9b9c16375837e499db1cc564e0f08025aef8842e4d";
const FIXTURE_CONTRACT_MANIFEST_SHA256 =
  "eb9dc908fd0f3d888716dd457f2a074a06d19383888ba250c28df30fb84fb939";
const FIXTURE_GENERATOR_SHA256 =
  "e5158e438352e8124d2d9339f382f7c18ede8f771b5f91cf38dc2be241380e1f";
const FIXTURE_BODY_COUNT = 34;

type Json = Record<string, any>;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fixture(file: string): Promise<Json> {
  return JSON.parse(await readFile(new URL(file, FIXTURE_DIRECTORY), "utf8"));
}

const messages = JSON.parse(readFileSync(
  new URL("../messages/en.json", import.meta.url),
  "utf8",
));

test("the published section-teaser corpus is byte-identical, complete and traceable to its Core source commit", async () => {
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
  assert.equal(published.contract_version, SECTION_TEASERS_CONTRACT_VERSION);
  assert.equal(published.app_contract_version, SECTION_TEASERS_APP_CONTRACT_VERSION);
  assert.equal(published.source_commit, FIXTURE_SOURCE_COMMIT);
  assert.equal(published.contract_manifest_sha256, FIXTURE_CONTRACT_MANIFEST_SHA256);
  assert.equal(published.fixture_set_sha256, FIXTURE_SET_SHA256);
  assert.equal(published.provenance.generator, "tests/section_teasers_fixture_dump.php");
  assert.equal(published.provenance.generator_sha256, FIXTURE_GENERATOR_SHA256);
  assert.equal(published.fixtures.length, FIXTURE_BODY_COUNT);
  assert.match(FIXTURE_ACCEPTED_CORE_TIP, /^[0-9a-f]{40}$/u);

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
    // Core joins `<file>\0<sha256>` lines with a newline
    // (`tests/section_teasers_fixture_dump.php:526`); the NUL is what makes the
    // pair unambiguous for a filename that could contain a space.
    lines.push(`${entry.file}\u0000${entry.sha256}`);
  }
  assert.equal(sha256(lines.join("\n")), FIXTURE_SET_SHA256, "the set hash must hold");
});

test("every published app-config body decodes into both sections, teased or null", async () => {
  for (const file of [
    "appconfig-available-never-teased.json",
    "appconfig-both-teased.json",
    "appconfig-compiled-all-hidden.json",
    "appconfig-dates-teased-en.json",
    "appconfig-dates-teased-hu.json",
    "appconfig-travel-teased.json",
  ]) {
    const body = await fixture(file);
    const block = sectionTeasersAppBlock(body.data.section_teasers);
    assert.ok(block, `${file} must decode`);
    assert.equal(block.contract_version, SECTION_TEASERS_APP_CONTRACT_VERSION);
    assert.deepEqual(Object.keys(block.teasers).sort(), [...SECTION_TEASER_SECTIONS].sort());
    for (const published of Object.values(block.teasers)) {
      // Core resolves the compiled fallback, so a published teaser is never
      // half a modal.
      if (published) {
        assert.notEqual(published.title, "");
        assert.notEqual(published.description, "");
      }
    }
  }
});

test("the deployment posture and the on-storefront case publish no teaser at all", async () => {
  for (const file of [
    "appconfig-compiled-all-hidden.json",
    "appconfig-available-never-teased.json",
  ]) {
    const block = sectionTeasersAppBlock((await fixture(file)).data.section_teasers);
    assert.ok(block);
    assert.equal(block.teasers.travel, null, `${file} must not tease travel`);
    assert.equal(block.teasers.dates, null, `${file} must not tease dates`);
  }
});

test("the compiled fallback this console previews is the copy Core actually publishes", async () => {
  const en = sectionTeasersAppBlock((await fixture("appconfig-dates-teased-en.json")).data.section_teasers);
  const hu = sectionTeasersAppBlock((await fixture("appconfig-dates-teased-hu.json")).data.section_teasers);
  assert.ok(en && hu);
  // Both bodies are the SAME stored row (blank copy) resolved in two languages,
  // which is the whole point of the preview: a blank field is not an empty
  // modal, it is this text.
  assert.deepEqual(en.teasers.dates, SECTION_TEASERS_COMPILED_COPY.en);
  assert.deepEqual(hu.teasers.dates, SECTION_TEASERS_COMPILED_COPY.hu);
  assert.notDeepEqual(en.teasers.dates, hu.teasers.dates);

  const blank: SectionTeasersDraft = {
    travel: { hidden: false, title: { en: "", hu: "" }, description: { en: "", hu: "" } },
    dates: { hidden: false, title: { en: "", hu: "" }, description: { en: "", hu: "" } },
  };
  assert.deepEqual(sectionTeaserPreview(blank.dates, "en"), SECTION_TEASERS_COMPILED_COPY.en);
  assert.deepEqual(sectionTeaserPreview(blank.dates, "hu"), SECTION_TEASERS_COMPILED_COPY.hu);
  // One filled leaf resolves independently of its sibling.
  const half = { ...blank.dates, title: { en: "Almost here", hu: "" } };
  assert.deepEqual(sectionTeaserPreview(half, "en"), {
    title: "Almost here",
    description: SECTION_TEASERS_COMPILED_COPY.en.description,
  });
});

test("authored copy reaches the member plane unchanged in both languages", async () => {
  const block = sectionTeasersAppBlock((await fixture("appconfig-both-teased.json")).data.section_teasers);
  const travel = sectionTeasersAppBlock((await fixture("appconfig-travel-teased.json")).data.section_teasers);
  assert.ok(block && travel);
  assert.equal(travel.teasers.travel?.title, "Travel is on its way");
  assert.equal(travel.teasers.dates, null, "the other section stays untouched");
  assert.equal(block.teasers.travel?.title, "Az utazás hamarosan indul");
  // The authored travel row and the compiled dates row travel in one body.
  assert.deepEqual(block.teasers.dates, SECTION_TEASERS_COMPILED_COPY.hu);
});

test("the console read and the save result decode through their own paths", async () => {
  const seeded = sectionTeasersStateResponse(await fixture("get-seeded.json"));
  assert.ok(seeded, "the bootstrapped read must decode");
  assert.equal(seeded.revision, 0, "an unsaved singleton reads revision 0");
  assert.equal(seeded.updated_by, "");
  assert.deepEqual(seeded.teasers.map((row) => row.key), [...SECTION_TEASER_SECTIONS]);
  assert.ok(seeded.teasers.every((row) => row.hidden),
    "the deployed posture is both sections fully hidden");

  const read = sectionTeasersStateResponse(await fixture("get-edited.json"));
  assert.ok(read);
  assert.equal(read.revision, 3);
  assert.equal(read.updated_by, "owner@friending.com");
  assert.equal(read.teasers[0].hidden, false);
  // A stored blank is served as a blank, never as the compiled copy: the
  // console must show the operator what is STORED.
  assert.deepEqual(read.teasers[1].title, { en: "", hu: "" });

  // A mutation body must never decode as a read: `no_change`/`replayed` select
  // the mutation variant.
  const saved = await fixture("save-committed.json");
  assert.equal(sectionTeasersStateResponse(saved), null, "a save body is not a read body");
  const mutation = sectionTeasersMutationResponse(saved);
  assert.ok(mutation);
  assert.equal(mutation.no_change, false);
  assert.equal(mutation.replayed, false);
  assert.deepEqual(mutation.teasers, read.teasers, "both carry the same projection");

  const noChange = sectionTeasersMutationResponse(await fixture("save-no-change.json"));
  assert.ok(noChange);
  assert.equal(noChange.no_change, true);
  assert.equal(noChange.revision, read.revision, "a no-op does not move the revision");

  const replayed = sectionTeasersMutationResponse(await fixture("save-replayed.json"));
  assert.ok(replayed);
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.no_change, false);
});

test("the conflict is the only refusal that carries state, and it rebases the draft", async () => {
  const body = await fixture("save-conflict.json");
  const conflict = sectionTeasersConflictResponse(body);
  assert.ok(conflict, "the conflict must decode");
  assert.equal(conflict.current.revision, 3);
  assert.deepEqual(conflict.current.teasers.map((row) => row.key), [...SECTION_TEASER_SECTIONS]);
  // The conflict is excluded from the plain error decoder so a malformed one
  // cannot drop the pending command.
  assert.equal(sectionTeasersError(body), null);

  const served = sectionTeasersStateResponse(await fixture("get-edited.json"));
  assert.ok(served);
  const requested = sectionTeasersSavePayload(
    sectionTeasersDraftFrom(served),
    2,
    "3f2b0a1c-9d64-4a1e-8b7f-5c2d0e6a4b19",
    "Announce the travel launch window",
  );
  assert.ok(requested);
  const rebased = sectionTeasersDraftAfterConflict(conflict, requested);
  assert.equal(rebased.state.revision, 3);
  assert.deepEqual(rebased.draft, sectionTeasersDraftFrom(conflict.current));
  assert.equal(rebased.satisfied, true,
    "this 409 already carries exactly the requested copy: the race applied it");

  const other = sectionTeasersSavePayload(
    { ...rebased.draft, dates: { ...rebased.draft.dates, hidden: true } },
    2,
    "3f2b0a1c-9d64-4a1e-8b7f-5c2d0e6a4b19",
    "Hide AreYouIn again",
  );
  assert.ok(other);
  assert.equal(sectionTeasersDraftAfterConflict(conflict, other).satisfied, false);
});

test("convergence accepts the exact no-op and the one-step transition and nothing else", async () => {
  const read = sectionTeasersStateResponse(await fixture("get-edited.json"));
  assert.ok(read);
  const payload = sectionTeasersSavePayload(
    sectionTeasersDraftFrom(read),
    2,
    "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e",
    "Publish the travel teaser",
  );
  assert.ok(payload);

  const committed = sectionTeasersMutationResponse(await fixture("save-committed.json"));
  const noChange = sectionTeasersMutationResponse(await fixture("save-no-change.json"));
  assert.ok(committed && noChange);
  assert.equal(sectionTeasersMutationConverged(payload, committed), true,
    "expected_revision 2 -> served revision 3 is the one-step transition");
  assert.equal(sectionTeasersMutationConverged(payload, noChange), false,
    "a no-op at a DIFFERENT revision is not this command's outcome");
  const atRest = sectionTeasersSavePayload(
    sectionTeasersDraftFrom(read),
    3,
    "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e",
    "Publish the travel teaser",
  );
  assert.ok(atRest);
  assert.equal(sectionTeasersMutationConverged(atRest, noChange), true);
  assert.equal(sectionTeasersStateConverged(payload, read), true,
    "a reload proving the copy at revision 3 clears the pending command");
  assert.equal(sectionTeasersStateConverged(payload, { ...read, revision: 9 }), false);
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
    assert.ok(Object.hasOwn(SECTION_TEASERS_ERROR_STATUSES, error),
      `${error} is served by Core but unknown to this console`);
    assert.equal(SECTION_TEASERS_ERROR_STATUSES[error], body.status_code,
      `${error} status disagrees with Core`);
    assert.equal(sectionTeasersError(body), error, `${file} must decode as a refusal`);
    assert.notEqual(sectionTeasersErrorKey(error), "generic",
      `${error} must map to console copy, not the fallback`);
    assert.ok(Object.hasOwn(messages.configuration.sectionAvailability.teaser.errors,
      sectionTeasersErrorKey(error)), `${error} needs a localized reason`);
    if (Object.hasOwn(body, "field")) {
      assert.equal(sectionTeasersFieldPointer(body), body.field,
        `${file} names a leaf this console does not render`);
      assert.ok(SECTION_TEASERS_FIELD_POINTERS.includes(String(body.field)));
    }
  }
});

test("a refusal whose status disagrees with Core is not believed", async () => {
  const body = await fixture("error-section-teasers-title-invalid.json");
  assert.equal(sectionTeasersError({ ...body, status_code: 409 }), null);
  assert.equal(sectionTeasersError({ ...body, error: "section-teasers-not-a-real-name" }), null);
  assert.equal(sectionTeasersFieldPointer({ ...body, field: "sections.travel.icon" }), null);
});

test("only an undecided outcome retains the command; a refused input re-mints", async () => {
  for (const error of [
    null,
    "section-teasers-request-in-progress",
    "section-teasers-write-failed",
    "section-teasers-receipt-write-failed",
    "not-a-known-name",
    // A timeout on a MUTATING call is the classic undecided outcome: the write
    // may have landed, so the same command is replayed rather than re-minted.
    "core-timeout",
  ]) {
    assert.equal(sectionTeasersShouldRetainMutation(error), true, `${error} is undecided`);
  }
  for (const error of [
    "section-teasers-title-invalid",
    "section-teasers-edit-required",
    "section-teasers-request-id-conflict",
    "section-teasers-audit-reason-invalid",
  ]) {
    assert.equal(sectionTeasersShouldRetainMutation(error), false, `${error} is decided`);
  }
});

test("Core's character rules are mirrored exactly, blank included", () => {
  const forty = "a".repeat(SECTION_TEASERS_TITLE_MAX);
  assert.equal(sectionTeaserCopyIsValid("", SECTION_TEASERS_TITLE_MAX), true,
    "the empty string is VALID and means the compiled copy");
  assert.equal(sectionTeaserCopyIsValid(forty, SECTION_TEASERS_TITLE_MAX), true);
  assert.equal(sectionTeaserCopyIsValid(`${forty}a`, SECTION_TEASERS_TITLE_MAX), false);
  assert.equal(sectionTeaserCopyIsValid("   ", SECTION_TEASERS_TITLE_MAX), false,
    "whitespace-only is refused, not treated as blank");
  assert.equal(sectionTeaserCopyIsValid(" Coming", SECTION_TEASERS_TITLE_MAX), false);
  assert.equal(sectionTeaserCopyIsValid("Coming\nsoon", SECTION_TEASERS_TITLE_MAX), false);
  assert.equal(sectionTeaserCopyIsValid(42, SECTION_TEASERS_TITLE_MAX), false);
  // CHARACTERS, not bytes: forty accented scalars fit, forty-one do not.
  assert.equal(sectionTeaserCopyIsValid("é".repeat(40), SECTION_TEASERS_TITLE_MAX), true);
  assert.equal(sectionTeaserCopyIsValid("é".repeat(41), SECTION_TEASERS_TITLE_MAX), false);
  assert.equal(sectionTeaserCopyIsValid("a".repeat(SECTION_TEASERS_DESCRIPTION_MAX),
    SECTION_TEASERS_DESCRIPTION_MAX), true);
  assert.equal(sectionTeaserCopyIsValid("a".repeat(SECTION_TEASERS_DESCRIPTION_MAX + 1),
    SECTION_TEASERS_DESCRIPTION_MAX), false);

  // The reason is the one bounded value where blank is NOT allowed.
  assert.equal(sectionTeasersAuditReasonIsValid(""), false);
  assert.equal(sectionTeasersAuditReasonIsValid("  "), false);
  assert.equal(sectionTeasersAuditReasonIsValid("Launch window announcement"), true);
  assert.equal(sectionTeasersAuditReasonIsValid("r".repeat(SECTION_TEASERS_AUDIT_REASON_MAX)), true);
  assert.equal(sectionTeasersAuditReasonIsValid("r".repeat(SECTION_TEASERS_AUDIT_REASON_MAX + 1)), false);
});

test("the draft issue names the first leaf Core would refuse", async () => {
  const read = sectionTeasersStateResponse(await fixture("get-edited.json"));
  assert.ok(read);
  const draft = sectionTeasersDraftFrom(read);
  assert.equal(sectionTeasersDraftIssue(draft), null, "a served draft is always sendable");
  assert.deepEqual(sectionTeasersDraftIssue({
    ...draft,
    dates: { ...draft.dates, description: { en: "d".repeat(401), hu: "" } },
  }), { section: "dates", issue: "description", language: "en" });
  assert.deepEqual(sectionTeasersDraftIssue({
    ...draft,
    travel: { ...draft.travel, title: { ...draft.travel.title, hu: "  " } },
  }), { section: "travel", issue: "title", language: "hu" });
});

test("the save payload is the exact command Core documented, rebuilt in section order", async () => {
  const read = sectionTeasersStateResponse(await fixture("get-edited.json"));
  assert.ok(read);
  const payload = sectionTeasersSavePayload(
    sectionTeasersDraftFrom(read),
    3,
    "7c9d1e2f-3a4b-4c5d-9e6f-708192a3b4c5",
    "Publish the travel teaser",
  );
  assert.ok(payload);
  assert.deepEqual(Object.keys(payload), [
    "contract_version", "sections", "expected_revision", "request_id", "audit_reason",
  ]);
  assert.deepEqual(Object.keys(payload.sections), [...SECTION_TEASER_SECTIONS]);
  for (const section of SECTION_TEASER_SECTIONS) {
    assert.deepEqual(Object.keys(payload.sections[section]), ["hidden", "title", "description"]);
    assert.equal(typeof payload.sections[section].hidden, "boolean",
      "hidden must stay a REAL boolean inside the JSON field");
    for (const slot of ["title", "description"] as const) {
      assert.deepEqual(Object.keys(payload.sections[section][slot]).sort(),
        [...SECTION_TEASER_LANGUAGES].sort());
    }
  }
  assert.equal(payload.sections.dates.title.en, "", "a stored blank is sent as a blank");

  assert.equal(sectionTeasersSavePayload(sectionTeasersDraftFrom(read), 3, "not-a-uuid", "why"), null);
  assert.equal(sectionTeasersSavePayload(sectionTeasersDraftFrom(read), -1,
    "7c9d1e2f-3a4b-4c5d-9e6f-708192a3b4c5", "why"), null);
  assert.equal(sectionTeasersSavePayload(sectionTeasersDraftFrom(read), 3,
    "7c9d1e2f-3a4b-4c5d-9e6f-708192a3b4c5", " "), null);
});

test("the proxy allow-list normalizes both actions and refuses everything undeclared", () => {
  for (const action of SECTION_TEASERS_ACTIONS) {
    assert.ok(isAdminActionAllowed(action), `${action} must be allow-listed`);
    assert.ok((ADMIN_ACTIONS as readonly string[]).includes(action));
  }
  assert.equal(adminActionAccess("section_teasers_get"), "read");
  assert.equal(adminActionAccess("save_section_teasers"), "write");
  // The independent global floor: Core still checks its own two capability
  // names, which `admin_me` does not advertise.
  assert.equal(SECTION_TEASERS_CORE_READ_CAPABILITY, "section_teasers_read");
  assert.equal(SECTION_TEASERS_CORE_EDIT_CAPABILITY, "section_teasers_edit");
  for (const role of ["owner", "admin"]) {
    assert.equal(isAdminActionAuthorized("save_section_teasers", { role, datesRole: "" }), true);
  }
  for (const role of ["viewer", "", "support_viewer"]) {
    assert.equal(isAdminActionAuthorized("save_section_teasers", { role, datesRole: "" }), false,
      `${role || "(none)"} must not be able to save teaser copy`);
    assert.equal(isAdminActionAuthorized("section_teasers_get", { role, datesRole: "" }), true);
  }
  // The command is small; it keeps the default per-action ceiling.
  assert.equal(adminActionBodyLimit("save_section_teasers"), 256_000);

  assert.equal(normalizeSectionTeasersProxyBody("mode_cards_get", {}), undefined,
    "another family is not this normalizer's business");
  // Spread first: the normalizer builds a NULL-prototype object so a body may
  // not smuggle `__proto__` through the bridge.
  assert.deepEqual(
    { ...normalizeSectionTeasersProxyBody("section_teasers_get", { contract_version: 1 }) },
    { contract_version: 1 },
  );
  assert.equal(
    normalizeSectionTeasersProxyBody("section_teasers_get", { contract_version: 1, extra: 1 }),
    null,
    "an undeclared field never reaches Core",
  );
  assert.equal(normalizeSectionTeasersProxyBody("section_teasers_get", {}), null);

  const command = {
    contract_version: 1,
    sections: {
      travel: { hidden: false, title: { en: "A", hu: "B" }, description: { en: "C", hu: "D" } },
      dates: { hidden: true, title: { en: "", hu: "" }, description: { en: "", hu: "" } },
    },
    expected_revision: 3,
    request_id: "7c9d1e2f-3a4b-4c5d-9e6f-708192a3b4c5",
    audit_reason: "Publish the travel teaser",
  };
  assert.ok(normalizeSectionTeasersProxyBody("save_section_teasers", command));
  for (const broken of [
    { ...command, sections: { travel: command.sections.travel } },
    { ...command, sections: { ...command.sections, people: command.sections.dates } },
    { ...command, sections: { ...command.sections, dates: { ...command.sections.dates, hidden: "1" } } },
    { ...command, sections: { ...command.sections, dates: { hidden: true, title: { en: "", hu: "" } } } },
    { ...command, expected_revision: 1.5 },
    { ...command, request_id: "7C9D1E2F-3A4B-4C5D-9E6F-708192A3B4C5" },
    { ...command, audit_reason: "" },
    { ...command, admin_email: "someone@friending.com" },
  ]) {
    assert.equal(normalizeSectionTeasersProxyBody("save_section_teasers", broken as never), null,
      `a malformed command must be refused at the proxy: ${JSON.stringify(broken).slice(0, 60)}`);
  }
});

test("a partial or foreign body never becomes a proven teaser state", async () => {
  const read = await fixture("get-edited.json");
  for (const broken of [
    { ...read, data: { ...read.data, contract_version: 2 } },
    { ...read, data: { ...read.data, teasers: read.data.teasers.slice(0, 1) } },
    { ...read, data: { ...read.data, teasers: [read.data.teasers[1], read.data.teasers[0]] } },
    { ...read, data: { ...read.data, revision: -1 } },
    { ...read, data: { ...read.data, teasers: [
      { ...read.data.teasers[0], hidden: "false" },
      read.data.teasers[1],
    ] } },
    { ...read, data: { ...read.data, teasers: [
      { ...read.data.teasers[0], extra: true },
      read.data.teasers[1],
    ] } },
    { ...read, status_code: 201 },
  ]) {
    assert.equal(sectionTeasersStateResponse(broken), null,
      "a malformed read must fail closed, never render as a blank teaser");
  }
  assert.equal(sectionTeasersAppBlock({ contract_version: 1, teasers: { travel: null } }), null);
  assert.equal(sectionTeasersAppBlock({
    contract_version: 1,
    teasers: { travel: { title: "", description: "x" }, dates: null },
  }), null, "a published teaser with a blank leaf is a provider defect, not a modal");
});

// ------------------------------------------------------------ the rendering

function availability(enabled: boolean): SectionAvailabilityConfiguration {
  const control = {
    enabled,
    overrides: [],
    invalidCodes: [],
    enabledUpdatedAt: 1_787_800_000,
    enabledUpdatedBy: "owner@friending.com",
    overridesUpdatedAt: 1_787_800_000,
    overridesUpdatedBy: "owner@friending.com",
  };
  return {
    travel: { ...control },
    dates: { ...control },
    vocabulary: { storefronts: [], callingCodes: [], regions: [] },
    revision: 7,
  };
}

function renderCard(enabled = false): string {
  return renderToStaticMarkup(createElement(
    NextIntlClientProvider,
    { locale: "en", messages, timeZone: "UTC" },
    createElement(SectionAvailabilityConfigurationCard, {
      value: availability(enabled),
      busy: false,
      conflictRevision: null,
      onSave() {},
      onChange() {},
    }),
  ));
}

test("the card mounts one teaser block per section and its own save row", () => {
  const html = renderCard();
  for (const section of SECTION_TEASER_SECTIONS) {
    assert.match(html, new RegExp(`data-section-teaser="${section}"`),
      `${section} must carry the teaser block under its global switch`);
  }
  // Before the console read lands, the block says so instead of rendering two
  // blank teasers that nobody stored.
  assert.match(html, /Loading teaser copy…/);
  assert.doesNotMatch(html, /section-teaser-reason/,
    "no reason field and no save button until the authoritative read arrives");
  // The teaser toggle lives in its own module so the availability card keeps
  // exactly one global switch source.
  const card = String(renderCard(true));
  assert.equal(card.match(/switch-track/g)?.length, 2, "one global switch per section");
});

/**
 * The per-section states the owner asked for, rendered from a served state
 * rather than from an invented one. `renderToStaticMarkup` runs no effect, so
 * the panel is exercised through its pure props exactly as `ModeCardsEditor` is.
 */
function renderControls(state: SectionTeasersState, sectionEnabled: boolean): string {
  const draft = sectionTeasersDraftFrom(state);
  return renderToStaticMarkup(createElement(
    NextIntlClientProvider,
    { locale: "en", messages, timeZone: "UTC" },
    createElement(SectionTeaserControls, {
      section: "travel",
      sectionEnabled,
      disabled: false,
      teasers: {
        state: "ready",
        draft,
        current: state,
        notice: null,
        invalidField: null,
        auditReason: "",
        busy: false,
        pending: false,
        setAuditReason() {},
        patch() {},
        save() {},
        reload() {},
      },
    }),
  ));
}

test("a hidden section renders no copy fields, an un-hidden one renders both languages and the preview", async () => {
  const seeded = sectionTeasersStateResponse(await fixture("get-seeded.json"));
  const edited = sectionTeasersStateResponse(await fixture("get-edited.json"));
  assert.ok(seeded && edited);

  const hidden = renderControls(seeded, false);
  assert.match(hidden, /Hidden when off/);
  assert.match(hidden, /Fully hidden when off/);
  assert.doesNotMatch(hidden, /section-teaser-travel-title-en/,
    "a fully hidden section has nothing to author");

  const teased = renderControls(edited, false);
  assert.match(teased, /id="section-teaser-travel-title-en"/);
  assert.match(teased, /id="section-teaser-travel-title-hu"/);
  assert.match(teased, /id="section-teaser-travel-description-en"/);
  assert.match(teased, /id="section-teaser-travel-description-hu"/);
  assert.match(teased, /20\/40 characters/, "the title counter counts characters");
  assert.match(teased, /What members see in the modal/);
  assert.match(teased, /data-teaser-preview="travel-en"/);
  assert.match(teased, /data-teaser-preview="travel-hu"/);
  assert.match(teased, /Travel is on its way/);
  assert.match(teased, /Az utazás hamarosan indul/);

  // A section that is still AVAILABLE says the copy is stored but not published.
  const available = renderControls(edited, true);
  assert.match(available, /no teaser is published/);
  assert.doesNotMatch(teased, /no teaser is published/);
});

test("a blank stored row previews Core's compiled copy rather than an empty modal", async () => {
  const edited = sectionTeasersStateResponse(await fixture("get-edited.json"));
  assert.ok(edited);
  // `dates` is the blank row in this body; render it through the same block.
  const html = renderToStaticMarkup(createElement(
    NextIntlClientProvider,
    { locale: "en", messages, timeZone: "UTC" },
    createElement(SectionTeaserControls, {
      section: "dates",
      sectionEnabled: false,
      disabled: false,
      teasers: {
        state: "ready",
        draft: sectionTeasersDraftFrom(edited),
        current: edited,
        notice: null,
        invalidField: null,
        auditReason: "",
        busy: false,
        pending: false,
        setAuditReason() {},
        patch() {},
        save() {},
        reload() {},
      },
    }),
  ));
  assert.match(html, /0\/40 characters/);
  assert.match(html, new RegExp(SECTION_TEASERS_COMPILED_COPY.en.title));
  assert.match(html, new RegExp(SECTION_TEASERS_COMPILED_COPY.hu.title));
  assert.match(html, /compiled copy/);
});

test("the teaser copy tree is complete and identical in English and Hungarian", async () => {
  const [en, hu] = await Promise.all(["en", "hu"].map(async (locale) => JSON.parse(
    await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"),
  )));

  function keyTree(value: unknown): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, keyTree(child)]));
  }
  const enTeaser = en.configuration.sectionAvailability.teaser;
  const huTeaser = hu.configuration.sectionAvailability.teaser;
  assert.deepEqual(keyTree(enTeaser), keyTree(huTeaser));
  // The owner asked for these Hungarian words by name.
  assert.equal(huTeaser.hiddenTitle, "Rejtett kikapcsolva");
  assert.equal(huTeaser.fields.title, "Cím");
  assert.equal(huTeaser.fields.description, "Leírás");
  assert.equal(SECTION_TEASERS_COMPILED_COPY.hu.title, "Hamarosan");
  for (const language of SECTION_TEASER_LANGUAGES) {
    assert.ok(enTeaser.languages[language], "both language labels must exist");
  }
  // Every console reason key the mapper can produce has copy in both locales.
  for (const key of Object.keys(enTeaser.errors)) {
    assert.equal(typeof huTeaser.errors[key], "string");
  }
  assert.ok(Object.hasOwn(enTeaser.errors, sectionTeasersErrorKey("not-a-core-name")));

  // The page help census documents the control the owner will actually use.
  for (const messagesFor of [en, hu]) {
    const help = messagesFor.adminHelp.pages.configuration.sections.sectionTeasers;
    assert.ok(help, "the /configuration guide must inventory the soft-off teaser");
    assert.ok(Object.keys(help.actions).length >= 2);
  }
});
