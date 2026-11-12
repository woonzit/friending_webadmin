import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pageAdminMe } from "../lib/pageAdminMe.ts";

// The member page (/users/[uid]) mounts panels that each need Core's admin_me answer before they show
// anything. They now share one answer per mount of the page's panels (lib/pageAdminMe.ts); what each
// panel derives from it - a write role, a capability block - is unchanged and still Core's.

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("one answer for every panel of a mount; the next mount asks again", async () => {
  let asked = 0;
  const answers = [{ success: true, role: "owner" }, { success: true, role: "viewer" }];
  const ask = async () => answers[asked++] as never;
  const first = pageAdminMe(ask);
  const [a, b, c] = await Promise.all([first(), first(), first()]);
  assert.equal(asked, 1); assert.equal(a, b); assert.equal(b, c);
  assert.equal(await first(), a, "a panel that mounts later in the same mount gets the same answer");
  assert.equal(asked, 1);
  const second = pageAdminMe(ask);
  assert.deepEqual(await second(), answers[1]); assert.equal(asked, 2, "a new mount is a new question to Core");
  let failed = 0;
  const unreadable = pageAdminMe(async () => { failed++; return null; });
  assert.equal(await unreadable(), null); assert.equal(await unreadable(), null);
  assert.equal(failed, 1, "an unreadable answer is the panels' shared error state; their retry asks Core itself");
});

test("the member page makes one per mount of its panels and hands it to exactly the panels that read admin_me", () => {
  const page = read("app/(dashboard)/users/[uid]/page.tsx");
  assert.match(page, /const ready = state === "ready";\s*const panelAdminMe = useMemo\(\(\) => pageAdminMe\(\), \[uid, ready\]\);/);
  assert.doesNotMatch(page, /adminCall\("admin_me"/, "the page itself asks nothing: the first panel that mounts does");
  const imports = [...page.matchAll(/^import (\w+) from "@\/components\/(\w+)";$/gm)].map((match) => match[2]);
  assert.ok(imports.length >= 10, "the census reads every panel the page imports");
  const readers = imports.filter((name) => /admin_me/.test(read(`components/${name}.tsx`)));
  assert.deepEqual(readers.sort(), ["AdminGrantedVerificationPanel", "AudienceVisibilityUserPanel", "OutboundMessagingPanel", "UserAlbumsPanel", "UserMembershipPanel"]);
  for (const name of readers) assert.match(page, new RegExp(`<${name}\\b[^>]*adminMe=\\{panelAdminMe\\}`), name);
});

test("each panel reads the shared answer at mount only; a retry or a re-read after a write asks Core itself", () => {
  const albums = read("components/UserAlbumsPanel.tsx");
  assert.match(albums, /void adminMe\(\)\.then\(\(response\) => \{/);
  assert.doesNotMatch(albums, /adminCall\("admin_me"/);
  const membership = read("components/UserMembershipPanel.tsx");
  assert.match(membership, /const response = await \(atMount \? adminMe\(\) : adminCall\("admin_me"\)\);/);
  assert.match(membership, /useEffect\(\(\) => \{ void loadAdminAccess\(true\); \}, \[loadAdminAccess\]\);/);
  assert.match(membership, /retry=\{\(\) => void loadAdminAccess\(\)\}/);
  const granted = read("components/AdminGrantedVerificationPanel.tsx");
  assert.match(granted, /const meResponse = await \(atMount \? adminMe\(\) : adminCall\("admin_me", \{\}\)\);/);
  assert.match(granted, /void load\(firstLoad\.current\);\s*firstLoad\.current = false;/);
  assert.match(granted, /await load\(\);/); assert.match(granted, /onClick=\{\(\) => void load\(\)\}/);
  const audience = read("components/AudienceVisibilityUserPanel.tsx");
  assert.match(audience, /const meResponse = await \(atMount \? adminMe\(\) : adminCall\("admin_me", \{\}\)\);/);
  assert.match(audience, /useEffect\(\(\) => \{ void load\(firstLoad\.current\); firstLoad\.current = false; \}, \[load\]\);/);
  // The outbound-message panel: the shared answer once, at mount; its Retry (after an unreadable answer) asks Core.
  const outbound = read("components/OutboundMessagingPanel.tsx");
  assert.match(outbound, /const ask = firstAccess\.current \? adminMe\(\) : adminCall\("admin_me", \{\}\);\s*firstAccess\.current = false;/);
  assert.match(outbound, /onClick=\{\(\) => dispatch\(\{ type: "accessAsked" \}\)\}/);
  for (const [name, source] of [["membership", membership], ["granted", granted], ["audience", audience], ["outbound", outbound]] as const) {
    assert.doesNotMatch(source, /onClick=\{load\}|retry=\{load\}|retry=\{loadAdminAccess\}/, `${name}: an event is never taken for the mount flag`);
  }
  // What each panel may show is still derived from Core's answer, as before: the role, or the capability blocks.
  assert.match(albums, /setAccess\(isAdminWriteRole\(response\.role\) \? "write" : "read"\);/);
  assert.match(membership, /normalizeAdminRole\(response\.role\)/);
  assert.match(granted, /adminGrantedVerificationAdminMe\(meResponse\?\.admin_granted_verification\)/);
  assert.match(audience, /audienceVisibilityAdminMe\(meResponse\?\.audience_visibility\)/);
  assert.match(audience, /audienceVisibilityIdentityAdminMe\(meResponse\?\.audience_visibility_identity\)/);
  const panelRules = read("lib/outboundMessagingPanel.ts");
  assert.match(panelRules, /const access = operator \? outboundMessagingAccess\(response\) : \{ kind: "invalid" as const \};/);
});
