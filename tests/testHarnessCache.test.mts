import test from "node:test";
import assert from "node:assert/strict";
import { compiledModule, serverModule } from "./support/adminMembershipServerHarness.mts";

// The server harness keeps each module's parse and transpile for the test process (it used to redo both for every
// membership case). The cache must never serve a stale or shared module: it is keyed by the source text, and each
// call still evaluates the module in a new vm context. (The read-chains test's own cache is pinned by its negative
// controls, which parse a mutated copy of an approved file under the same path.)

test("a changed source is compiled again: the cache is keyed by the path and the text", () => {
  const source = 'import { a } from "@/lib/x";\nimport type { T } from "@/lib/t";\nexport const value: T = a + 1;';
  const first = compiledModule("lib/DERIVED.ts", source);
  assert.equal(compiledModule("lib/DERIVED.ts", source), first, "the same text is not parsed twice");
  assert.deepEqual(first.imports, [{ module: "@/lib/x", names: [{ local: "a", imported: "a" }] }], "type-only imports are not runtime imports");
  const edited = compiledModule("lib/DERIVED.ts", 'import { b as c } from "@/lib/y";\nexport const value = c + 2;');
  assert.notEqual(edited, first); assert.match(edited.code, /value = c \+ 2/);
  assert.deepEqual(edited.imports, [{ module: "@/lib/y", names: [{ local: "c", imported: "b" }] }]);
});

test("every call evaluates the module afresh, with that call's own overrides", async () => {
  const first = await serverModule("lib/pageAdminMe.ts", { adminCall: async () => ({ success: true, role: "owner" }) });
  const second = await serverModule("lib/pageAdminMe.ts", { adminCall: async () => ({ success: true, role: "viewer" }) });
  assert.notEqual(first, second); assert.notEqual(first.pageAdminMe, second.pageAdminMe);
  assert.equal((await first.pageAdminMe()()).role, "owner"); assert.equal((await second.pageAdminMe()()).role, "viewer");
});
