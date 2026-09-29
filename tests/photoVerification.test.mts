import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import PhotoGestureCatalogue, { PhotoFlowWording } from "../components/PhotoVerificationEditor.tsx";
import {
  PHOTO_GESTURES_MAX,
  PROFILE_VERIFICATION_PHOTO_FLOW_FIELDS,
  PROFILE_VERIFICATION_PHOTO_FLOW_KEYS,
  cloneProfileVerificationConfig,
  emptyPhotoGesture,
  isPhotoGestureExampleUrl,
  newPhotoGestureId,
  normalizeProfileVerificationConfig,
  photoCatalogueSufficient,
  profileVerificationConfigIssues,
  profileVerificationResponseData,
  profileVerificationSavePayload,
  trimProfileVerificationDraft,
  type ProfileVerificationConfig,
} from "../lib/profileVerification.ts";

/**
 * T-863 S11 (D-135): the gesture catalogue editor. Core answers an invalid
 * document with ONE code and no field, so the console's field walker is what
 * tells the operator which field to fix; these tests pin that the walker and
 * the decoder agree, and that the editor is read-only for viewers.
 */

const CORPUS = JSON.parse(readFileSync(new URL("./fixtures/profile_verification_photo_wire/webadmin-config.json", import.meta.url), "utf8"));
const MESSAGES = {
  en: JSON.parse(readFileSync(new URL("../messages/en.json", import.meta.url), "utf8")),
  hu: JSON.parse(readFileSync(new URL("../messages/hu.json", import.meta.url), "utf8")),
};
const IMAGE = "https://img.friending.co/api/cache/admin/uploads/2026/09/20260929120000-cccccccccccccccccccccccccccccccc.jpg";

function corpusConfig(): ProfileVerificationConfig {
  const parsed = normalizeProfileVerificationConfig(profileVerificationResponseData(CORPUS));
  assert.ok(parsed);
  return parsed;
}

function paths(config: ProfileVerificationConfig): string[] {
  return profileVerificationConfigIssues(config).map((issue) => `${issue.path}:${issue.problem}`);
}

test("the example URL is a managed console upload: https, exact upload path, no query or credentials", () => {
  assert.equal(isPhotoGestureExampleUrl(IMAGE), true);
  for (const extension of ["png", "webp"]) assert.equal(isPhotoGestureExampleUrl(IMAGE.replace(/jpg$/u, extension)), true, extension);
  for (const invalid of [
    "", IMAGE.replace("https:", "http:"), `${IMAGE}?v=1`, `${IMAGE}#x`, IMAGE.replace("https://", "https://user:pw@"),
    IMAGE.replace(/jpg$/u, "gif"), IMAGE.replace("/admin/uploads/", "/fi/member/"), ` ${IMAGE}`,
    "https://img.friending.co/api/cache/admin/uploads/2026/09/2026092912000-cccccccccccccccccccccccccccccccc.jpg",
    IMAGE.replace(/c{32}/u, "C".repeat(32)),
  ]) {
    assert.equal(isPhotoGestureExampleUrl(invalid), false, invalid);
  }
});

test("new gesture ids are Core identifiers and a new row starts empty", () => {
  const id = newPhotoGestureId();
  assert.match(id, /^[a-f0-9]{32}$/u);
  assert.notEqual(newPhotoGestureId(), id);
  assert.deepEqual(emptyPhotoGesture("a".repeat(32)), {
    id: "a".repeat(32), title: { en: "", hu: "" }, subtitle: { en: "", hu: "" }, male_image_url: "", female_image_url: "",
  });
});

test("catalogue sufficiency is Core's rule: at least `count` distinct rows, count 1-10", () => {
  assert.equal(photoCatalogueSufficient([], 1), false);
  assert.equal(photoCatalogueSufficient([1], 1), true);
  assert.equal(photoCatalogueSufficient([1, 2], 3), false);
  assert.equal(photoCatalogueSufficient([1, 2, 3], 3), true);
  assert.equal(photoCatalogueSufficient(Array.from({ length: 20 }), 11), false, "above the maximum count");
  assert.equal(photoCatalogueSufficient([1], 0), false);
});

test("the decoder fails closed on a missing, partial or loosely typed photo block", () => {
  const data = () => structuredClone(profileVerificationResponseData(CORPUS)) as Record<string, any>;
  const cases: Array<[string, (value: Record<string, any>) => void]> = [
    ["no photo_flow", (value) => { delete value.copy.photo_flow; }],
    ["one photo_flow line missing", (value) => { delete value.copy.photo_flow.consent_body; }],
    ["a photo_flow line too long", (value) => { value.copy.photo_flow.camera_ready.en = "x".repeat(121); }],
    ["no count", (value) => { delete value.photo_gesture_count; }],
    ["count 0", (value) => { value.photo_gesture_count = 0; }],
    ["count 11", (value) => { value.photo_gesture_count = 11; }],
    ["count as a string", (value) => { value.photo_gesture_count = "3"; }],
    ["no catalogue", (value) => { delete value.photo_gestures; }],
    ["catalogue as a map", (value) => { value.photo_gestures = { a: value.photo_gestures[0] }; }],
    ["duplicate id", (value) => { value.photo_gestures[1].id = value.photo_gestures[0].id; }],
    ["uppercase id", (value) => { value.photo_gestures[0].id = "A".repeat(32); }],
    ["untrimmed title", (value) => { value.photo_gestures[0].title.en = " Thumbs up"; }],
    ["missing Hungarian subtitle", (value) => { delete value.photo_gestures[0].subtitle.hu; }],
    ["a member photo URL", (value) => { value.photo_gestures[0].male_image_url = "https://img.friending.co/api/cache/fi/x/y.jpeg"; }],
    ["101 gestures", (value) => {
      value.photo_gestures = Array.from({ length: PHOTO_GESTURES_MAX + 1 }, (_, index) => ({
        ...value.photo_gestures[0], id: index.toString(16).padStart(32, "0"),
      }));
    }],
  ];
  for (const [name, mutate] of cases) {
    const value = data();
    mutate(value);
    assert.equal(normalizeProfileVerificationConfig(value), null, name);
  }
  const hundred = data();
  hundred.photo_gestures = Array.from({ length: PHOTO_GESTURES_MAX }, (_, index) => ({
    ...hundred.photo_gestures[0], id: index.toString(16).padStart(32, "0"),
  }));
  assert.equal(normalizeProfileVerificationConfig(hundred)?.photo_gestures.length, PHOTO_GESTURES_MAX);
  const empty = data();
  empty.photo_gestures = [];
  assert.deepEqual(normalizeProfileVerificationConfig(empty)?.photo_gestures, [], "the catalogue starts empty");
});

test("the field walker names every field Core would refuse, by id for gesture rows", () => {
  const config = corpusConfig();
  assert.deepEqual(paths(config), []);

  const draft = cloneProfileVerificationConfig(config);
  const fresh = emptyPhotoGesture("f".repeat(32));
  draft.photo_gestures.push(fresh);
  assert.deepEqual(paths(draft), [
    `photo_gestures.${fresh.id}.title.en:required`,
    `photo_gestures.${fresh.id}.title.hu:required`,
    `photo_gestures.${fresh.id}.subtitle.en:required`,
    `photo_gestures.${fresh.id}.subtitle.hu:required`,
    `photo_gestures.${fresh.id}.male_image_url:required`,
    `photo_gestures.${fresh.id}.female_image_url:required`,
  ]);

  const broken = cloneProfileVerificationConfig(config);
  broken.photo_gesture_count = 11;
  broken.photo_gestures[1].id = broken.photo_gestures[0].id;
  broken.photo_gestures[2].female_image_url = "https://img.friending.co/elsewhere.jpg";
  broken.photo_gestures[3].subtitle.hu = "x".repeat(701);
  broken.copy.photo_flow.status_pending_title.en = "";
  broken.copy.account_card.verified.icon_color.dark = "green";
  broken.copy.consent.link_url = "http://friending.com/privacy";
  broken.copy.intro.title.hu = "";
  const id = config.photo_gestures;
  assert.deepEqual(paths(broken).sort(), [
    "copy.account_card.verified.icon_color.dark:invalid",
    "copy.consent.link_url:invalid",
    "copy.intro.title.hu:required",
    "copy.photo_flow.status_pending_title.en:required",
    "photo_gesture_count:invalid",
    `photo_gestures.${id[0].id}.id:duplicate`,
    `photo_gestures.${id[2].id}.female_image_url:invalid`,
    `photo_gestures.${id[3].id}.subtitle.hu:tooLong`,
  ].sort());
});

test("the walker and the decoder agree: a draft is savable exactly when the walker is silent", () => {
  const config = corpusConfig();
  const mutations: Array<(draft: ProfileVerificationConfig) => void> = [
    () => undefined,
    (draft) => { draft.photo_gestures = []; },
    (draft) => { draft.photo_gesture_count = 10; },
    (draft) => { draft.photo_gestures.push(emptyPhotoGesture("e".repeat(32))); },
    (draft) => { draft.photo_gestures[0].male_image_url = ""; },
    (draft) => { draft.photo_gestures[0].title.en = "  Thumbs up  "; },
    (draft) => { draft.photo_gestures[0].title.en = "   "; },
    (draft) => { draft.copy.photo_flow.consent_body.hu = "x".repeat(PROFILE_VERIFICATION_PHOTO_FLOW_FIELDS.consent_body + 1); },
    (draft) => { draft.copy.photo_flow.consent_body.hu = "x".repeat(PROFILE_VERIFICATION_PHOTO_FLOW_FIELDS.consent_body); },
    (draft) => { draft.prompts[3].label.en = ""; },
    (draft) => { draft.copy.intro.steps[0].body.en = "x".repeat(701); },
    (draft) => { draft.photo_gestures[2].id = "not-an-id"; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const draft = cloneProfileVerificationConfig(config);
    mutate(draft);
    const trimmed = trimProfileVerificationDraft(draft);
    const issues = profileVerificationConfigIssues(trimmed);
    const decoded = normalizeProfileVerificationConfig({ ...profileVerificationResponseData(CORPUS) as object, ...profileVerificationSavePayload(trimmed) });
    assert.equal(issues.length === 0, decoded !== null, `mutation ${index}: ${JSON.stringify(issues)}`);
  }
});

function renderCatalogue(locale: "en" | "hu", props: Partial<Parameters<typeof PhotoGestureCatalogue>[0]> = {}): string {
  return renderToStaticMarkup(createElement(
    NextIntlClientProvider,
    { locale, messages: MESSAGES[locale], timeZone: "UTC" },
    createElement(PhotoGestureCatalogue, {
      value: corpusConfig(),
      disabled: false,
      change() {},
      onBusyChange() {},
      fieldError: () => undefined,
      coverage: { live: false, draft: false },
      countRefused: false,
      ...props,
    }),
  ));
}

test("the catalogue shows sufficiency against the count in both languages", () => {
  const en = renderCatalogue("en");
  assert.match(en, /id="profile-verification-photo"/, "the scopes table links to this anchor");
  assert.match(en, /4 gestures in the catalogue, 3 per member: enough for a set\./);
  assert.match(en, /Add gesture/);
  assert.match(en, /Remove gesture/);
  assert.equal(en.match(/data-gesture-id=/g)?.length, 4);
  const hu = renderCatalogue("hu");
  assert.match(hu, /4 gesztus van a katalógusban, tagonként 3 kell: ez elég egy sorozathoz\./);

  const short = corpusConfig();
  short.photo_gesture_count = 6;
  const dormant = renderCatalogue("en", { value: short });
  assert.match(dormant, /4 gestures in the catalogue, 6 per member: 2 more needed\./);
  assert.match(dormant, /alert-warning[^>]*data-photo-catalogue-insufficient="true"/);
  assert.match(dormant, /cannot be published to any scope until the catalogue has enough gestures/);
  const live = renderCatalogue("en", { value: short, coverage: { live: true, draft: true } });
  assert.match(live, /alert-error[^>]*data-photo-catalogue-insufficient="true"/);
  assert.match(live, /Core refuses a save that keeps the catalogue this small/);
  assert.match(renderCatalogue("en", { coverage: null }), /could not be loaded\. Core still checks every save\./);
});

test("viewers see the catalogue read-only: no add or remove, every input disabled", () => {
  const markup = renderCatalogue("en", { disabled: true });
  assert.doesNotMatch(markup, /Add gesture|Remove gesture/);
  const inputs = markup.match(/<(input|textarea)\b[^>]*>/g) ?? [];
  assert.ok(inputs.length > 0);
  for (const input of inputs) assert.match(input, /disabled=""/, input);
  const wording = renderToStaticMarkup(createElement(
    NextIntlClientProvider,
    { locale: "en", messages: MESSAGES.en, timeZone: "UTC" },
    createElement(PhotoFlowWording, { value: corpusConfig(), disabled: true, change() {}, fieldError: () => undefined }),
  ));
  const wordingInputs = wording.match(/<(input|textarea)\b[^>]*>/g) ?? [];
  assert.equal(wordingInputs.length, PROFILE_VERIFICATION_PHOTO_FLOW_KEYS.length * 2, "eighteen EN/HU pairs");
  for (const input of wordingInputs) assert.match(input, /disabled=""/, input);
});

test("a field error renders under its own field and marks it invalid", () => {
  const config = corpusConfig();
  const target = `photo_gestures.${config.photo_gestures[1].id}.title`;
  const markup = renderCatalogue("en", {
    fieldError: (path, language) => (path === target && language === "hu" ? "Required." : path.endsWith("male_image_url") && path.includes(config.photo_gestures[0].id) && !path.includes("female") ? "Upload an example image." : undefined),
  });
  assert.equal(markup.match(/aria-invalid="true"/g)?.length, 1);
  assert.equal(markup.match(/class="field-error" role="alert">Required\./g)?.length, 1);
  assert.equal(markup.match(/Upload an example image\./g)?.length, 1);
});

test("the configuration panel reads the role, locks viewers and saves the photo block", async () => {
  const editor = await readFile(new URL("../components/ProfileVerificationConfiguration.tsx", import.meta.url), "utf8");
  assert.match(editor, /adminCall\("admin_me"\)/);
  assert.match(editor, /setCanWrite\(identity\?\.success === true && isAdminWriteRole\(identity\.role\)\);/,
    "an unreadable role fails closed to read-only");
  assert.match(editor, /function change\(mutator: \(next: ProfileVerificationConfig\) => void\) \{\s+if \(!canWrite\) return;/);
  assert.match(editor, /const locked = busy \|\| uploading \|\| !canWrite;/);
  assert.match(editor, /if \(!draft \|\| !stored \|\| busy \|\| uploading \|\| !canWrite\) return;/);
  assert.match(editor, /\{canWrite \? \(\s+<div className="row-actions">/);
  assert.match(editor, /data-profile-verification-read-only="true"/);
  assert.match(editor, /<PhotoGestureCatalogue[\s\S]+onBusyChange=\{setUploading\}/);
  assert.match(editor, /<PhotoFlowWording /);
  assert.match(editor, /configuration: profileVerificationSavePayload\(validated\)/);
});

test("EN and HU carry the catalogue and wording copy with identical key trees", () => {
  const keys = (value: unknown, prefix = ""): string[] => value && typeof value === "object"
    ? Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [`${prefix}${key}`, ...keys(child, `${prefix}${key}.`)])
    : [];
  for (const branch of ["photo", "photoFlow", "problems"]) {
    assert.deepEqual(
      keys(MESSAGES.en.profileVerification.configuration[branch]),
      keys(MESSAGES.hu.profileVerification.configuration[branch]),
      branch,
    );
  }
  assert.deepEqual(Object.keys(MESSAGES.en.profileVerification.configuration.photoFlow.fields), [...PROFILE_VERIFICATION_PHOTO_FLOW_KEYS]);
});
