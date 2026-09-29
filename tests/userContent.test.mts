import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import UserContentEditor, { UserContentConflict } from "../components/UserContentEditor.tsx";
import { readUserContent, saveUserContent, userContentRevision, type UserContentCall } from "../lib/userContent.ts";
import { userDetail } from "../lib/userDetail.ts";

const draft = { uid: 123, headline: "Operator draft", about: "Draft biography", revision: 4 };
const current = { headline: "Member's newer headline", about: "Newer biography", revision: 5 };
const readResponse = { success: true, profile: { uid: 123, headline: current.headline, about_me: current.about, content_revision: 5 } };
const savedResponse = { success: true, content: { headline: draft.headline, about_me: draft.about, revision: 6, updated_at: 123 } };

function bridge(script: Array<[string, Awaited<ReturnType<UserContentCall>>]>) {
  const calls: Array<{ action: string; body: Record<string, unknown> }> = [];
  const call: UserContentCall = async (action, body) => {
    calls.push({ action, body });
    const next = script.shift();
    assert.ok(next, `unexpected call: ${action}`);
    assert.equal(action, next[0]);
    return next[1];
  };
  return { call, calls, done: () => assert.equal(script.length, 0) };
}

test("content revisions decode numbers and numeric strings, tolerate absence, and flag malformed present values", () => {
  for (const value of [0, 12, "0", "12"]) {
    assert.equal(userContentRevision(value), Number(value));
    assert.equal(userDetail({ profile: { uid: 123, content_revision: value } })?.profile.content_revision, Number(value));
  }
  assert.equal(userContentRevision(undefined), undefined);
  assert.equal(userDetail({ profile: { uid: 123 } })?.profile.content_revision, undefined);
  for (const value of [null, -1, "-1", "01", " 1", 1.2, "1e2", "", true, {}, [], NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(userContentRevision(value), null);
    assert.ok(userDetail({ profile: { uid: 123, content_revision: value } }), "a malformed revision does not break the rest of the member page");
  }
});

test("a save sends the read revision and adopts the next content revision", async () => {
  const b = bridge([["admin_save_user_content", savedResponse]]);
  assert.deepEqual(await saveUserContent(b.call, draft), { kind: "saved", content: { headline: draft.headline, about: draft.about, revision: 6 } });
  assert.deepEqual(b.calls[0].body, { uid: 123, headline: draft.headline, about: draft.about, expected_revision: 4 });
  b.done();
});

test("older reads can save without a revision, while zero still sends a fence", async () => {
  for (const revision of [undefined, 0]) {
    const b = bridge([["admin_save_user_content", savedResponse]]);
    assert.equal((await saveUserContent(b.call, { ...draft, revision })).kind, "saved");
    assert.equal(Object.hasOwn(b.calls[0].body, "expected_revision"), revision === 0);
    b.done();
  }
});

test("a conflict loads newer content, preserves the draft, and never automatically retries", async () => {
  const b = bridge([
    ["admin_save_user_content", { success: false, status_code: 409, error: "profile-content-conflict" }],
    ["user_detail", readResponse],
  ]);
  const original = structuredClone(draft);
  const result = await saveUserContent(b.call, draft);
  assert.deepEqual(result, { kind: "conflict", current });
  assert.deepEqual(draft, original);
  assert.deepEqual(b.calls[1].body, { uid: 123 });
  b.done();
  // After the operator's explicit review, another save uses that reviewed revision and draft.
  const retry = bridge([["admin_save_user_content", savedResponse]]);
  await saveUserContent(retry.call, { ...draft, revision: current.revision });
  assert.deepEqual(retry.calls[0].body, { uid: 123, headline: draft.headline, about: draft.about, expected_revision: 5 });
  retry.done();
});

test("an unreadable conflict stays unresolved, including foreign, partial and unversioned member reads", async () => {
  for (const response of [null, { success: false }, { success: true },
    { ...readResponse, profile: { ...readResponse.profile, uid: 999 } },
    { ...readResponse, profile: { ...readResponse.profile, about_me: undefined } },
    { ...readResponse, profile: { ...readResponse.profile, content_revision: undefined } },
    { ...readResponse, profile: { ...readResponse.profile, content_revision: "bad" } },
  ]) {
    const b = bridge([
      ["admin_save_user_content", { success: false, error: "profile-content-conflict" }],
      ["user_detail", response],
    ]);
    assert.deepEqual(await saveUserContent(b.call, draft), { kind: "conflict", current: null });
    b.done();
  }
  const refreshed = bridge([["user_detail", readResponse]]);
  assert.deepEqual(await readUserContent(refreshed.call, 123), current);
  refreshed.done();
});

test("malformed revision refusals have technical copy and are never retried", async () => {
  const b = bridge([["admin_save_user_content", { success: false, status_code: 422, error: "profile-content-revision-invalid" }]]);
  assert.deepEqual(await saveUserContent(b.call, draft), { kind: "failed", errorKey: "contentRevisionInvalid" });
  b.done();
  const blocked = bridge([]);
  assert.deepEqual(await saveUserContent(blocked.call, { ...draft, revision: null }), { kind: "failed", errorKey: "contentRevisionInvalid" });
  blocked.done();
});

test("unknown outcomes and malformed success bodies never claim a successful save", async () => {
  for (const [response, errorKey] of [
    [null, "contentSaveFailed"],
    [{ success: false, error: "profile-content-invalid" }, "contentInvalid"],
    [{ success: true }, "contentResponseInvalid"],
    [{ ...savedResponse, content: { ...savedResponse.content, revision: undefined } }, "contentResponseInvalid"],
    [{ ...savedResponse, content: { ...savedResponse.content, headline: false } }, "contentResponseInvalid"],
  ] as const) {
    const b = bridge([["admin_save_user_content", response]]);
    assert.deepEqual(await saveUserContent(b.call, draft), { kind: "failed", errorKey });
    b.done();
  }
});

for (const locale of ["en", "hu"] as const) {
  const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
  const render = (child: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale, messages, timeZone: "UTC", onError: (error: Error) => { throw error; },
  }, child));
  const noop = () => undefined;
  test(`${locale}: conflicts display newer texts and a separate review action, unreadable conflicts offer reload`, () => {
    const html = render(createElement(UserContentConflict, { current, busy: false, onReview: noop, onReload: noop }));
    assert.ok(html.includes("Member&#x27;s newer headline"));
    assert.ok(html.includes("Newer biography"));
    assert.ok(html.includes(messages.moderation.contentReviewed));
    assert.ok(!html.includes(messages.moderation.contentReloadFailed));
    const missing = render(createElement(UserContentConflict, { current: null, busy: false, onReview: noop, onReload: noop }));
    assert.ok(missing.includes(messages.moderation.contentReloadFailed));
    assert.ok(!missing.includes(messages.moderation.contentReviewed));
  });
  test(`${locale}: an absent revision leaves the editor usable; a malformed revision blocks saving with technical copy`, () => {
    const props = { uid: 123, initialHeadline: draft.headline, initialAbout: draft.about };
    const legacy = render(createElement(UserContentEditor, props));
    assert.ok(legacy.includes(draft.headline));
    assert.doesNotMatch(legacy, /disabled=/);
    const invalid = render(createElement(UserContentEditor, { ...props, initialRevision: null }));
    assert.ok(invalid.includes(messages.moderation.contentRevisionInvalid));
    assert.match(invalid, /button[^>]*disabled=""/);
  });
}
