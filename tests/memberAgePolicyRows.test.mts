import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { MemberAgePolicyRows } from "../components/MemberAgePolicyRows.tsx";
import { userDetail, type UserDetailProfile } from "../lib/userDetail.ts";

/**
 * D-122 / T-730. The expected values come from the same pinned Core corpus the
 * console tests use: `member_page_facts` is what `AgeDisplayPolicy` answered for
 * five member shapes, and `WebadminController::userDetail` assigns those three
 * calls to `age_display` / `birthday_locked` / `realdob` verbatim.
 */
const CORPUS = new URL(
  "./fixtures/profile_presentation_generation_wire/t730-generation-console-envelopes.json",
  import.meta.url,
);
const CORPUS_SHA256 = "2cfa78253a02add9fab538435ce4280f6de7848a84fe3aaeb2e7c75c2b19dd57";

type MemberFacts = {
  age_display: string;
  birthday_locked: boolean;
  realdob: boolean;
};

async function memberFacts(): Promise<Record<string, MemberFacts>> {
  const bytes = await readFile(CORPUS);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), CORPUS_SHA256);
  return JSON.parse(bytes.toString("utf8")).capture.member_page_facts.rows as Record<string, MemberFacts>;
}

/** The smallest `user_detail` body the projection accepts, plus whatever is under test. */
function response(profileExtras: Record<string, unknown>) {
  return {
    success: true,
    profile: {
      uid: 4242,
      display_name: "Example Member",
      user_name: "example",
      codename: "EX-1",
      age: 36,
      birthyear: 1990,
      generation: "millennial",
      created: 1700000000,
      last_seen: 1772366400,
      ...profileExtras,
    },
  };
}

function profileOf(profileExtras: Record<string, unknown>): UserDetailProfile {
  const parsed = userDetail(response(profileExtras));
  assert.ok(parsed, "the projection must still parse — these keys are additive");
  return parsed.profile;
}

async function rows(profile: UserDetailProfile, locale: "en" | "hu"): Promise<Array<[string, string]>> {
  const messages = JSON.parse(
    await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"),
  );
  const markup = renderToStaticMarkup(createElement(
    NextIntlClientProvider,
    { locale, messages },
    createElement(MemberAgePolicyRows, { profile }),
  ));
  return [...markup.matchAll(/<dt>([^<]*)<\/dt><dd(?: class="[^"]*")?><span>([^<]*)<\/span>/g)]
    .map((match) => [match[1], match[2]] as [string, string]);
}

const EXPECTED = {
  en: {
    labels: ["Age display", "Birthday lock", "Birthday origin"],
    age_display: { exact: "Exact age", generation: "Generation", hidden: "Hidden" },
    birthday_locked: { true: "Locked", false: "Changeable" },
    realdob: { true: "Confirmed", false: "Carried over from the old system" },
  },
  hu: {
    labels: ["Kor megjelenítése", "Születésnap zárolása", "Születésnap eredete"],
    age_display: { exact: "Pontos kor", generation: "Generáció", hidden: "Rejtett" },
    birthday_locked: { true: "Zárolt", false: "Módosítható" },
    realdob: { true: "Megerősített", false: "Régi rendszerből átvett" },
  },
} as const;

test("every member shape Core answered renders its three facts, in both locales", async () => {
  const facts = await memberFacts();
  // The corpus must exercise all three `age_display` values and both states of
  // each boolean, or this test proves less than it claims.
  assert.deepEqual(
    [...new Set(Object.values(facts).map((row) => row.age_display))].sort(),
    ["exact", "generation", "hidden"],
  );
  assert.deepEqual([...new Set(Object.values(facts).map((row) => row.birthday_locked))].sort(), [false, true]);
  assert.deepEqual([...new Set(Object.values(facts).map((row) => row.realdob))].sort(), [false, true]);

  for (const [name, fact] of Object.entries(facts)) {
    const profile = profileOf(fact);
    assert.equal(profile.age_display, fact.age_display, name);
    assert.equal(profile.birthday_locked, fact.birthday_locked, name);
    assert.equal(profile.realdob, fact.realdob, name);
    for (const locale of ["en", "hu"] as const) {
      const expected = EXPECTED[locale];
      assert.deepEqual(await rows(profile, locale), [
        [expected.labels[0], expected.age_display[fact.age_display as keyof typeof expected.age_display]],
        [expected.labels[1], expected.birthday_locked[String(fact.birthday_locked) as "true" | "false"]],
        [expected.labels[2], expected.realdob[String(fact.realdob) as "true" | "false"]],
      ], `${name} / ${locale}`);
    }
  }
});

test("a response that states none of the three still parses, and prints em dashes", async () => {
  const profile = profileOf({});
  assert.equal(profile.age_display, null);
  assert.equal(profile.birthday_locked, null);
  assert.equal(profile.realdob, null);
  for (const locale of ["en", "hu"] as const) {
    assert.deepEqual((await rows(profile, locale)).map(([, value]) => value), ["—", "—", "—"]);
  }
});

test("a value outside Core's closed vocabulary is not guessed at", async () => {
  // Fail-OPEN for these three keys: this console renders no age from them, so
  // an invented "Hidden" would be an invented support answer. The member
  // clients fail closed instead, and that difference is deliberate.
  for (const bad of ["", "exact ", "EXACT", "unknown", 1, null, true, {}]) {
    assert.equal(profileOf({ age_display: bad }).age_display, null, JSON.stringify(bad));
  }
  for (const bad of ["true", 1, 0, null, "", {}]) {
    assert.equal(profileOf({ birthday_locked: bad }).birthday_locked, null, JSON.stringify(bad));
    assert.equal(profileOf({ realdob: bad }).realdob, null, JSON.stringify(bad));
  }
  const profile = profileOf({ age_display: "somethingelse", birthday_locked: "yes", realdob: 1 });
  assert.deepEqual((await rows(profile, "hu")).map(([, value]) => value), ["—", "—", "—"]);
});

test("the rows never restate the age the neighbouring fields carry", async () => {
  // `realdob: false` on a member whose `age` looks perfectly ordinary is the
  // whole reason the trio exists; the rows must read the server's answer, not
  // the age beside it.
  const profile = profileOf({ age: 36, show_age: true, age_display: "hidden", birthday_locked: true, realdob: false });
  assert.deepEqual(await rows(profile, "hu"), [
    ["Kor megjelenítése", "Rejtett"],
    ["Születésnap zárolása", "Zárolt"],
    ["Születésnap eredete", "Régi rendszerből átvett"],
  ]);
});
