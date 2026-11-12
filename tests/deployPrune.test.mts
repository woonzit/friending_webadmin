import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The release never passes `--delete` to rsync, so `scripts/deploy-prune.sh` is the only thing
// that removes a file from the server. These tests run the script itself: `list` against a
// scratch repository, `apply` against a scratch directory that stands for the server tree.

const SCRIPT = fileURLToPath(new URL("../scripts/deploy-prune.sh", import.meta.url));
const DEPLOY = fileURLToPath(new URL("../deploy.sh", import.meta.url));

function scratch(t: { after(fn: () => void): void }): string {
  const directory = mkdtempSync(join(tmpdir(), "deploy-prune-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function write(root: string, path: string, content = "x\n"): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function prune(args: string[], input = ""): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bash", [SCRIPT, ...args], { input, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function git(repository: string, ...args: string[]): string {
  const result = spawnSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid",
      GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid",
    },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function commit(repository: string, message: string): string {
  git(repository, "add", "-A");
  git(repository, "commit", "-q", "-m", message);
  return git(repository, "rev-parse", "HEAD");
}

const ROUTE = "app/(dashboard)/old console/[id]/page.tsx";

test("list names exactly the tracked files a release removes, in both directions", (t) => {
  const repository = scratch(t);
  git(repository, "init", "-q");
  write(repository, "lib/kept.ts");
  write(repository, "lib/changed.ts", "one\n");
  write(repository, "lib/removed.ts");
  write(repository, ROUTE);
  write(repository, "tests/fixtures/old/body.json");
  const live = commit(repository, "live");

  rmSync(join(repository, "lib/removed.ts"));
  rmSync(join(repository, "app/(dashboard)/old console"), { recursive: true });
  rmSync(join(repository, "tests/fixtures/old"), { recursive: true });
  write(repository, "lib/changed.ts", "two\n");
  write(repository, "lib/added.ts");
  const next = commit(repository, "next");

  const release = prune(["list", repository, live, next]);
  assert.equal(release.status, 0, release.stderr);
  assert.deepEqual(release.stdout.split("\n").filter(Boolean), [ROUTE, "lib/removed.ts", "tests/fixtures/old/body.json"]);

  // A rollback is a release of the older commit: what only the newer one has must go.
  const rollback = prune(["list", repository, next, live]);
  assert.equal(rollback.status, 0, rollback.stderr);
  assert.deepEqual(rollback.stdout.split("\n").filter(Boolean), ["lib/added.ts"]);

  const same = prune(["list", repository, next, next]);
  assert.equal(same.status, 0);
  assert.equal(same.stdout, "");

  const unknown = prune(["list", repository, "0".repeat(40), next]);
  assert.equal(unknown.status, 3);
  assert.equal(unknown.stdout, "", "an unknown live commit must never produce a list");
});

test("apply removes the listed files and the directories they leave empty, and nothing else", (t) => {
  const server = scratch(t);
  for (const path of [ROUTE, "lib/removed.ts", "lib/kept.ts", "tests/fixtures/old/body.json", "tests/fixtures/kept/body.json",
    ".env.local", ".deploy_commit", "node_modules/pkg/index.js", ".next/server/app.js", "server-owned.txt"]) write(server, path);
  const list = [ROUTE, "lib/removed.ts", "tests/fixtures/old/body.json", "lib/already-gone.ts", "gone/with/its/directory.ts"].join("\n") + "\n";

  const preview = prune(["apply", server, "--dry-run"], list);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /3 file\(s\) would be removed/);
  assert.ok(existsSync(join(server, "lib/removed.ts")), "a dry run removes nothing");

  const run = prune(["apply", server], list);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /3 file\(s\) removed/);
  for (const gone of [ROUTE, "app/(dashboard)", "app", "lib/removed.ts", "tests/fixtures/old"]) {
    assert.ok(!existsSync(join(server, gone)), `${gone} should be gone`);
  }
  for (const kept of ["lib/kept.ts", "tests/fixtures/kept/body.json", ".env.local", ".deploy_commit",
    "node_modules/pkg/index.js", ".next/server/app.js", "server-owned.txt"]) {
    assert.ok(existsSync(join(server, kept)), `${kept} must stay`);
  }

  const again = prune(["apply", server], list);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /0 file\(s\) removed/);
});

test("apply refuses a list with one unsafe path before it removes anything", (t) => {
  const outside = scratch(t);
  write(outside, "victim.txt");
  const hostile = [
    join(outside, "victim.txt"),
    "../" + outside.split("/").pop() + "/victim.txt",
    "lib/../../victim.txt",
    "./lib/removed.ts",
    "lib//removed.ts",
    ".env.local",
    "nested/.env",
    ".deploy_commit",
    "node_modules/pkg/index.js",
    ".next/server/app.js",
    ".git/config",
    "tsconfig.tsbuildinfo",
    "logs/server.log",
    "lib/",
    "lib",
    "linked/victim.txt",
  ];
  for (const path of hostile) {
    const server = scratch(t);
    for (const file of ["lib/removed.ts", ".env.local", "nested/.env", ".deploy_commit", "node_modules/pkg/index.js",
      ".next/server/app.js", ".git/config", "tsconfig.tsbuildinfo", "logs/server.log"]) write(server, file);
    symlinkSync(outside, join(server, "linked"));

    const run = prune(["apply", server], `lib/removed.ts\n${path}\n`);
    assert.equal(run.status, 4, `${path} must be refused: ${run.stdout}${run.stderr}`);
    assert.match(run.stderr, /refused, nothing was removed/);
    assert.ok(existsSync(join(server, "lib/removed.ts")), `${path}: the safe path listed before it must survive the refusal`);
    assert.ok(existsSync(join(outside, "victim.txt")), `${path}: nothing outside the directory may be touched`);
    for (const file of [".env.local", "nested/.env", ".deploy_commit", "node_modules/pkg/index.js", ".next/server/app.js",
      ".git/config", "tsconfig.tsbuildinfo", "logs/server.log"]) {
      assert.ok(existsSync(join(server, file)), `${path}: ${file} must stay`);
    }
  }
});

test("apply removes a tracked link itself, never what it points at", (t) => {
  const outside = scratch(t);
  write(outside, "target.txt");
  const server = scratch(t);
  mkdirSync(join(server, "public"));
  symlinkSync(join(outside, "target.txt"), join(server, "public/link.txt"));

  const run = prune(["apply", server], "public/link.txt\n");
  assert.equal(run.status, 0, run.stderr);
  assert.ok(!existsSync(join(server, "public")), "the link and its emptied directory are gone");
  assert.ok(existsSync(join(outside, "target.txt")), "the link's target is untouched");
});

test("deploy.sh still never lets rsync delete, and prunes between the upload and the server gates", () => {
  const source = readFileSync(DEPLOY, "utf8");
  assert.ok(!/rsync[^\n]*--delete|^\s*--delete/m.test(source), "rsync must never be given --delete");
  const upload = source.indexOf("rsync -az \\");
  const list = source.indexOf("scripts/deploy-prune.sh\" list ");
  const apply = source.indexOf("scripts/deploy-prune.sh' apply ");
  const serverGates = source.indexOf("npm ci");
  assert.ok(list > 0 && apply > 0 && upload > 0 && serverGates > 0, "the release lists and applies the removals");
  assert.ok(list < upload, "the removal list is computed from the live commit before anything is uploaded");
  assert.ok(upload < apply && apply < serverGates, "removals follow the upload and precede the server's own gates");
});
