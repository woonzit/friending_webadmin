import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import VerificationGateModeControl, { VerificationGateModeLegend } from "../components/VerificationGateModeControl.tsx";
import type { MandatoryMethod, VerificationGateMode, VerificationGateModeChoice } from "../lib/verificationMethod.ts";

/**
 * D-151 (T-927): the gate-mode control of the verification-method table, the
 * one-line legend and the rollback note, rendered in both console languages.
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

function control(props: {
  scope?: "global" | "storefront";
  method?: MandatoryMethod;
  flagged?: boolean;
  choice: VerificationGateModeChoice;
  inherited?: VerificationGateMode;
  recommended?: VerificationGateMode;
  disabled?: boolean;
}, locale: "en" | "hu" = "en"): string {
  return render(createElement(VerificationGateModeControl, {
    id: "gate-mode-test",
    scope: props.scope ?? "global",
    method: props.method ?? "persona",
    flagged: props.flagged ?? false,
    choice: props.choice,
    inherited: props.inherited ?? "full_block",
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
  const html = control({ method: "none", choice: "explore" });
  assert.match(html, /data-gate-mode="off"/);
  assert.match(html, /<select id="gate-mode-test" class="input" disabled=""[^>]*><option value="off" selected="">Off<\/option><\/select>/);
  assert.match(html, /No method is required here, so there is nothing to lock\./);
  assert.doesNotMatch(html, /recommended/i);
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
  const en = render(createElement(VerificationGateModeLegend, { liveStoresModes: false }));
  assert.match(en, /data-gate-mode-legend="true"/);
  assert.match(en, /<strong>Explore mode<\/strong> · They can browse events in the area they signed up in\. People, chat and joining stay locked until they verify\./);
  assert.match(en, /<strong>Full block<\/strong> · They stay in the Waiting Room until they verify \(how it works today\)\./);
  assert.match(en, /<strong>Off<\/strong> · Set the method to None/);
  assert.match(en, /Older versions keep showing the Waiting Room/);
  assert.match(en, /data-gate-mode-rollback="true"><strong>Rollback:<\/strong> Set every scope back to Full block and publish before downgrading Core\. With every scope on Full block, Core stores no gate mode, so an older Core can read the policy\./,
    "Core 06cf4f67 omits gate_mode whenever every scope is Full block");
  assert.doesNotMatch(en, /still stores a mode/, "the pre-review caveat is gone");
  assert.match(en, /Only where Persona is the required method\./);
  assert.match(en, /data-gate-mode-live-stored="false">The live policy stores no gate mode, so an older Core can read it\./);
  const stored = render(createElement(VerificationGateModeLegend, { liveStoresModes: true }));
  assert.match(stored, /data-gate-mode-live-stored="true">The live policy stores gate modes\. An older Core cannot read it/);

  const hu = render(createElement(VerificationGateModeLegend, { liveStoresModes: true }), "hu");
  assert.match(hu, /<strong>Felfedező mód<\/strong>/);
  assert.match(hu, /<strong>Teljes zárás<\/strong>/);
  assert.match(hu, /<strong>Kikapcsolva<\/strong>/);
  assert.match(hu, /Visszaállítás:<\/strong> A Core visszaállítása előtt állíts vissza minden területet Teljes zárásra, és tedd közzé\. Ha minden terület Teljes záráson van, a Core nem tárol zárási módot/);
  assert.match(hu, /Az élő szabályzat zárási módokat tárol\./);
  const huControl = control({ choice: "full_block" }, "hu");
  assert.match(huControl, /Felfedező mód \(ajánlott\)/);
});

test("the scopes table asks for v2, falls back to v1 for the session, and never writes a mode on its own", () => {
  const table = readFileSync(new URL("../components/VerificationMethodScopesTable.tsx", import.meta.url), "utf8");
  // §8.4/§15: admin_me does not advertise v2, so the first read asks for it; an older Core's 409 drops to v1.
  assert.match(table, /const wireRef = useRef<VerificationMethodContractVersion>\(2\);/);
  assert.doesNotMatch(table, /contractVersion/, "nothing reads a wire version from admin_me");
  assert.match(table, /verificationMethodErrorResponse\(response\) === "verification-method-contract-version"/);
  assert.match(table, /adminCall\("verification_method_console", \{ contract_version: 1 \}\)/);
  // Every call after the read uses the wire the read proved.
  assert.match(table, /contract_version: data\.contract_version,\n\s+draft_json: draftDocument,/);
  assert.match(table, /contract_version: version,\n\s+expected_revision: expected,/);
  // v1 and v2 fingerprints differ: a publish carries the version AND the fingerprint of the impact it was bound to.
  assert.match(table, /contract_version: impact\.contract_version,\n\s+expected_revision: impact\.expected_revision,\n\s+normalized_fingerprint: impact\.normalized_fingerprint,/);
  assert.match(table, /liveStoresModes=\{!isDefaultGateModePolicy\(data\.policy\.live\.document\.gate_mode\)\}/);
  assert.doesNotMatch(table, /contract_version: 1,\n/, "no hard-coded v1 command remains");
  // D-151 review: the 422 with data is decoded before anything else reads the answer, so it is never "uncertain".
  const mutation = table.slice(table.indexOf("async function executeMutation("), table.indexOf("function startMutation("));
  assert.ok(mutation.indexOf("verificationMethodGateModeConflictResponse(response)") > 0);
  assert.ok(mutation.indexOf("verificationMethodGateModeConflictResponse(response)") < mutation.indexOf("verificationMethodErrorResponse(response)"));
  assert.match(table, /method=\{method\}\n\s+flagged=\{refusedScopes\.includes\(row \?\? "global"\)\}/);
  assert.match(table, /gateModeHidden && data\?\.contract_version === 1/, "the v1 view warns about a mode it cannot show");
  // The column exists only on v2 material with its catalogue.
  assert.match(table, /const columnCount = gate !== null && recommendedMode !== null \? 5 : 4;/);
  // Modes change only through the control (operator choice) or by removing that storefront's row.
  const writes = table.match(/gate_mode: withGateModeChoice\(/g) ?? [];
  assert.equal(writes.length, 3, "control change, mode-only row removal, method row removal");
  const addOverride = table.slice(table.indexOf("function addOverride()"), table.indexOf("function removeOverride("));
  assert.doesNotMatch(addOverride, /gate_mode/, "a new storefront row follows Global until the operator picks a mode");
});
