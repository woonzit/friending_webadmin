import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ADMIN_ACTIONS, adminActionAccess } from "../lib/adminActions.ts";
import { ADMIN_CLIENT_READ_ACTIONS, isAdminClientReadAction } from "../lib/adminClientReadActions.ts";

test("client presentation metadata is exactly the server's active read set, never a mutation authority", () => {
  const expected = ADMIN_ACTIONS.filter(action => ["read", "dates_read"].includes(adminActionAccess(action) ?? ""));
  assert.deepEqual([...ADMIN_CLIENT_READ_ACTIONS].sort(), [...expected].sort());
  assert.equal(new Set(ADMIN_CLIENT_READ_ACTIONS).size, ADMIN_CLIENT_READ_ACTIONS.length);
  for (const action of ADMIN_ACTIONS) assert.equal(isAdminClientReadAction(action), expected.includes(action), action);
  for (const action of ["unknown", "set_settings", "dates_external_event_place_search", "Overview", " overview "])
    assert.equal(isAdminClientReadAction(action), false, action);
});
test("client read metadata has no dependencies on bridge tables/decoders and the browser transport no longer imports them", () => {
  const metadata = readFileSync(new URL("../lib/adminClientReadActions.ts", import.meta.url), "utf8");
  assert.doesNotMatch(metadata, /^import\b/m); assert.ok(Buffer.byteLength(metadata) < 5000);
  const client = readFileSync(new URL("../lib/adminClient.ts", import.meta.url), "utf8");
  assert.doesNotMatch(client, /adminActions|adminActionAccess/);
  assert.match(client, /import \{ isAdminClientReadAction \} from "@\/lib\/adminClientReadActions"/);
});
