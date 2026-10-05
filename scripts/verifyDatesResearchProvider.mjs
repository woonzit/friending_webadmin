import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Read-only proof against immutable Core Git objects, never its worktree.
// PIN.json is an independent consumer pin transcribed from the provider
// hand-over and Git objects; it is not the manifest being verified.
// node scripts/verifyDatesResearchProvider.mjs CORE_REPO ADMIN_TREE PIN.json
const [coreRepo, adminTree, pinPath] = process.argv.slice(2);
assert.ok(coreRepo && adminTree && pinPath, "Usage: verifyDatesResearchProvider.mjs CORE_REPO ADMIN_TREE PIN.json");
const pin = JSON.parse(readFileSync(pinPath, "utf8"));
for (const field of ["provider_commit", "source_commit", "manifest_sha256", "source_checksum", "fixture_set_sha256", "generator_sha256"]) assert.match(pin[field], /^[a-f0-9]+$/, field);
assert.match(pin.provider_commit, /^[a-f0-9]{40}$/); assert.match(pin.source_commit, /^[a-f0-9]{40}$/);
const directory = "tests/fixtures/dates_event_research_admin_wire";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", ["-C", coreRepo, ...args], { maxBuffer: 64 * 1024 * 1024 });
const blob = (revision, path) => git("show", `${revision}:${path}`);
git("merge-base", "--is-ancestor", pin.source_commit, pin.provider_commit);
const bytes = blob(pin.provider_commit, `${directory}/manifest.json`), manifest = JSON.parse(bytes);
assert.equal(digest(bytes), pin.manifest_sha256, "independently pinned manifest bytes");
assert.equal(manifest.schema_version, 1); assert.equal(manifest.contract, pin.contract);
assert.equal(manifest.source_commit, pin.source_commit); assert.equal(manifest.source_checksum, pin.source_checksum);
assert.equal(manifest.fixture_set_sha256, pin.fixture_set_sha256); assert.equal(manifest.fixture_count, pin.fixture_count);
assert.equal(manifest.fixtures.length, pin.fixture_count);
assert.equal(manifest.provenance.generator_sha256, pin.generator_sha256);
assert.equal(digest(blob(pin.source_commit, manifest.provenance.generator)), pin.generator_sha256, "generator at source commit");
assert.equal(digest(blob(pin.provider_commit, manifest.provenance.generator)), pin.generator_sha256, "generator at provider tip");
assert.match(manifest.provenance.transport, /Real loopback HTTP POSTs through unchanged public\/index\.php/);
assert.match(manifest.provenance.transport, /Form scalars\/objects follow released lib\/core\.ts/);
const paths = manifest.provenance.source_paths;
assert.ok(Array.isArray(paths) && paths.length > 0);
assert.deepEqual(paths, [...new Set(paths)].sort(), "scope is sorted and contains no duplicate path");
for (const revision of [pin.source_commit, pin.provider_commit]) {
  const lines = paths.map((path) => `${path}\0${digest(blob(revision, path))}`);
  assert.equal(digest(lines.join("\n")), pin.source_checksum, `scoped source at ${revision}`);
}
const names = manifest.fixtures.map((entry) => entry.file);
assert.deepEqual(names, [...new Set(names)].sort());
assert.ok(names.every((name) => /^[a-z0-9][a-z0-9-]*\.json$/.test(name)), "plain fixture filenames only");
const expected = ["manifest.json", ...names].sort();
assert.deepEqual(git("ls-tree", "--name-only", `${pin.provider_commit}:${directory}`).toString().trim().split("\n").sort(), expected);
assert.deepEqual(readdirSync(join(adminTree, directory)).sort(), expected, "vendored inventory matches provider");
assert.deepEqual(readFileSync(join(adminTree, directory, "manifest.json")), bytes);
let successes = 0;
const lines = manifest.fixtures.map((entry) => {
  const provider = blob(pin.provider_commit, `${directory}/${entry.file}`);
  assert.equal(digest(provider), entry.sha256, entry.file);
  assert.deepEqual(readFileSync(join(adminTree, directory, entry.file)), provider, `${entry.file} vendored bytes`);
  const body = JSON.parse(provider);
  assert.equal(body.status_code, entry.status_code, `${entry.file} logical status`);
  if (body.success === true && body.status_code === 200) successes++;
  return `${entry.file}\0${entry.sha256}`;
});
assert.equal(digest(lines.join("\n")), pin.fixture_set_sha256);
console.log(`VERIFIED ${pin.fixture_count} genuine bodies + manifest; ${successes} successes / ${pin.fixture_count - successes} refusals; provider ${pin.provider_commit}; source scope ${paths.length} paths; set ${pin.fixture_set_sha256}`);
