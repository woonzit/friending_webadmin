import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { datesConfigurationRawValue, datesSettingEditable, datesSettingEffectiveText, datesSettingStorefrontEffective } from "../lib/datesAdmin.ts";
import { DATES_ADMIN_INTAKE_CONTRACT_SELECTOR, datesAdminContractParams, withDatesAdminContract } from "../lib/datesAdminContract.ts";
import { decodeDatesActivityList, decodeDatesActivityOriginDetail, decodeDatesExternalDetail, decodeDatesExternalList, decodeDatesExternalPlaces,
  decodeDatesExternalReceipt } from "../lib/datesExternalAdmin.ts";
import { datesCaseDetail, datesConsoleCommandReceipt, datesEvidenceRead, datesLegalHoldReceipt, datesModerationQueue } from "../lib/datesModerationRead.ts";
import { datesAdminReasons } from "../lib/datesReasons.ts";

// D-143 (team/DECISIONS.md): the compatibility check of every Admin hand-over.
//
// The released console (Webadmin 7825bc13, live with Core main 07215298) reads
// P1 Dates Admin bodies with exact key sets. Core's P2 adds keys to those
// bodies (`ai_assisted` on a list row, `intake` on a detail and on the event of
// an activity detail, more settings in the configuration read) - and, by
// D-143, serves the additions ONLY to a request that carries the Admin intake
// contract selector; a request without it is answered with bodies
// byte-identical to the released P1 corpus.
//
// So two things must hold at every hand-over, and both are executed here:
//
// 1. RELEASED console x SELECTOR-LESS bodies. The released console's own
//    production decoders are run on the bodies Core serves without the
//    selector. They are not re-stated: the nine decoder modules and the two
//    wire tests of 7825bc13 are vendored byte-identically (pinned below by
//    digest, verifiable against git objects with
//    team/reports/t865-p2-admin-opus/verify-released-console.mjs) and the wire
//    tests are run unchanged, in a tree of their own, on those bodies.
// 2. NEW console x LIVE P1 bodies. This console's decoders are run on the
//    released P1 corpus (what Core main serves today, and what any Core
//    serves to a request without the selector).
//
// Three fixture sets take part:
// - RELEASED_CORPUS: the P1 Admin corpus of Core main 07215298 - what the live
//   Core serves and what the released console was released against; vendored
//   as a second fixture set, pinned by its digests.
// - SELECTORLESS_BODIES: the provider's own capture of the P1 routes WITHOUT
//   the selector, at its pinned tip (tests/fixtures/dates_external_admin_wire).
//   D-143 requires it to be the released corpus, body for body; that is
//   asserted here, and the released console's tests are run on THESE bodies.
// - SELECTOR_BODIES: the same routes WITH the selector (and the `-released-
//   console` reads of an AI-assisted event without it), in the intake corpus.
const RELEASED_CORPUS = new URL("./fixtures/dates_external_admin_wire_released/", import.meta.url);
const SELECTORLESS_BODIES = new URL("./fixtures/dates_external_admin_wire/", import.meta.url);
const SELECTOR_BODIES = new URL("./fixtures/dates_event_intake_admin_wire/", import.meta.url);
const RELEASED_CONSOLE = new URL("./fixtures/released_console_7825bc13/", import.meta.url);

const RELEASED_CORPUS_PIN = { core: "0721529847602d4298f881119428f0e99eae9d53", source_commit: "c94d144691b93c3aea3dd180def345c4d03a4e55", count: 138,
  set: "d84a3e162703db1578db59f0a0a972de24fffc8562f23a13bf5715101306e4ed", manifest: "41bd137bb1bd37b1115f9f9dae201f43b5b6b10fb54159d796d36868a61246a9" };
/** Webadmin 7825bc13ec2ff03bc4775fbb6060390d61abd0cb, file by file (sha256 of the git blob's bytes). */
const RELEASED_CONSOLE_PIN: Record<string, string> = {
  "lib/datesAdmin.ts": "ae18db5d5b5597d91c0ce34f8c1b8a65427f6ab5d5d85ff02d7b3b12e23ecb40",
  "lib/datesExternalAdmin.ts": "95afc66ef1d748775d381ee67dedfd53edad1436f7a846216070bdbf91b7ee5e",
  "lib/datesExternalInput.ts": "6dfa8b918b80075344e2c8d0dabcbd33c830576e8426597f5cfcbff9753adce8",
  "lib/datesExternalMessageModeration.ts": "a1c0b08d4659b1d4c9a81d69b2e2da9bf33f72aa3c2e4c40ed4c5c8e44c42ab3",
  "lib/datesExternalModeration.ts": "076287e8f228136e597504ba72c6ac9923c37a45f34da5843d4010ddc7ac126e",
  "lib/datesExternalMutations.ts": "d1aa2657437a586594302de780c58d3f842f58a7e22bd1fc448e2750d4862e87",
  "lib/datesModerationRead.ts": "87cd85955d97d16e426a6ffd6a8bef111ce105bc5ee062d976f76a05726daa9c",
  "lib/datesReasons.ts": "b342b99624ff52b4ee2acea0955c174dea885139d1831744e6f76dd81c57e723",
  "lib/datesRuntimeHelp.ts": "4ad5826668c6f3135765fc21b332f5c241c5e2c61ce563e690b5545de1464c3c",
  "tests/datesExternalMessageWire.test.mts": "d6d8dd8d86e98ca32bbd4d79544319e1479227e35750ee4e43f8dc270156b732",
  "tests/datesExternalWire.test.mts": "fef0d01b5cc63c50e285a121420a47d171209577765227fe1c0646e2f2903925",
};
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const body = (directory: URL, file: string) => JSON.parse(readFileSync(new URL(file, directory), "utf8"));
const files = (directory: URL) => readdirSync(directory).filter((name) => name !== "manifest.json").sort();

// The P1 reads whose shape depends on the selector: 9 lists, 13 details, the external activity detail, 2 configuration reads.
const LISTS = ["admin-held-list.json", "admin-list-admin.json", "admin-list-canceled.json", "admin-list-viewer.json",
  ...["match", "pacific", "paid", "participation", "sensitive"].map((name) => `admin-variety-${name}-list.json`)];
const DETAILS = ["admin-detail-admin.json", "admin-detail-canceled.json", "admin-detail-estimated.json", "admin-detail-viewer.json",
  "admin-held-detail.json", "admin-held-detail-canceled.json", "admin-held-detail-reverified.json", "admin-held-detail-updated.json",
  ...["match", "pacific", "paid", "participation", "sensitive"].map((name) => `admin-variety-${name}-detail.json`)];
const ACTIVITY_DETAIL = "admin-activity-detail-external.json";
const CONFIGURATIONS = ["admin-configuration-default-off.json", "admin-configuration-publishing-on.json"];
const CAPABILITIES = ["dates_external_event_read", "dates_external_event_manage"];

test("D-143: the released P1 corpus (Core main 07215298) is vendored whole and pinned by its digests", () => {
  const raw = readFileSync(new URL("manifest.json", RELEASED_CORPUS)), manifest = JSON.parse(raw.toString());
  assert.equal(hash(raw), RELEASED_CORPUS_PIN.manifest);
  assert.equal(manifest.contract, "dates-external-admin-v1"); assert.equal(manifest.source_commit, RELEASED_CORPUS_PIN.source_commit);
  assert.equal(manifest.fixture_count, RELEASED_CORPUS_PIN.count); assert.equal(manifest.fixture_set_sha256, RELEASED_CORPUS_PIN.set);
  assert.deepEqual(files(RELEASED_CORPUS), manifest.fixtures.map((entry: { file: string }) => entry.file));
  const lines = manifest.fixtures.map((entry: { file: string; sha256: string }) => {
    assert.equal(hash(readFileSync(new URL(entry.file, RELEASED_CORPUS))), entry.sha256, entry.file);
    return `${entry.file}\0${entry.sha256}`;
  });
  assert.equal(hash(lines.join("\n")), RELEASED_CORPUS_PIN.set);
});

/**
 * T-891 (Core claude/core-hardening-20261002, 33265e46): a legal hold moves the case revision, and the P1 capture places
 * a hold on case 01 before resolving it and releases it afterwards. Four bodies of the provider's selector-less capture
 * therefore differ from main's, each in ONE revision value; the resolution request of that capture says
 * `expected_revision: 3` (tests/support/dates_external_console_capture.php:276 at 33265e46).
 */
const MOVED: Record<string, [string, number, number]> = {
  "admin-moderation-resolve.json": ["revision", 3, 4], "admin-moderation-resolve-replay.json": ["revision", 3, 4],
  "admin-moderation-detail-closed.json": ["case.revision", 3, 4], "admin-moderation-detail-purged.json": ["case.revision", 3, 5],
};

test("D-143 / T-891: what the provider serves WITHOUT the selector is the released corpus, body for body, but four revision values", () => {
  // The provider's selector-less capture at its pinned tip: 138 bodies, the same names as main's; 134 byte-identical, and
  // in the four others one revision value moved - no key, no other value. Only the manifest (the source binding) differs.
  const names = files(RELEASED_CORPUS);
  assert.deepEqual(files(SELECTORLESS_BODIES), names); assert.equal(names.length, 138);
  const differing = names.filter((name) => !readFileSync(new URL(name, SELECTORLESS_BODIES)).equals(readFileSync(new URL(name, RELEASED_CORPUS))));
  assert.deepEqual(differing, Object.keys(MOVED).sort());
  for (const [name, [path, before, after]] of Object.entries(MOVED)) {
    const now = body(SELECTORLESS_BODIES, name), then = body(RELEASED_CORPUS, name), keys = path.split(".");
    const parent = (value: any) => keys.slice(0, -1).reduce((node, key) => node[key], value);
    assert.deepEqual([parent(then)[keys.at(-1)!], parent(now)[keys.at(-1)!]], [before, after], name);
    parent(now)[keys.at(-1)!] = before; assert.deepEqual(now, then, name);
  }
  const provider = JSON.parse(readFileSync(new URL("manifest.json", SELECTORLESS_BODIES), "utf8"));
  assert.notEqual(provider.fixture_set_sha256, RELEASED_CORPUS_PIN.set); assert.notEqual(provider.source_commit, RELEASED_CORPUS_PIN.source_commit);
  assert.equal(provider.provenance.generator_sha256, body(RELEASED_CORPUS, "manifest.json").provenance.generator_sha256, "the same generator");
});

test("D-143: the released console's decoder modules and wire tests are vendored byte-identical to Webadmin 7825bc13", () => {
  const vendored = ["lib", "tests"].flatMap((directory) => readdirSync(new URL(`${directory}/`, RELEASED_CONSOLE)).map((name) => `${directory}/${name}`)).sort();
  assert.deepEqual(vendored, Object.keys(RELEASED_CONSOLE_PIN).map((name) => `${name}.txt`).sort());
  for (const [name, digest] of Object.entries(RELEASED_CONSOLE_PIN)) assert.equal(hash(readFileSync(new URL(`${name}.txt`, RELEASED_CONSOLE))), digest, name);
  // They are what the reviewer found: the released list row and detail are exact-key and know nothing of the P2 keys.
  const released = readFileSync(new URL("lib/datesExternalAdmin.ts.txt", RELEASED_CONSOLE), "utf8");
  assert.match(released, /record\(value\) && Object\.keys\(value\)\.length === Object\.keys\(shape\)\.length/);
  assert.doesNotMatch(released, /intake/); assert.match(released, /ai_assisted: literal\(false\)/);
});

/** The released console as a tree of its own: its modules under their real names, its tests, and the bodies to read. */
function releasedTree(bodies: URL, extra: Record<string, URL> = {}): { root: string; run: (...tests: string[]) => { status: number | null; output: string } } {
  const root = mkdtempSync(join(tmpdir(), "released-console-"));
  for (const name of Object.keys(RELEASED_CONSOLE_PIN)) {
    mkdirSync(join(root, name.split("/")[0]), { recursive: true });
    writeFileSync(join(root, name), readFileSync(new URL(`${name}.txt`, RELEASED_CONSOLE)));
  }
  const corpus = join(root, "tests", "fixtures", "dates_external_admin_wire");
  cpSync(fileURLToPath(bodies), corpus, { recursive: true });
  // The released wire test pins the manifest it was released with (its provenance); the BODIES are the ones under test.
  writeFileSync(join(corpus, "manifest.json"), readFileSync(new URL("manifest.json", RELEASED_CORPUS)));
  for (const [name, source] of Object.entries(extra)) writeFileSync(join(corpus, name), readFileSync(source));
  // `@/lib/...` resolves inside this tree: nothing of the current console is reachable from a released module.
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] }, module: "esnext",
    moduleResolution: "bundler", target: "es2022", allowImportingTsExtensions: true } }));
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", private: true }));
  const tsx = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
  return { root, run: (...tests) => {
    // A run of its own: not a child of this test run (no inherited runner context), with the reporter this file reads.
    const { NODE_TEST_CONTEXT: _context, ...env } = process.env;
    const result = spawnSync(process.execPath, [tsx, "--tsconfig", join(root, "tsconfig.json"), "--test", "--test-reporter=spec", "--test-timeout=120000", ...tests],
      { cwd: root, encoding: "utf8", timeout: 240_000, env });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  } };
}
const count = (output: string, label: string) => Number(new RegExp(`^ℹ ${label} (\\d+)$`, "m").exec(output)?.[1] ?? NaN);

test("D-143: the released console's own wire tests pass, unchanged, on the released corpus - and on the provider's capture but for what the tests themselves transcribe", () => {
  // On the corpus they were released with: every one of the 127.
  const released = releasedTree(RELEASED_CORPUS);
  try {
    const result = released.run("tests/datesExternalWire.test.mts", "tests/datesExternalMessageWire.test.mts");
    assert.equal(result.status, 0, result.output.slice(-2000));
    assert.equal(count(result.output, "tests"), 127); assert.equal(count(result.output, "pass"), 127); assert.equal(count(result.output, "fail"), 0);
    assert.equal(count(result.output, "skipped"), 0); assert.equal(count(result.output, "cancelled"), 0);
  } finally { rmSync(released.root, { recursive: true, force: true }); }
  // On the bodies the provider serves without the selector (T-891): 124 pass; the three that do not are named, and none
  // of them is a decoder refusing a body - the corpus pin compares digests, and the two resolution tests bind the receipt
  // to a request they transcribe with `expected_revision: 2`, which is no longer the capture's request.
  const provider = releasedTree(SELECTORLESS_BODIES);
  try {
    const result = provider.run("tests/datesExternalWire.test.mts", "tests/datesExternalMessageWire.test.mts");
    assert.equal(count(result.output, "tests"), 127); assert.equal(count(result.output, "pass"), 124); assert.equal(count(result.output, "fail"), 3);
    assert.equal(count(result.output, "skipped"), 0); assert.equal(count(result.output, "cancelled"), 0);
    const failing = [...new Set([...result.output.matchAll(/^✖ (.+?) \(\d[\d.]*ms\)$/gm)].map((match) => match[1]))].sort();
    assert.deepEqual(failing, ["external console corpus is the complete 138-response FINAL genuine capture with independent provenance pins",
      "genuine external resolve binds the independent case/content CAS and exact effect",
      "genuine external resolve-replay binds the independent case/content CAS and exact effect"]);
    // The released decoders themselves, on the four moved bodies, with the request the capture really sent.
    writeFileSync(join(provider.root, "tests", "probe.test.mts"), `
      import test from "node:test";
      import { readFileSync } from "node:fs";
      import { datesCaseDetail } from "../lib/datesModerationRead.ts";
      import { datesExternalResolutionReceipt, prepareDatesExternalResolution } from "../lib/datesExternalModeration.ts";
      const body = (name) => JSON.parse(readFileSync(new URL("./fixtures/dates_external_admin_wire/" + name, import.meta.url), "utf8"));
      const caseId = "cas_" + "01".padStart(32, "0");
      const pending = (expected) => prepareDatesExternalResolution("mod@example.test", { case_id: caseId, expected_revision: expected,
        expected_external_revision: 1, action: "remove_content", reason: "The public event details were reviewed.",
        user_visible_reason_en: "The event details have been reviewed.", user_visible_reason_hu: "Ellenőriztük az esemény adatait.",
        idempotency_key: "console-moderation-resolve", expires_at: null, break_glass: false }, {
        external_event_id: "xev_" + "04".padStart(32, "0"), activity_id: "act_" + "04".padStart(32, "0"), activity_revision: 1 }, 1790000000);
      test("probe", () => {
        const resolve = body("admin-moderation-resolve.json"), replay = body("admin-moderation-resolve-replay.json");
        const closed = body("admin-moderation-detail-closed.json"), purged = body("admin-moderation-detail-purged.json");
        console.log("PROBE " + JSON.stringify({
          resolve: JSON.stringify(datesExternalResolutionReceipt(resolve, pending(3))) === JSON.stringify(resolve),
          replay: JSON.stringify(datesExternalResolutionReceipt(replay, pending(3))) === JSON.stringify(replay),
          staleRequest: datesExternalResolutionReceipt(resolve, pending(2)) === null,
          closed: JSON.stringify(datesCaseDetail(closed, caseId)?.case) === JSON.stringify(closed.case),
          purged: JSON.stringify(datesCaseDetail(purged, caseId)?.case) === JSON.stringify(purged.case) }));
      });`);
    const probe = provider.run("tests/probe.test.mts");
    assert.equal(probe.status, 0, probe.output.slice(-2000));
    assert.deepEqual(JSON.parse(/PROBE (\{.*\})/.exec(probe.output)![1]), { resolve: true, replay: true, staleRequest: true, closed: true, purged: true });
  } finally { rmSync(provider.root, { recursive: true, force: true }); }
});

test("D-143 control: the same released decoders refuse the bodies Core serves WITH the selector - which is why the selector exists", () => {
  // Genuine bodies of the same routes with the selector (a manual event, so that only the added key differs), and the
  // three reads of an AI-assisted event as a request WITHOUT the selector is served them.
  const selector = (name: string) => new URL(name, SELECTOR_BODIES);
  const PROBED = ["admin-external-list-manual.json", "admin-external-detail-manual.json", "admin-activity-detail-ai-assisted.json",
    "admin-external-list-released-console.json", "admin-external-detail-released-console.json", "admin-activity-detail-released-console.json"];
  const tree = releasedTree(SELECTORLESS_BODIES, Object.fromEntries(PROBED.map((name) => [name, selector(name)])));
  try {
    // The reviewer's probe, kept: list, detail and activity detail through the released decoders.
    writeFileSync(join(tree.root, "tests", "probe.test.mts"), `
      import test from "node:test";
      import { readFileSync } from "node:fs";
      import { decodeDatesActivityOriginDetail, decodeDatesExternalDetail, decodeDatesExternalList } from "../lib/datesExternalAdmin.ts";
      const body = (name) => JSON.parse(readFileSync(new URL("./fixtures/dates_external_admin_wire/" + name, import.meta.url), "utf8"));
      const list = (name) => { const value = body(name); return decodeDatesExternalList(value, { page: value.page, limit: value.limit }) !== null; };
      const detail = (name) => { const value = body(name); return decodeDatesExternalDetail(value, value.event.external_event_id) !== null; };
      const activity = (name) => { const value = body(name); return decodeDatesActivityOriginDetail(value, value.activity.activity_id, ${JSON.stringify(CAPABILITIES)}) !== null; };
      test("probe", () => {
        console.log("PROBE " + JSON.stringify({
          selectorless: { list: list("admin-list-admin.json"), detail: detail("admin-detail-admin.json"), activity: activity("${ACTIVITY_DETAIL}") },
          selector: { list: list("admin-external-list-manual.json"), detail: detail("admin-external-detail-manual.json"), activity: activity("admin-activity-detail-ai-assisted.json") },
          assisted: { list: list("admin-external-list-released-console.json"), detail: detail("admin-external-detail-released-console.json"),
            activity: activity("admin-activity-detail-released-console.json") } }));
      });`);
    const probe = tree.run("tests/probe.test.mts");
    assert.equal(probe.status, 0, probe.output.slice(-2000));
    assert.deepEqual(JSON.parse(/PROBE (\{.*\})/.exec(probe.output)![1]), {
      // Without the selector: the released console reads every one of them.
      selectorless: { list: true, detail: true, activity: true },
      // With it: none. The released console never sends it, so it is never served these.
      selector: { list: false, detail: false, activity: false },
      // What the selector cannot cover: an AI-assisted event read WITHOUT the selector still says `ai_assisted: true` and has
      // a Places venue, which the released detail and activity decoders fix by literal. Its list row is the P1 row and
      // decodes. Hence the rule: the draft and suggestion switches are turned on only after the new console is live.
      assisted: { list: true, detail: false, activity: false },
    });
  } finally { rmSync(tree.root, { recursive: true, force: true }); }
});

test("D-143: this console decodes both shapes of every P1 read that depends on the selector, on genuine bodies", () => {
  // Without the selector: the 9 lists, 13 details, the external activity detail and the 2 configuration reads of the
  // P1 corpus (the released bodies). The other 113 bodies of that corpus do not depend on the selector and are decoded
  // by this suite's other tests from the same directory.
  for (const name of LISTS) {
    const value = body(SELECTORLESS_BODIES, name), decoded = decodeDatesExternalList(value, { page: value.page, limit: value.limit });
    assert.deepEqual(decoded, value, name); assert.ok(value.events.length > 0, name);
    // No label: absent reads as "not AI-assisted".
    for (const row of decoded!.events) { assert.equal(Object.hasOwn(row, "ai_assisted"), false, name); assert.equal(row.ai_assisted === true, false, name); }
  }
  for (const name of DETAILS) {
    const value = body(SELECTORLESS_BODIES, name), decoded = decodeDatesExternalDetail(value, value.event.external_event_id);
    assert.deepEqual(decoded, value, name);
    // No reference to an intake: no link back is shown.
    assert.equal(Object.hasOwn(decoded!.event, "intake"), false, name); assert.equal(decoded!.event.intake ?? null, null, name);
  }
  const activity = body(SELECTORLESS_BODIES, ACTIVITY_DETAIL), origin = decodeDatesActivityOriginDetail(activity, activity.activity.activity_id, CAPABILITIES);
  assert.deepEqual(origin, { activity: activity.activity, external: activity.external_event }); assert.equal(Object.hasOwn(origin!.external!, "intake"), false);
  const rows = (settings: Array<Record<string, unknown>>, label: string) => {
    for (const row of settings) {
      assert.equal(datesSettingEditable(row.type), true, `${label} ${row.key}`);
      assert.doesNotMatch(datesConfigurationRawValue(String(row.type), row.value), /object Object/, `${label} ${row.key}`);
      assert.notEqual(datesSettingEffectiveText(String(row.type), row.effective_value, { on: "ON", off: "OFF" }), "—", `${label} ${row.key}`);
      assert.notEqual(datesSettingStorefrontEffective(row).status, "invalid", `${label} ${row.key}`);
    }
  };
  for (const name of CONFIGURATIONS) { const settings = body(SELECTORLESS_BODIES, name).settings; assert.equal(settings.length, 33, name); rows(settings, name); }

  // With the selector (the intake corpus): the label and the reference are served.
  for (const [name, assisted] of [["admin-external-list-manual.json", false], ["admin-external-list-ai-assisted.json", true]] as const) {
    const value = body(SELECTOR_BODIES, name), decoded = decodeDatesExternalList(value, { page: value.page, limit: value.limit });
    assert.deepEqual(decoded, value, name); assert.deepEqual(decoded!.events.map((row) => row.ai_assisted), [assisted], name);
    assert.equal(Object.keys(value.events[0]).at(-1), "ai_assisted", name);
  }
  for (const [name, linked] of [["admin-external-detail-manual.json", false], ["admin-external-detail-ai-assisted.json", true]] as const) {
    const value = body(SELECTOR_BODIES, name), decoded = decodeDatesExternalDetail(value, value.event.external_event_id);
    assert.deepEqual(decoded, value, name); assert.equal(decoded!.event.intake !== null, linked, name); assert.equal(decoded!.event.ai_assisted, linked, name);
    assert.equal(Object.keys(value.event).at(-1), "intake", name);
  }
  const assisted = body(SELECTOR_BODIES, "admin-activity-detail-ai-assisted.json");
  assert.ok(decodeDatesActivityOriginDetail(assisted, assisted.activity.activity_id, CAPABILITIES)?.external?.intake);
  const fifty = body(SELECTOR_BODIES, "admin-configuration.json").settings; assert.equal(fifty.length, 50); rows(fifty, "admin-configuration");
  // The pairs Core captured both ways: each `-released-console` read is its selector sibling minus the one key - and this
  // console reads it (an AI-assisted event from a Core that is not sent the selector: labelled where Core says so, no link).
  for (const [without, withSelector, at] of [["admin-external-list-released-console.json", "admin-external-list-ai-assisted.json", "events.0.ai_assisted"],
    ["admin-external-detail-released-console.json", "admin-external-detail-ai-assisted.json", "event.intake"],
    ["admin-activity-detail-released-console.json", "admin-activity-detail-ai-assisted.json", "external_event.intake"]] as const) {
    const bare = body(SELECTOR_BODIES, without), full = structuredClone(body(SELECTOR_BODIES, withSelector)), path = at.split(".");
    delete path.slice(0, -1).reduce((node: any, key) => node[key], full)[path.at(-1)!];
    assert.deepEqual(bare, full, `${without} = ${withSelector} minus ${at}`);
  }
  const bareList = body(SELECTOR_BODIES, "admin-external-list-released-console.json"), bareDetail = body(SELECTOR_BODIES, "admin-external-detail-released-console.json");
  assert.deepEqual(decodeDatesExternalList(bareList, { page: bareList.page, limit: bareList.limit }), bareList);
  assert.deepEqual(decodeDatesExternalDetail(bareDetail, bareDetail.event.external_event_id), bareDetail);
  const bareActivity = body(SELECTOR_BODIES, "admin-activity-detail-released-console.json");
  assert.ok(decodeDatesActivityOriginDetail(bareActivity, bareActivity.activity.activity_id, CAPABILITIES));
  const thirtyThree = body(SELECTOR_BODIES, "admin-configuration-released-console.json").settings;
  assert.deepEqual(thirtyThree, fifty.slice(0, 33)); rows(thirtyThree, "admin-configuration-released-console");
});

test("D-143: the Admin intake contract selector is one constant, attached by the server to Dates Admin requests only", () => {
  // Until the Core lane announces the name there is nothing to send - and then nothing is sent, on any route.
  if (DATES_ADMIN_INTAKE_CONTRACT_SELECTOR === null) {
    for (const action of ["dates_external_event_list", "dates_event_intake_list", "dates_activity_detail", "users_list"]) assert.deepEqual(datesAdminContractParams(action), {});
  } else {
    const { parameter, value } = DATES_ADMIN_INTAKE_CONTRACT_SELECTOR;
    assert.match(parameter, /^[a-z][a-z0-9_]{2,63}$/);
    for (const action of ["dates_external_event_list", "dates_event_intake_list", "dates_activity_detail", "dates_configuration", "dates_moderation_queue"])
      assert.deepEqual(datesAdminContractParams(action), { [parameter]: value }, action);
    for (const action of ["users_list", "admin_me", "appearance_rules", "date", "dates"]) assert.deepEqual(datesAdminContractParams(action), {}, action);
  }
  // The rule itself, with a stand-in for the name Core has not announced yet: every Dates Admin route, and no other.
  const standIn = { parameter: "dates_event_intake_admin_contract_version", value: 1 };
  for (const action of ["dates_external_event_list", "dates_external_event_detail", "dates_activity_list", "dates_activity_detail", "dates_configuration",
    "dates_moderation_queue", "dates_event_intake_list", "dates_event_intake_create", "dates_event_intake_image", "dates_event_intake_ask_member"])
    assert.deepEqual(datesAdminContractParams(action, standIn), { dates_event_intake_admin_contract_version: 1 }, action);
  for (const action of ["users_list", "admin_me", "appearance_rules", "date", "dates", "dates_", "xdates_event_intake_list", "Dates_configuration", "dates_event-intake"])
    assert.deepEqual(datesAdminContractParams(action, standIn), {}, action);
  assert.deepEqual(datesAdminContractParams("dates_configuration", null), {});
  // Server-owned: merged after the browser's body in the generic bridge and in the two dedicated intake routes, so a browser cannot set or unset it.
  const route = readFileSync(new URL("../app/api/admin/[action]/route.ts", import.meta.url), "utf8");
  assert.match(route, /withDatesAdminContract\(action, mergeCoreParams\(body, \{ admin_email: session\.email \}\)\),/);
  // The selector is written last into the merged object itself: a browser value under its name does not survive, and
  // the null prototype of the merge is kept.
  // (`merged` stands for what `mergeCoreParams` returns: a null-prototype object with the browser's fields and the
  // actor; the real route, merge and encoder are run in tests/datesIntakeRequestShape.test.mts.)
  const merged: Record<string, unknown> = Object.assign(Object.create(null), { intake_id: "x", dates_event_intake_admin_contract_version: 99, admin_email: "admin@example.test" });
  const sent = withDatesAdminContract("dates_event_intake_list", merged, standIn);
  assert.equal(sent, merged); assert.equal(Object.getPrototypeOf(sent), null);
  assert.deepEqual({ ...sent }, { intake_id: "x", dates_event_intake_admin_contract_version: 1, admin_email: "admin@example.test" });
  assert.deepEqual({ ...withDatesAdminContract("users_list", Object.assign(Object.create(null), { q: "a", admin_email: "admin@example.test" }), standIn) },
    { q: "a", admin_email: "admin@example.test" });
  assert.deepEqual({ ...withDatesAdminContract("dates_configuration", Object.assign(Object.create(null), { admin_email: "admin@example.test" }), null) }, { admin_email: "admin@example.test" });
  const bridge = readFileSync(new URL("../lib/datesIntakeBridge.ts", import.meta.url), "utf8");
  assert.equal((bridge.match(/\.\.\.datesAdminContractParams\("dates_event_intake_(create|image)"\)/g) ?? []).length, 2);
});

// ---------------------------------------------------------------- no exact key set, per decoder

/**
 * Each P1 Dates decoder on a genuine body: `read` says whether it decodes.
 * `nested` names an object inside the body to widen as well; `binding` is a
 * path to a field the decoder binds on.
 */
const DECODERS: Array<{ name: string; file: string; read: (value: any) => boolean; nested: string[]; binding: string[] }> = [
  { name: "external list", file: "admin-list-admin.json", read: (v) => decodeDatesExternalList(v, { page: v.page, limit: v.limit }) !== null, nested: ["events", "0"], binding: ["events", "0", "revision"] },
  { name: "external detail", file: "admin-detail-admin.json", read: (v) => decodeDatesExternalDetail(v, v.event?.external_event_id) !== null, nested: ["event", "venue"], binding: ["event", "activity_revision"] },
  { name: "place search", file: "admin-places-available.json", read: (v) => decodeDatesExternalPlaces(v) !== null, nested: ["places", "0"], binding: ["places", "0", "place_id"] },
  { name: "activity list", file: "admin-activity-list-external.json", read: (v) => decodeDatesActivityList(v, { page: v.page, limit: v.limit }) !== null, nested: ["activities", "0"], binding: ["activities", "0", "revision"] },
  { name: "activity detail", file: ACTIVITY_DETAIL, read: (v) => decodeDatesActivityOriginDetail(v, v.activity?.activity_id, CAPABILITIES) !== null, nested: ["external_event"], binding: ["activity", "revision"] },
  { name: "publish receipt", file: "admin-publish.json", read: (v) => decodeDatesExternalReceipt(v, "dates_external_event_publish", {}, null) !== null, nested: [], binding: ["audit_id"] },
  { name: "case detail", file: "admin-moderation-detail-claimed.json", read: (v) => datesCaseDetail(v, v.case?.case_id) !== null, nested: ["case"], binding: ["case", "revision"] },
  { name: "case queue", file: "admin-moderation-queue.json", read: (v) => datesModerationQueue(v, { page: v.page, limit: v.limit }) !== null, nested: ["cases", "0"], binding: ["cases", "0", "revision"] },
  { name: "evidence read", file: "admin-moderation-evidence.json", read: (v) => datesEvidenceRead(v, { case_id: v.case_id, appeal_id: null, include_sensitive_location: false, break_glass: false }) !== null,
    nested: [], binding: ["audit_id"] },
  { name: "claim receipt", file: "admin-moderation-claim.json", read: (v) => datesConsoleCommandReceipt(v, "dates_moderation_claim", v.case_id, v.revision - 1) !== null, nested: [], binding: ["audit_id"] },
  { name: "legal hold receipt", file: "admin-moderation-hold-place.json", read: (v) => datesLegalHoldReceipt(v, v.case_id, "place", v.review_at), nested: [], binding: ["audit_id"] },
  { name: "reason catalogue", file: "admin-reason-list-external.json", read: (v) => datesAdminReasons(v, "all") !== null, nested: ["reasons", "0"], binding: ["reasons", "0", "revision"] },
];
const at = (value: any, path: string[]) => path.reduce((inner, key) => inner[key], value);

for (const decoder of DECODERS) test(`D-143 ${decoder.name}: a key this console does not know does not fail the decoder; a missing binding field does`, () => {
  for (const corpus of [RELEASED_CORPUS, SELECTORLESS_BODIES]) {
    const genuine = body(corpus, decoder.file);
    assert.equal(decoder.read(genuine), true, "the genuine body");
    // An unknown key at the top, and one inside.
    const wider = structuredClone(genuine); wider.future_key = { any: "thing" };
    if (decoder.nested.length > 0) at(wider, decoder.nested).future_key = "unknown";
    assert.equal(decoder.read(wider), true, "an added unknown key");
    // What the decoder binds on is still required.
    const missing = structuredClone(genuine); delete at(missing, decoder.binding.slice(0, -1))[decoder.binding.at(-1)!];
    assert.equal(decoder.read(missing), false, `without ${decoder.binding.join(".")}`);
    // ... and a refusal is still no success of it.
    assert.equal(decoder.read(body(corpus, "admin-unauthorized-denied.json")), false);
  }
});

test("D-143: no Dates decoder of a Core body counts keys; the only closed key sets left are the console's own requests and saved rows", () => {
  const exact = /Object\.keys\([a-zA-Z.]+\)\.length (===|!==)|Object\.keys\([a-zA-Z.]+\)\.sort\(\)\.join\(\)/;
  const allowed: Record<string, RegExp[]> = {
    // What the console SENDS: the event document of a publication or an update (the read of Core's editor seed passes `exact` false).
    "lib/datesExternalInput.ts": [/\(!exact \|\| Object\.keys\(value\)\.length === keys\.length\)/],
    // The console's own resolution request and its own saved row (`keys`); Core's receipts go through `fields`.
    "lib/datesExternalModeration.ts": [/^const keys = [^\n]*\n\s+&& Object\.keys\(v\)\.length === names\.length/m],
    "lib/datesExternalMessageModeration.ts": [/^const keys = [^\n]*\n\s+&& Object\.keys\(v\)\.length === names\.length/m],
    // The publication journal's own saved row in session storage.
    "lib/datesExternalMutations.ts": [/if \(Object\.keys\(row\)\.sort\(\)\.join\(\) !== \["version", "actor", "issued_at", "action", "body", "baseline"\]/],
    // The reload reminder's own two-field value in local storage.
    "lib/datesIntakeConsole.ts": [/return Object\.keys\(value\)\.length === 2 && typeof at === "number"/],
  };
  const libraries = readdirSync(new URL("../lib/", import.meta.url)).filter((name) => /^dates[A-Za-z]*\.ts$/.test(name)).map((name) => `lib/${name}`);
  assert.ok(libraries.length >= 12);
  for (const file of libraries) {
    let source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const pattern of allowed[file] ?? []) { assert.match(source, pattern, `${file}: the stated exception is there`); source = source.replace(pattern, ""); }
    assert.doesNotMatch(source, exact, file);
  }
  // In the two resolution modules every Core body goes through `fields`, and `keys` is left for the request and the saved row only.
  for (const file of ["lib/datesExternalModeration.ts", "lib/datesExternalMessageModeration.ts"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const exactUses = [...source.matchAll(/\bkeys\((\w+), \[([^\]]*)\]/g)].map((match) => match[2].split(",")[0].trim());
    assert.deepEqual(exactUses.sort(), ['"case_id"', '"version"', file.includes("Message") ? '"message_id"' : '"external_event_id"'].sort(), file);
  }
});
