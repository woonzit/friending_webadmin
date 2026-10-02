import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { datesConfigurationRawValue, datesSettingEditable, datesSettingEffectiveText, datesSettingStorefrontEffective } from "../lib/datesAdmin.ts";
import { DATES_ADMIN_INTAKE_CONTRACT_SELECTOR, datesAdminContractParams } from "../lib/datesAdminContract.ts";
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
// The selector-less bodies are the released P1 corpus by definition (Core's
// gate proves the byte identity on its side). It is vendored here as a second
// fixture set from Core main 07215298, pinned by its digests.
const RELEASED_CORPUS = new URL("./fixtures/dates_external_admin_wire_released/", import.meta.url);
const NEW_CORPUS = new URL("./fixtures/dates_external_admin_wire/", import.meta.url);
const RELEASED_CONSOLE = new URL("./fixtures/released_console_7825bc13/", import.meta.url);
/** What a request without the selector is answered with. One constant: when the provider ships its own capture of them, point it there. */
const SELECTORLESS_BODIES = RELEASED_CORPUS;

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

// The 25 bodies of the P1 routes that differ between the two corpora, each in one stated way.
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
  // The same routes, body for body, as the corpus of the new Core.
  assert.deepEqual(files(RELEASED_CORPUS), files(NEW_CORPUS));
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
function releasedTree(bodies: URL): { root: string; run: (...tests: string[]) => { status: number | null; output: string } } {
  const root = mkdtempSync(join(tmpdir(), "released-console-"));
  for (const name of Object.keys(RELEASED_CONSOLE_PIN)) {
    mkdirSync(join(root, name.split("/")[0]), { recursive: true });
    writeFileSync(join(root, name), readFileSync(new URL(`${name}.txt`, RELEASED_CONSOLE)));
  }
  cpSync(fileURLToPath(bodies), join(root, "tests", "fixtures", "dates_external_admin_wire"), { recursive: true });
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

test("D-143: the released console's own wire tests pass, unchanged, on the bodies Core serves without the selector", () => {
  const tree = releasedTree(SELECTORLESS_BODIES);
  try {
    const result = tree.run("tests/datesExternalWire.test.mts", "tests/datesExternalMessageWire.test.mts");
    assert.equal(result.status, 0, result.output.slice(-2000));
    // Every released decoder of the corpus, with the requests and baselines the released tests bind them to.
    assert.equal(count(result.output, "tests"), 127); assert.equal(count(result.output, "pass"), 127); assert.equal(count(result.output, "fail"), 0);
    assert.equal(count(result.output, "skipped"), 0); assert.equal(count(result.output, "cancelled"), 0);
  } finally { rmSync(tree.root, { recursive: true, force: true }); }
});

test("D-143 control: the same released decoders refuse the bodies Core serves WITH the selector - which is why the selector exists", () => {
  const tree = releasedTree(NEW_CORPUS);
  try {
    // The reviewer's probe, kept: list, detail and the external activity detail of the new corpus through the released decoders.
    writeFileSync(join(tree.root, "tests", "probe.test.mts"), `
      import test from "node:test";
      import { readFileSync } from "node:fs";
      import { decodeDatesActivityOriginDetail, decodeDatesExternalDetail, decodeDatesExternalList } from "../lib/datesExternalAdmin.ts";
      const body = (name) => JSON.parse(readFileSync(new URL("./fixtures/dates_external_admin_wire/" + name, import.meta.url), "utf8"));
      test("probe", () => {
        const list = body("admin-list-admin.json"), detail = body("admin-detail-admin.json"), activity = body("${ACTIVITY_DETAIL}");
        console.log("PROBE " + JSON.stringify({ list: decodeDatesExternalList(list, { page: list.page, limit: list.limit }) !== null,
          detail: decodeDatesExternalDetail(detail, detail.event.external_event_id) !== null,
          activity: decodeDatesActivityOriginDetail(activity, activity.activity.activity_id, ${JSON.stringify(CAPABILITIES)}) !== null }));
      });`);
    const probe = tree.run("tests/probe.test.mts");
    assert.equal(probe.status, 0, probe.output.slice(-2000));
    assert.deepEqual(JSON.parse(/PROBE (\{.*\})/.exec(probe.output)![1]), { list: false, detail: false, activity: false });
    // And the released wire tests, on those bodies, do not pass: the check above is not one that cannot fail.
    const wire = tree.run("tests/datesExternalWire.test.mts");
    assert.notEqual(wire.status, 0); assert.ok(count(wire.output, "fail") > 0);
  } finally { rmSync(tree.root, { recursive: true, force: true }); }
});

test("D-143: this console decodes the released P1 corpus - 113 bodies are the very bytes its other tests decode, the 25 that differ decode here", () => {
  const names = files(RELEASED_CORPUS);
  const differing = names.filter((name) => !readFileSync(new URL(name, RELEASED_CORPUS)).equals(readFileSync(new URL(name, NEW_CORPUS))));
  assert.deepEqual(differing, [...LISTS, ...DETAILS, ACTIVITY_DETAIL, ...CONFIGURATIONS].sort());
  assert.equal(names.length - differing.length, 113);
  for (const corpus of [RELEASED_CORPUS, NEW_CORPUS]) {
    const served = corpus === NEW_CORPUS;
    for (const name of LISTS) {
      const value = body(corpus, name), decoded = decodeDatesExternalList(value, { page: value.page, limit: value.limit });
      assert.deepEqual(decoded, value, name); assert.ok(value.events.length > 0, name);
      // The label: served with the selector, absent without it - and absent reads as "not AI-assisted".
      for (const row of decoded!.events) { assert.equal(Object.hasOwn(row, "ai_assisted"), served, name); assert.equal(row.ai_assisted === true, false, name); }
    }
    for (const name of DETAILS) {
      const value = body(corpus, name), decoded = decodeDatesExternalDetail(value, value.event.external_event_id);
      assert.deepEqual(decoded, value, name);
      // The intake reference: served (null for these manual events) with the selector, absent without it; either way no link back.
      assert.equal(Object.hasOwn(decoded!.event, "intake"), served, name); assert.equal(decoded!.event.intake ?? null, null, name);
      assert.equal(decoded!.event.ai_assisted, false, name);
    }
    const activity = body(corpus, ACTIVITY_DETAIL), origin = decodeDatesActivityOriginDetail(activity, activity.activity.activity_id, CAPABILITIES);
    assert.deepEqual(origin, { activity: activity.activity, external: activity.external_event });
    assert.equal(Object.hasOwn(origin!.external!, "intake"), served);
    for (const name of CONFIGURATIONS) {
      const settings = body(corpus, name).settings as Array<Record<string, unknown>>;
      // 33 rows from a Core that does not know the selector (or is not sent it), 50 with it; the page lists what is served.
      assert.equal(settings.length, served ? 50 : 33, name);
      for (const row of settings) {
        assert.equal(datesSettingEditable(row.type), true, `${name} ${row.key}`);
        assert.doesNotMatch(datesConfigurationRawValue(String(row.type), row.value), /object Object/, `${name} ${row.key}`);
        assert.notEqual(datesSettingEffectiveText(String(row.type), row.effective_value, { on: "ON", off: "OFF" }), "—", `${name} ${row.key}`);
        assert.notEqual(datesSettingStorefrontEffective(row).status, "invalid", `${name} ${row.key}`);
      }
    }
  }
  // The released rows are the new rows without the one added key - nothing else was changed for the selector-less shape.
  for (const name of LISTS) {
    const released = body(RELEASED_CORPUS, name), added = body(NEW_CORPUS, name);
    assert.deepEqual(added.events.map(({ ai_assisted: _label, ...row }: Record<string, unknown>) => row), released.events, name);
  }
  for (const name of DETAILS) {
    const { intake: _intake, ...event } = body(NEW_CORPUS, name).event;
    assert.deepEqual(event, body(RELEASED_CORPUS, name).event, name);
  }
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
  assert.match(route, /mergeCoreParams\([^)]*\{ admin_email: [^}]*\.\.\.datesAdminContractParams\(action\) \}\)/s);
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
  for (const corpus of [RELEASED_CORPUS, NEW_CORPUS]) {
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
