import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FRIENDING_START_METHODS,
  FRIENDING_START_POLICY_INITIAL_MODEL,
  friendingStartPolicyDraftFrom,
  friendingStartPolicyReadOutcome,
  friendingStartPolicyReducer,
  friendingStartPolicySaveBody,
  friendingStartPolicyStateResponse,
  type FriendingStartPolicyDraft,
  type FriendingStartPolicyEvent,
  type FriendingStartPolicyModel,
  type FriendingStartPolicyState,
} from "../../lib/friendingStartPolicy.ts";

/**
 * The Friending Start policy corpus.
 *
 * The file is Core's own `tests/fixtures/friending_start_policy_wire.json`,
 * copied byte for byte: FIXTURE_SOURCE is the Core commit that carries it and
 * FIXTURE_SHA256 its digest. To follow a later Core change, copy the file over
 * again and set the two constants; nothing else changes.
 *
 * No test names a body of the corpus: each finds what it needs by what a body
 * SAYS (a console state, a refusal and its error, something else), and the
 * test titles take their origin from the file's own provenance line. A body
 * the decoder does not accept fails the two test files that read the corpus
 * through this module (tests/friendingStartPolicy.test.mts and
 * tests/friendingStartPanel.test.mts).
 */
const FIXTURE = new URL("../fixtures/friending_start_policy_wire.json", import.meta.url);
export const FIXTURE_SOURCE = "c89692ee805363ba70165a74a06257b24bec4ca9";
export const FIXTURE_SHA256 = "57be3e9eef01072ad7dd745d1f13cda0db2df2dec689bb86d73eb5006563cc55";

export type Json = Record<string, any>;
export const FIXTURE_BYTES = readFileSync(FIXTURE);
export const CORPUS = JSON.parse(FIXTURE_BYTES.toString("utf8")) as { provenance?: unknown; routes?: Json; responses: Record<string, Json> };
/** Written from the specification, not captured from Core: said by the file itself, and repeated in every title below. */
export const DERIVED = typeof CORPUS.provenance === "string" && CORPUS.provenance.startsWith("DERIVED");
export const ORIGIN = DERIVED ? "DERIVED corpus (written from the specification, NOT Core's bodies)" : "Core's corpus";

const record = (value: unknown): value is Json => value !== null && typeof value === "object" && !Array.isArray(value);
const BODIES = Object.entries(CORPUS.responses);
/** What a body says it is. */
const isRefusal = (body: Json) => body.success === false;
const isState = (body: Json) => body.success === true && record(body.data) && "configuration" in body.data && "can_write" in body.data;
export const STATES = BODIES.filter(([, body]) => isState(body));
export const REFUSALS = BODIES.filter(([, body]) => isRefusal(body));
export const OTHERS = BODIES.filter(([, body]) => !isState(body) && !isRefusal(body));

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
export function decoded(body: Json): FriendingStartPolicyState {
  const state = friendingStartPolicyStateResponse(body);
  assert.ok(state, "a console state of the corpus must decode");
  return state;
}
/** The corpus's refusal with this error. */
export function refusal(error: string): Json {
  const found = REFUSALS.find(([, body]) => body.error === error);
  assert.ok(found, `the corpus has a ${error} refusal`);
  return found[1];
}
/** A console state of the corpus that satisfies `wanted`. */
export function stateBody(what: string, wanted: (state: FriendingStartPolicyState) => boolean): Json {
  const found = STATES.find(([, body]) => { const state = friendingStartPolicyStateResponse(body); return state !== null && wanted(state); });
  assert.ok(found, `the corpus has ${what}`);
  return found[1];
}
export const flags = (state: FriendingStartPolicyState): FriendingStartPolicyDraft => friendingStartPolicyDraftFrom(state.configuration);
export const sameFlags = (left: FriendingStartPolicyDraft, right: FriendingStartPolicyDraft) => FRIENDING_START_METHODS.every((method) => left[method] === right[method]);
/**
 * A read a writer starts from, and Core's answer to a save made on it: two
 * states of the corpus one revision apart with different switches.
 */
export function readThenSaved(): { read: Json; saved: Json } {
  for (const [, read] of STATES) for (const [, saved] of STATES) {
    const from = decoded(read), to = decoded(saved);
    if (from.can_write && to.can_write && to.configuration.revision === from.configuration.revision + 1 && !sameFlags(flags(from), flags(to))) return { read, saved };
  }
  return assert.fail("the corpus has a writer's read and the answer to a save made on it");
}
/** The switches turned, one event each, from what `model` shows to `target`. */
export function toggles(model: FriendingStartPolicyModel, target: FriendingStartPolicyDraft): FriendingStartPolicyEvent[] {
  return FRIENDING_START_METHODS.filter((method) => model.draft![method] !== target[method])
    .map((method) => ({ type: "toggled", method, value: target[method] }));
}

/** A saved, writable console state built by hand, for the cases no corpus carries: every malformed variant of it. */
export const base = () => ({
  success: true,
  status_code: 200,
  data: {
    configuration: {
      schema_version: 1,
      revision: 3,
      radar_enabled: true,
      touch_enabled: false,
      updated_at: 1_700_000_000,
      updated_by: "admin@example.test",
    } as Json,
    can_write: true,
  } as Json,
  message: 200,
  status: 200,
  can_send: 0,
});

/** The panel's state machine run over a list of events. */
export function run(events: FriendingStartPolicyEvent[], start = FRIENDING_START_POLICY_INITIAL_MODEL): FriendingStartPolicyModel {
  return events.reduce(friendingStartPolicyReducer, start);
}
/** The panel after one read that answered `body`. */
export const loaded = (body: unknown) => run([{ type: "loadStarted" }, { type: "loaded", outcome: friendingStartPolicyReadOutcome(body) }]);
/** A writer's read with the switches turned to the save the corpus answers. */
export function editing() {
  const { read, saved } = readThenSaved();
  const model = loaded(read), target = flags(decoded(saved));
  const edited = run(toggles(model, target), model);
  return { read, saved, edited, sent: friendingStartPolicySaveBody(edited.stored!.configuration.revision, edited.draft!) };
}
