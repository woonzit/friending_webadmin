import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import VerificationGateModeControl, {
  VerificationClosedModeControl,
  VerificationClosedModeImpact,
  VerificationGateModeLegend,
} from "../components/VerificationGateModeControl.tsx";
import type {
  MandatoryMethod,
  VerificationClosedModeCatalogue,
  VerificationGateMode,
  VerificationGateModeChoice,
  VerificationGateModePolicy,
} from "../lib/verificationMethod.ts";

/**
 * D-151 (T-927): the gate-mode control of the verification-method table, the
 * one-line legend and the rollback note, rendered in both console languages.
 * D-152 (T-933): the Closed mode threshold control and its impact line.
 */

const messages = {
  en: JSON.parse(readFileSync(new URL("../messages/en.json", import.meta.url), "utf8")),
  hu: JSON.parse(readFileSync(new URL("../messages/hu.json", import.meta.url), "utf8")),
} as const;

function render(element: ReturnType<typeof createElement>, locale: "en" | "hu" = "en"): string {
  return renderToStaticMarkup(createElement(
    NextIntlClientProvider,
    { locale, messages: messages[locale], timeZone: "UTC" },
    element,
  ));
}

/**
 * The control reads its row from the draft's gate modes. `choice` and
 * `inherited` describe that row: the Global row's own mode, or a storefront
 * (HUN) row's own entry — or `inherit` — under a Global mode `inherited`.
 */
function control(props: {
  scope?: "global" | "storefront";
  scopeLabel?: string;
  method?: MandatoryMethod;
  flagged?: boolean;
  choice: VerificationGateModeChoice;
  inherited?: VerificationGateMode;
  recommended?: VerificationGateMode;
  disabled?: boolean;
  inheritedBy?: string[];
  followersAllowExplore?: boolean;
  pinDroppedOnSave?: boolean;
}, locale: "en" | "hu" = "en"): string {
  const scope = props.scope ?? "global";
  const gate: VerificationGateModePolicy = scope === "global"
    ? { global: props.choice === "inherit" ? "full_block" : props.choice, overrides: {} }
    : { global: props.inherited ?? "full_block", overrides: props.choice === "inherit" ? {} : { HUN: props.choice } };
  return render(createElement(VerificationGateModeControl, {
    id: "gate-mode-test",
    gate,
    storefront: scope === "global" ? null : "HUN",
    scopeLabel: props.scopeLabel ?? (scope === "global" ? "Global default" : "Hungary (HUN)"),
    method: props.method ?? "persona",
    inheritedBy: props.inheritedBy,
    followersAllowExplore: props.followersAllowExplore,
    pinDroppedOnSave: props.pinDroppedOnSave,
    flagged: props.flagged ?? false,
    recommended: props.recommended ?? "explore",
    disabled: props.disabled ?? false,
    onChange() {},
  }), locale);
}

function selected(html: string): string | undefined {
  return html.match(/<option value="([a-z_]+)" selected="">/u)?.[1];
}

test("the global row offers the two modes, marks Explore recommended and shows a stored Full block as such", () => {
  const html = control({ choice: "full_block" });
  assert.match(html, /data-gate-mode-control="global"/);
  assert.match(html, /data-gate-mode="full_block"/);
  assert.match(html, /<option value="explore">Explore mode \(recommended\)<\/option>/);
  assert.match(html, /<option value="full_block" selected="">Full block<\/option>/);
  assert.doesNotMatch(html, /value="inherit"/, "the global row has no inherit choice");
  assert.doesNotMatch(html, /value="off"/, "Off is never a mode option on a forced row");
  assert.match(html, /Recommended where verification is required: Explore mode/);
  assert.equal(selected(html), "full_block");
});

test("Explore selected: no nudge, and the control can be disabled for read-only operators", () => {
  const html = control({ choice: "explore", disabled: true });
  assert.equal(selected(html), "explore");
  assert.match(html, /data-gate-mode="explore"/);
  assert.doesNotMatch(html, /gate-mode-recommended/);
  assert.match(html, /<select id="gate-mode-test" class="input" disabled=""/);
  assert.doesNotMatch(html, /aria-describedby/, "no hint, nothing to describe it");
});

test("a storefront row without its own mode follows Global and says which mode that is", () => {
  const inheritsFull = control({ scope: "storefront", choice: "inherit", inherited: "full_block" });
  assert.equal(selected(inheritsFull), "inherit");
  assert.match(inheritsFull, /<option value="inherit" selected="">Same as Global: Full block<\/option>/);
  assert.match(inheritsFull, /data-gate-mode="full_block"/, "the effective mode is the inherited one");
  assert.match(inheritsFull, /gate-mode-recommended/);

  const inheritsExplore = control({ scope: "storefront", choice: "inherit", inherited: "explore" });
  assert.match(inheritsExplore, /Same as Global: Explore mode/);
  assert.doesNotMatch(inheritsExplore, /gate-mode-recommended/);

  const pinned = control({ scope: "storefront", choice: "full_block", inherited: "explore" });
  assert.equal(selected(pinned), "full_block");
});

test("a row whose method is None shows Off, locked, with no recommendation", () => {
  for (const props of [
    { method: "none" as const, choice: "full_block" as const },
    { method: "none" as const, scope: "storefront" as const, choice: "inherit" as const, inherited: "explore" as const },
    { method: "none" as const, scope: "storefront" as const, choice: "full_block" as const },
  ]) {
    const html = control(props);
    assert.match(html, /data-gate-mode="off"/);
    assert.match(html, /<select id="gate-mode-test" class="input" disabled="" aria-label="Gate mode, [^"]+" aria-describedby="gate-mode-test-hint"><option value="off" selected="">Off<\/option><\/select>/);
    assert.match(html, /<small id="gate-mode-test-hint" class="field-hint">No method is required here, so there is nothing to lock\.<\/small>/);
    assert.doesNotMatch(html, /recommended/i);
  }
});

test("Off with a stored mode stays visible and clearable, never silently kept (review P2)", () => {
  const global = control({ method: "none", choice: "explore" });
  assert.match(global, /data-gate-mode="off" data-gate-mode-stored="explore"/);
  assert.match(global, /<select id="gate-mode-test" class="input" aria-label="Gate mode, Global default" aria-describedby="gate-mode-test-hint">/,
    "enabled, so the documented rollback can be done here");
  assert.match(global, /<option value="explore" disabled="" selected="">Explore mode \(stored, no effect\)<\/option><option value="full_block">Full block<\/option><\/select>/,
    "only clearing it is offered; Global has no Same as Global");
  assert.match(global, /<small id="gate-mode-test-hint" class="field-hint" data-gate-mode-off-stored="true">No method is required here, so nobody is locked, but Explore mode is still stored\./);

  const storefront = control({ method: "none", scope: "storefront", choice: "explore", inherited: "explore" });
  assert.match(storefront, /<option value="full_block">Full block<\/option><option value="inherit">Same as Global: Explore mode<\/option>/);
  assert.match(control({ method: "none", choice: "explore", disabled: true }), /<select id="gate-mode-test" class="input" disabled=""/,
    "read-only operators still cannot change it");
  assert.match(control({ method: "none", choice: "explore" }, "hu"), /Felfedező mód \(tárolt, hatástalan\)/);
});

test("every gate select is named after its scope and described by its hint", () => {
  const global = control({ choice: "full_block" });
  assert.match(global, /aria-label="Gate mode, Global default" aria-describedby="gate-mode-test-hint"/);
  assert.match(global, /<small id="gate-mode-test-hint" class="field-hint gate-mode-recommended"/);
  const hun = control({ scope: "storefront", scopeLabel: "Hungary (HUN)", method: "video", choice: "full_block" });
  assert.match(hun, /aria-label="Gate mode, Hungary \(HUN\)" aria-describedby="gate-mode-test-hint"/);
  assert.match(hun, /<small id="gate-mode-test-hint" class="field-hint" data-gate-mode-persona-only="true">/);
  const conflict = control({ scope: "storefront", method: "photo", choice: "explore" });
  assert.match(conflict, /aria-describedby="gate-mode-test-hint" aria-invalid="true"/);
  assert.match(conflict, /<small id="gate-mode-test-hint" class="field-error" data-gate-mode-persona-only="true">/);
  assert.match(control({ choice: "full_block" }, "hu"), /aria-label="Zárási mód, Global default"/);
});

test("Explore runs only under Persona: video and photo rows disable it, inherited Explore included, with the one-line hint", () => {
  const video = control({ method: "video", choice: "full_block" });
  assert.match(video, /<option value="explore" disabled="">Explore mode<\/option>/, "disabled, and no longer called recommended");
  assert.match(video, /<option value="full_block" selected="">Full block<\/option>/);
  assert.match(video, /data-gate-mode-persona-only="true">Explore mode needs Persona as the required method\.<\/small>/);
  assert.match(video, /class="field-hint" data-gate-mode-persona-only/);
  assert.doesNotMatch(video, /data-gate-mode-conflict/);
  assert.doesNotMatch(video, /gate-mode-recommended/, "Explore is never recommended where it is not allowed");

  const inheritsExplore = control({ scope: "storefront", method: "photo", choice: "inherit", inherited: "explore" });
  assert.match(inheritsExplore, /<option value="inherit" disabled="" selected="">Same as Global: Explore mode<\/option>/,
    "following an Explore global under photo is the same conflict");
  assert.match(inheritsExplore, /data-gate-mode-conflict="true"/);
  assert.match(inheritsExplore, /aria-invalid="true"/);
  assert.match(inheritsExplore, /class="field-error" data-gate-mode-persona-only="true">Explore mode needs Persona as the required method\. Choose Full block here, or make Persona the method\./);

  const inheritsFull = control({ scope: "storefront", method: "video", choice: "inherit", inherited: "full_block" });
  assert.match(inheritsFull, /<option value="inherit" selected="">Same as Global: Full block<\/option>/, "inheriting Full block stays allowed");
  assert.doesNotMatch(inheritsFull, /data-gate-mode-conflict/);

  const flagged = control({ method: "persona", choice: "explore", flagged: true });
  assert.match(flagged, /data-gate-mode-conflict="true"/, "a scope Core named stays highlighted until the next edit");
  assert.match(flagged, /class="field-error"/);

  const hu = control({ method: "video", choice: "full_block" }, "hu");
  assert.match(hu, /A Felfedező módhoz a Persona igazolvány-ellenőrzésnek kell kötelező módszernek lennie\./);
});

test("the legend explains each mode in one line and carries the rollback note, in English and Hungarian", () => {
  const en = render(createElement(VerificationGateModeLegend, { storesModes: false }));
  assert.match(en, /data-gate-mode-legend="true"/);
  assert.match(en, /<strong>Explore mode<\/strong> · They can browse events in the area they signed up in\. People, chat and joining stay locked until they verify\./);
  assert.match(en, /<strong>Full block<\/strong> · They stay in the Waiting Room until they verify \(how it works today\)\./);
  assert.match(en, /<strong>Off<\/strong> · Set the method to None/);
  assert.match(en, /Older versions keep showing the Waiting Room/);
  assert.match(en, /data-gate-mode-rollback="true"><strong>Rollback:<\/strong> Set every scope back to Full block and publish before downgrading Core, including Off rows that still show a stored mode\. With every scope on Full block, Core stores no gate mode, so an older Core can read the policy\./,
    "Core 06cf4f67 omits gate_mode whenever every scope is Full block; None rows keep theirs");
  assert.doesNotMatch(en, /still stores a mode/, "the pre-review caveat is gone");
  assert.match(en, /Only where Persona is the required method\./);
  assert.match(en, /data-gate-mode-stored="false">Neither the draft nor the live policy stores a gate mode, so an older Core can read it\./);
  const stored = render(createElement(VerificationGateModeLegend, { storesModes: true }));
  assert.match(stored, /data-gate-mode-stored="true">The draft or the live policy stores a gate mode, so an older Core cannot read it/);

  const hu = render(createElement(VerificationGateModeLegend, { storesModes: true }), "hu");
  assert.match(hu, /<strong>Felfedező mód<\/strong>/);
  assert.match(hu, /<strong>Teljes zárás<\/strong>/);
  assert.match(hu, /<strong>Kikapcsolva<\/strong>/);
  assert.match(hu, /Visszaállítás:<\/strong> A Core visszaállítása előtt állíts vissza minden területet Teljes zárásra – a tárolt módot mutató Kikapcsolva sorokat is –, és tedd közzé\./);
  assert.match(hu, /A draft vagy az élő szabályzat zárási módot tárol/);
  assert.match(render(createElement(VerificationGateModeLegend, { storesModes: false }), "hu"), /Sem a draft, sem az élő szabályzat nem tárol zárási módot/);
  const huControl = control({ choice: "full_block" }, "hu");
  assert.match(huControl, /Felfedező mód \(ajánlott\)/);
});

test("Global None that forcing storefronts follow: the mode is in effect for them, so it is a real choice (review round 2)", () => {
  const applies = control({ method: "none", choice: "explore", inheritedBy: ["United States (USA)", "Canada (CAN)"], followersAllowExplore: true });
  assert.match(applies, /data-gate-mode="explore"/);
  assert.doesNotMatch(applies, /stored, no effect/, "it has an effect on the followers");
  assert.match(applies, /<option value="explore" selected="">Explore mode \(recommended\)<\/option><option value="full_block">Full block<\/option>/,
    "Explore stays selectable there");
  assert.match(applies, /data-gate-mode-applies-to="United States \(USA\),Canada \(CAN\)">Global requires no method itself, but this mode applies to the storefronts that follow it: United States \(USA\), Canada \(CAN\)\./);
  assert.match(applies, /aria-describedby="gate-mode-test-hint"/);

  const fullFollowed = control({ method: "none", choice: "full_block", inheritedBy: ["United States (USA)"], followersAllowExplore: true });
  assert.match(fullFollowed, /<option value="explore">Explore mode \(recommended\)<\/option>/, "Explore can be chosen for the followers");
  assert.match(fullFollowed, /applies to the storefronts that follow it: United States \(USA\)/);

  const nobody = control({ method: "none", choice: "explore", inheritedBy: [] });
  assert.match(nobody, /Explore mode \(stored, no effect\)/, "only without followers is it without effect");
  assert.match(control({ method: "none", choice: "explore", inheritedBy: ["Magyarország (HUN)"], followersAllowExplore: true }, "hu"),
    /de ez a mód érvényes az azt követő storefrontokra: Magyarország \(HUN\)\./);
});

test("Global None whose followers force no Persona: Explore is not offered, and a stored one is flagged (round 3)", () => {
  const full = control({ method: "none", choice: "full_block", inheritedBy: ["United States (USA)"], followersAllowExplore: false });
  assert.match(full, /<option value="explore" disabled="">Explore mode<\/option>/, "a draft that can only ever be refused is not offered");
  assert.match(full, /applies to the storefronts that follow it: United States \(USA\)\. Explore mode needs Persona as the required method\./);
  const stored = control({ method: "none", choice: "explore", inheritedBy: ["United States (USA)"], followersAllowExplore: false });
  assert.match(stored, /data-gate-mode-conflict="true"/);
  assert.match(stored, /<option value="explore" disabled="" selected="">Explore mode<\/option>/);
  assert.match(stored, /class="field-error"/);
});

test("an explicit Full block that Core will drop on save says so (review round 2)", () => {
  const pinned = control({ scope: "storefront", choice: "full_block", inherited: "full_block", pinDroppedOnSave: true });
  assert.match(pinned, /<small id="gate-mode-test-pin" class="field-hint" data-gate-mode-pin-dropped="true">No effect while every scope is Full block; set it in the save that switches a scope to Explore\.<\/small>/,
    "round 3: the copy does not invite turning Explore on");
  assert.match(pinned, /aria-describedby="gate-mode-test-hint gate-mode-test-pin"/, "both hints describe the select");
  assert.doesNotMatch(control({ scope: "storefront", choice: "full_block", inherited: "explore" }), /data-gate-mode-pin-dropped/);
  assert.doesNotMatch(control({ scope: "storefront", choice: "inherit", pinDroppedOnSave: true }), /data-gate-mode-pin-dropped/,
    "only an explicit Full block entry");
  assert.match(control({ scope: "storefront", choice: "full_block", pinDroppedOnSave: true }, "hu"),
    /Amíg minden terület Teljes záráson van, nincs hatása; abban a mentésben állítsd be, amelyik egy területet Felfedező módra kapcsol\./);
});

test("the scopes table wiring that remains source-level: probed read, helpers, no hand-built commands", () => {
  const table = readFileSync(new URL("../components/VerificationMethodScopesTable.tsx", import.meta.url), "utf8");
  // Behaviour lives in tested helpers (verificationMethodGateMode.test.mts): the probe, the
  // mutation outcome order, the apply command, row add/remove, inheritors and dropped pins.
  // D-152: the first read asks for v3 (the preferred wire) and steps down per named refusal.
  assert.match(table, /const wireRef = useRef<VerificationMethodContractVersion>\(VERIFICATION_METHOD_PREFERRED_CONTRACT_VERSION\);/);
  assert.match(table, /const result = await loadVerificationMethodConsole\(adminCall, wireRef\.current\);\n\s+wireRef\.current = result\.version;/);
  assert.doesNotMatch(table, /contractVersion/, "nothing reads a wire version from admin_me");
  assert.match(table, /const outcome = verificationMethodMutationOutcome\(response, commandVersion\);/);
  assert.match(table, /verificationMethodApplyCommand\(impact, normalizedReason, crypto\.randomUUID\(\)\)/);
  assert.match(table, /verificationMethodDraftWithStorefront\(draft, storefrontToAdd\)/);
  assert.match(table, /verificationMethodDraftWithoutStorefront\(draft, storefront\)/);
  assert.doesNotMatch(table, /contract_version: 1,\n/, "no hard-coded v1 command remains");
  // An explicit reload and gate_mode_hidden both send the session back to the preferred wire
  // (v3; the probe steps down to v2 on a D-151 Core). When a v1 answer proves v2 or newer is
  // decided by `verificationMethodOutcomeProvesV2` (tested).
  assert.equal((table.match(/wireRef\.current = VERIFICATION_METHOD_PREFERRED_CONTRACT_VERSION;/g) ?? []).length, 4,
    "reload button, a v1 success with gate_mode_hidden, a v1 Persona-rule refusal, a v1 preview with gate_mode_hidden");
  assert.doesNotMatch(table, /wireRef\.current = [123];/, "no hard-coded wire version");
  assert.doesNotMatch(table, /contract_version === 2/, "versions are read through the lib helpers");
});

// ---------------------------------------------------------------------------
// D-152 (T-933): the Closed mode threshold
// ---------------------------------------------------------------------------

const CLOSED_CATALOGUE: VerificationClosedModeCatalogue = {
  default: 3, minimum: 0, maximum: 50, off: 0, radius_miles: 100, client_selector: "explore_mode_contract_version",
};

function closedControl(props: {
  value?: number;
  live?: number;
  applies?: boolean;
  storesThreshold?: boolean;
  disabled?: boolean;
} = {}, locale: "en" | "hu" = "en"): string {
  return render(createElement(VerificationClosedModeControl, {
    id: "closed-mode-test",
    value: props.value ?? 3,
    live: props.live ?? props.value ?? 3,
    catalogue: CLOSED_CATALOGUE,
    applies: props.applies ?? true,
    storesThreshold: props.storesThreshold ?? false,
    disabled: props.disabled ?? false,
    onChange() {},
  }), locale);
}

test("the Closed mode control: the label, 0..50 with 0 as Never close and 3 as the default, and the two copy lines", () => {
  const html = closedControl({ value: 5, live: 5 });
  assert.match(html, /data-closed-mode-control="true" data-closed-mode-value="5" data-closed-mode-applies="true"/);
  assert.match(html, /<strong>Closed mode<\/strong>/);
  assert.match(html, /<label class="field closed-mode-field" for="closed-mode-test"><span>Closed mode below N events within 100 mi of the sign-up area<\/span>/);
  assert.match(html, /<select id="closed-mode-test" class="input">/, "enabled, nothing to describe while it applies and equals live");
  const options = [...html.matchAll(/<option value="(\d+)"( selected="")?>([^<]+)<\/option>/gu)];
  assert.deepEqual(options.map((match) => Number(match[1])), Array.from({ length: 51 }, (_, index) => index), "exactly 0..50");
  assert.equal(options[0][3], "Never close (always Explore)");
  assert.equal(options[1][3], "1 event");
  assert.equal(options[3][3], "3 events (default)");
  assert.equal(options[50][3], "50 events");
  assert.deepEqual(options.filter((match) => match[2]).map((match) => match[1]), ["5"], "the draft's value is selected");
  assert.match(html, /data-closed-mode-what="true">In Closed mode only the profile is open\. Everything else stays locked, and the app makes no promises about events\.<\/p>/);
  assert.match(html, /data-closed-mode-one-way="true">One way only: once a member has had Explore, they keep it, even if the events later go away\.<\/p>/);
  assert.match(html, /Closed mode reaches only app versions that ask for it\. Older versions keep today’s Explore mode\./);
  assert.match(html, /data-closed-mode-rollback="true"><strong>Rollback:<\/strong> Before rolling Core or Webadmin back, set this to 3 events and publish\./);
  assert.doesNotMatch(html, /data-closed-mode-stored/);
  assert.doesNotMatch(html, /data-closed-mode-not-applicable|data-closed-mode-live/);
  assert.match(closedControl({ value: 0 }), /<option value="0" selected="">Never close \(always Explore\)<\/option>/);
});

test("no scope in Explore: the control is disabled and says why; read-only operators cannot change it either", () => {
  const html = closedControl({ applies: false });
  assert.match(html, /data-closed-mode-applies="false"/);
  assert.match(html, /<select id="closed-mode-test" class="input" disabled="" aria-describedby="closed-mode-test-applies">/);
  assert.match(html, /<small id="closed-mode-test-applies" class="field-hint" data-closed-mode-not-applicable="true">Available when at least one scope uses Explore mode\.<\/small>/);
  assert.match(closedControl({ disabled: true }), /<select id="closed-mode-test" class="input" disabled="">/);
  assert.doesNotMatch(closedControl({ disabled: true }), /data-closed-mode-not-applicable/, "read-only is not the Explore rule");
});

test("a draft that differs from live names the live value, and a stored non-default threshold names the rollback", () => {
  const disabledDiffering = closedControl({ value: 5, live: 3, applies: false });
  assert.match(disabledDiffering, /aria-describedby="closed-mode-test-applies closed-mode-test-live"/);
  assert.doesNotMatch(disabledDiffering, /Saving/, "Q10 is said once, in the table's save preview");

  const changed = closedControl({ value: 5, live: 0 });
  assert.match(changed, /aria-describedby="closed-mode-test-live"/);
  assert.match(changed, /<small id="closed-mode-test-live" class="field-hint" data-closed-mode-live="0">Live: Never close \(always Explore\)<\/small>/);

  const stored = closedControl({ value: 5, storesThreshold: true });
  assert.match(stored, /data-closed-mode-stored="true">The draft or the live policy stores a threshold other than 3\. An older Core cannot read it and an older Webadmin cannot clear it, so do the rollback above first\.<\/p>/);
});

test("the Closed mode control in Hungarian", () => {
  const hu = closedControl({ value: 1, live: 3, applies: false, storesThreshold: true }, "hu");
  assert.match(hu, /<strong>Zárt mód<\/strong>/);
  assert.match(hu, /Zárt mód, ha a regisztrációs terület 100 mérföldes körzetében N-nél kevesebb esemény van/);
  assert.match(hu, /<option value="0">Soha ne zárjon \(mindig Felfedező mód\)<\/option>/);
  assert.match(hu, /<option value="3">3 esemény \(alapértelmezett\)<\/option>/);
  assert.match(hu, /<option value="1" selected="">1 esemény<\/option>/);
  assert.match(hu, /Zárt módban csak a profil érhető el\./);
  assert.match(hu, /Csak egy irányba működik: aki egyszer Felfedező módot kapott, megtartja/);
  assert.match(hu, /Akkor állítható, ha legalább egy terület Felfedező módot használ\./);
  assert.match(hu, /Élő: 3 esemény/);
  assert.match(hu, /3-tól eltérő küszöböt tárol/);
});

test("the impact line shows the stored live and draft threshold, the draft in bold when it changes", () => {
  const changed = render(createElement(VerificationClosedModeImpact, { live: 3, draft: 5 }));
  assert.match(changed, /data-closed-mode-impact="true" data-closed-mode-changed="true"/);
  assert.match(changed, /<strong>Closed mode threshold<\/strong>/);
  assert.match(changed, /<span data-closed-mode-impact-live="3">Live: 3 events<\/span>/);
  assert.match(changed, /<span data-closed-mode-impact-draft="5"><strong>Draft: 5 events<\/strong><\/span>/);
  assert.match(changed, /The threshold does not change who has to verify either, so the counts stay the same\./);
  const same = render(createElement(VerificationClosedModeImpact, { live: 0, draft: 0 }));
  assert.doesNotMatch(same, /data-closed-mode-changed/);
  assert.match(same, /<span data-closed-mode-impact-draft="0">Draft: Never close \(always Explore\)<\/span>/);
  assert.match(render(createElement(VerificationClosedModeImpact, { live: 3, draft: 1 }), "hu"), /Élő: 3 esemény[\s\S]*<strong>Draft: 1 esemény<\/strong>/);
});

test("the scopes table renders the threshold only on v3 material and edits it only through the tested helpers", () => {
  const table = readFileSync(new URL("../components/VerificationMethodScopesTable.tsx", import.meta.url), "utf8");
  assert.match(table, /data\.contract_version === 3 && data\.gate_mode_catalogue\?\.closed_below_events/,
    "v1 and v2 sessions never show the control (Core strips the threshold there)");
  assert.match(table, /applies=\{closedModeThresholdApplies\(gate\)\}/);
  assert.match(table, /storesThreshold=\{verificationMethodPolicyStoresClosedThreshold\(data\.policy\)\}/);
  assert.match(table, /disabled=\{!editable\}\n\s+onChange=\{\(value\) => \{ if \(gate\) patch\(\{ gate_mode: withClosedBelowEvents\(gate, value\) \}\); \}\}/,
    "saved with the draft: the same patch, save, CAS and receipt path as every other edit");
  assert.match(table, /closedModeThresholdChangedBySave\(sent, success\.policy\.draft\.document\.gate_mode\)/);
  assert.match(table, /<VerificationClosedModeImpact live=\{impact\.impact\.closed_below_events\.live\} draft=\{impact\.impact\.closed_below_events\.draft\} \/>/);
  assert.match(table, /const commandVersion = verificationMethodCommandVersion\(durable\.payload\);/);
  // Q10 in the save preview: next to the Save button, only when this save resets the threshold.
  assert.match(table, /closedMode !== null && closedModeThresholdResetOnSave\(gate\) \?[\s\S]*data-closed-mode-save-preview="true"[\s\S]*gt\("closedMode\.savePreview", \{ value: thresholdLabel\(closedMode\.catalogue\.default\) \}\)[\s\S]*<div className="forced-save-bar">/);
  const en = messages.en.verificationAdmin.methodPolicy.gateMode.closedMode;
  assert.equal(en.savePreview, "Saving this draft returns the Closed mode threshold to {value}: with every scope on Full block, Core stores no gate mode, so the threshold goes too.");
  assert.equal(en.resetAfterSave, "The Closed mode threshold is back to {value} because every scope is Full block.");
  assert.deepEqual(Object.keys(messages.hu.verificationAdmin.methodPolicy.gateMode.closedMode), Object.keys(en), "EN/HU parity");
  assert.equal(messages.hu.verificationAdmin.methodPolicy.gateMode.closedMode.savePreview,
    "A draft mentésekor a Zárt mód küszöbe visszaáll erre: {value}. Ha minden terület Teljes záráson van, a Core nem tárol zárási módot, így a küszöböt sem.");
  assert.equal(messages.en.verificationAdmin.forced.validation.closedBelowEvents, "The Closed mode threshold must be a whole number from 0 to 50.");
});
