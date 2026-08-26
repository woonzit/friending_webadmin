import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  MAX_TIP_ITEMS,
  SIGNUP_PHOTO_DRAFT_ISSUES,
  SIGNUP_PHOTO_FAILURE_CODES,
  draftFromConfig,
  isModerationLinkUrl,
  isTrustedTipImageUrl,
  movedTipItem,
  newTipItem,
  normalizeTipOrder,
  signupPhotoConfig,
  signupPhotoFailureCode,
  signupPhotoSavePayload,
  validateSignupPhotoDraft,
  type SignupPhotoConfig,
} from "../lib/signupPhotoConfig.ts";

const IMAGE_A = "https://pic.freelove.hu/api/cache/admin/uploads/2026/08/a.jpg";
const IMAGE_B = "https://pic.freelove.hu/api/cache/admin/uploads/2026/08/b.jpg";

/** The §4.1 read shape, with both locales unresolved. */
function validConfig(): Record<string, unknown> {
  return {
    schema_version: 1,
    revision: 3,
    min_photos: 2,
    max_photos: 6,
    moderation: {
      enabled: true,
      text: { en: "Profile pictures are moderated.", hu: "A profilképeket moderáljuk." },
      link_title: { en: "Moderation policy", hu: "Moderálási elveink" },
      link_url: "https://freelove.hu/moderalasi-elvek",
    },
    avatar: {
      title: { en: "Upload your first picture", hu: "Töltsd fel az első képed" },
      subtitle: { en: "This becomes your main picture.", hu: "Ez lesz a fő profilképed." },
    },
    tips: {
      title: { en: "What should I upload?", hu: "Milyen képet töltsek fel?" },
      items: [
        {
          key: "clear_face",
          caption: { en: "Show your face clearly", hu: "Legyen jól látható az arcod" },
          verdict: "good",
          sort_order: 10,
          image_female: IMAGE_A,
          image_male: IMAGE_B,
        },
        {
          key: "no_group_photo",
          caption: { en: "Avoid group photos", hu: "Kerüld a csoportképet" },
          verdict: "bad",
          sort_order: 20,
          image_female: IMAGE_A,
          image_male: null,
        },
      ],
    },
    updated_at: 1786000000,
    updated_by: "admin@example.com",
  };
}

/** The §4.1 defaults Core serves when no document exists yet. */
function emptyConfig(): Record<string, unknown> {
  return {
    schema_version: 1,
    revision: 0,
    min_photos: 2,
    max_photos: 6,
    moderation: {
      enabled: false,
      text: { en: "", hu: "" },
      link_title: { en: "", hu: "" },
      link_url: "",
    },
    avatar: { title: { en: "", hu: "" }, subtitle: { en: "", hu: "" } },
    tips: { title: { en: "", hu: "" }, items: [] },
  };
}

function parsed(): SignupPhotoConfig {
  const value = signupPhotoConfig(validConfig());
  assert.ok(value, "the reference document must parse");
  return value;
}

test("the read payload survives a full editor round trip unchanged", () => {
  const original = parsed();
  assert.equal(original.revision, 3);
  assert.equal(original.tips.items.length, 2);
  assert.equal(original.tips.items[0]?.image_male, IMAGE_B);
  assert.equal(original.tips.items[1]?.image_male, null);

  // Read → draft → the exact §4.2 save parameters → back through the parser. Whole-document
  // replace means anything this loop drops is a field the editor would silently delete.
  const payload = signupPhotoSavePayload(draftFromConfig(original));
  const rebuilt = signupPhotoConfig({
    schema_version: 1,
    revision: payload.expected_revision,
    min_photos: payload.min_photos,
    max_photos: payload.max_photos,
    moderation: JSON.parse(String(payload.moderation_json)),
    avatar: JSON.parse(String(payload.avatar_json)),
    tips: JSON.parse(String(payload.tips_json)),
    updated_at: original.updated_at,
    updated_by: original.updated_by,
  });
  assert.deepEqual(rebuilt, original);

  // The browser-only row identity must never reach the wire.
  assert.doesNotMatch(String(payload.tips_json), /uid/);
});

test("the no-document defaults parse, so the editor renders a usable empty form", () => {
  const empty = signupPhotoConfig(emptyConfig());
  assert.ok(empty);
  assert.equal(empty.revision, 0);
  assert.equal(empty.updated_at, null);
  assert.equal(empty.updated_by, "");
  assert.deepEqual(empty.tips.items, []);
  // Empty is a legal stored value but not a legal *saved* one: §4.2 always requires the avatar copy.
  assert.equal(validateSignupPhotoDraft(draftFromConfig(empty)), "avatar");
});

test("a locale map missing en or hu fails the whole document", () => {
  for (const mutate of [
    (raw: Record<string, unknown>) => {
      delete (raw.avatar as { title: Record<string, string> }).title.hu;
    },
    (raw: Record<string, unknown>) => {
      delete (raw.moderation as { text: Record<string, string> }).text.en;
    },
    (raw: Record<string, unknown>) => {
      const tips = raw.tips as { items: Array<{ caption: Record<string, string> }> };
      delete tips.items[0].caption.hu;
    },
    (raw: Record<string, unknown>) => {
      const tips = raw.tips as { title: Record<string, string> };
      delete tips.title.en;
    },
  ]) {
    const broken = validConfig();
    mutate(broken);
    assert.equal(signupPhotoConfig(broken), null);
  }

  // An extra locale is tolerated rather than rejected, and the editor carries it to the wire. That
  // is the whole of the guarantee: Core's `SignupPhotoExperiencePolicy::localeMap()` projects every
  // map down to exactly `{en, hu}` in `normalize()` before storing and again in `adminPayload()`
  // before returning, so this `de` entry is dropped by Core on the way in and would never be read
  // back. This asserts what the console does, NOT that a third language survives a save.
  const future = validConfig();
  (future.avatar as { title: Record<string, string> }).title.de = "Lade dein erstes Bild hoch";
  assert.equal(signupPhotoConfig(future)?.avatar.title.de, "Lade dein erstes Bild hoch");
  const kept = signupPhotoSavePayload(draftFromConfig(signupPhotoConfig(future)!));
  assert.match(String(kept.avatar_json), /Lade dein erstes Bild hoch/);
});

test("the verdict is a closed union", () => {
  for (const verdict of ["maybe", "GOOD", "", null, 1, undefined]) {
    const broken = validConfig();
    (broken.tips as { items: Array<Record<string, unknown>> }).items[0].verdict = verdict;
    assert.equal(signupPhotoConfig(broken), null, `verdict ${String(verdict)} must be refused`);
  }
  for (const verdict of ["good", "bad"]) {
    const accepted = validConfig();
    (accepted.tips as { items: Array<Record<string, unknown>> }).items[0].verdict = verdict;
    assert.equal(signupPhotoConfig(accepted)?.tips.items[0]?.verdict, verdict);
  }
});

test("a tip image is accepted only from the media host, under the cache path", () => {
  assert.equal(isTrustedTipImageUrl(IMAGE_A), true);
  for (const url of [
    "http://pic.freelove.hu/api/cache/a.jpg",
    "https://pic.freelove.hu/uploads/a.jpg",
    "https://pic.freelove.hu.evil.example/api/cache/a.jpg",
    "https://pic.freelove.hu@evil.example/api/cache/a.jpg",
    "https://pic.freelove.hu:8443/api/cache/a.jpg",
    "/api/cache/a.jpg",
    "",
  ]) {
    assert.equal(isTrustedTipImageUrl(url), false, url);
    const broken = validConfig();
    (broken.tips as { items: Array<Record<string, unknown>> }).items[0].image_female = url;
    assert.equal(signupPhotoConfig(broken), null, url);
  }

  // The moderation link is a policy page: its host is deliberately unrestricted, its scheme is not.
  assert.equal(isModerationLinkUrl("https://anything.example/policy"), true);
  assert.equal(isModerationLinkUrl("http://freelove.hu/policy"), false);
  assert.equal(isModerationLinkUrl("javascript:alert(1)"), false);
  assert.equal(isModerationLinkUrl("freelove.hu/policy"), false);
});

test("the twelve-item cap holds on load, on validation and on the add control", () => {
  assert.equal(MAX_TIP_ITEMS, 12);

  const item = (index: number) => ({
    key: `tip_${index}`,
    caption: { en: `Tip ${index}`, hu: `Tipp ${index}` },
    verdict: "good",
    sort_order: index * 10,
    image_female: IMAGE_A,
    image_male: null,
  });

  const atCap = validConfig();
  (atCap.tips as { items: unknown[] }).items = Array.from({ length: 12 }, (_, i) => item(i + 1));
  assert.equal(signupPhotoConfig(atCap)?.tips.items.length, 12);

  // Thirteen is a document this editor could not legally write back, so it is a load failure rather
  // than a silent truncation that the next save would make permanent.
  const overCap = validConfig();
  (overCap.tips as { items: unknown[] }).items = Array.from({ length: 13 }, (_, i) => item(i + 1));
  assert.equal(signupPhotoConfig(overCap), null);

  const draft = draftFromConfig(signupPhotoConfig(atCap)!);
  assert.equal(validateSignupPhotoDraft(draft), null);
  draft.tips.items = [...draft.tips.items, newTipItem(draft.tips.items)];
  assert.equal(draft.tips.items.length, 13);
  assert.equal(validateSignupPhotoDraft(draft), "tooManyTips");
});

test("duplicate tip keys are refused on load and before a save", () => {
  const duplicated = validConfig();
  const items = (duplicated.tips as { items: Array<Record<string, unknown>> }).items;
  items[1].key = items[0].key;
  assert.equal(signupPhotoConfig(duplicated), null);

  const draft = draftFromConfig(parsed());
  draft.tips.items[1].key = draft.tips.items[0].key;
  assert.equal(validateSignupPhotoDraft(draft), "duplicateTipKey");
  assert.equal(newTipItem(draft.tips.items).key, "tip_1");
});

test("required-when-used validation matches the contract", () => {
  const base = parsed();

  const counts = draftFromConfig(base);
  counts.min_photos = 4;
  counts.max_photos = 3;
  assert.equal(validateSignupPhotoDraft(counts), "count");

  // Moderation copy is required only while the notice is on.
  const disabled = draftFromConfig(base);
  disabled.moderation = { enabled: false, text: { en: "", hu: "" }, link_title: { en: "", hu: "" }, link_url: "" };
  assert.equal(validateSignupPhotoDraft(disabled), null);
  const enabled = draftFromConfig(base);
  enabled.moderation.link_url = "";
  assert.equal(validateSignupPhotoDraft(enabled), "moderation");

  const avatar = draftFromConfig(base);
  avatar.avatar.subtitle.hu = "   ";
  assert.equal(validateSignupPhotoDraft(avatar), "avatar");

  const tipsTitle = draftFromConfig(base);
  tipsTitle.tips.title.en = "";
  assert.equal(validateSignupPhotoDraft(tipsTitle), "tipsTitle");

  const caption = draftFromConfig(base);
  caption.tips.items[0].caption.en = "";
  assert.equal(validateSignupPhotoDraft(caption), "tipCaption");

  const image = draftFromConfig(base);
  image.tips.items[0].image_female = "";
  assert.equal(validateSignupPhotoDraft(image), "tipImage");

  // An empty tips list is explicitly allowed; the client then hides the box.
  const noTips = draftFromConfig(base);
  noTips.tips.items = [];
  assert.equal(validateSignupPhotoDraft(noTips), null);
});

test("a malformed policy link is refused locally even while the notice is switched off", () => {
  const draft = draftFromConfig(parsed());
  draft.moderation.enabled = false;
  draft.moderation.text = { en: "", hu: "" };
  draft.moderation.link_title = { en: "", hu: "" };

  // Core's `normalizeModeration()` refuses an unparseable `link_url` before it looks at `enabled`,
  // so a broken address parked behind a disabled toggle cannot go live when somebody flips it back
  // on. Skipping the branch locally turned that into a 422 that named no field.
  for (const broken of [
    "freelove.hu/moderalasi-elvek",
    "http://freelove.hu/moderalasi-elvek",
    "javascript:alert(1)",
    "https://user:pass@freelove.hu/policy",
  ]) {
    draft.moderation.link_url = broken;
    assert.equal(validateSignupPhotoDraft(draft), "moderationLink", broken);
  }

  // Being off still means the strings are not required and an empty URL is legal — the toggle
  // governs whether the block is required, not whether a supplied address may be broken.
  draft.moderation.link_url = "";
  assert.equal(validateSignupPhotoDraft(draft), null);
  draft.moderation.link_url = "https://freelove.hu/moderalasi-elvek";
  assert.equal(validateSignupPhotoDraft(draft), null);

  // With the notice on, an empty URL is the requirement failure and a broken one is still the
  // format failure: two different answers, because they point the operator at different work.
  draft.moderation.enabled = true;
  draft.moderation.text = { en: "Moderated.", hu: "Moderált." };
  draft.moderation.link_title = { en: "Policy", hu: "Elvek" };
  draft.moderation.link_url = "";
  assert.equal(validateSignupPhotoDraft(draft), "moderation");
  draft.moderation.link_url = "http://freelove.hu/policy";
  assert.equal(validateSignupPhotoDraft(draft), "moderationLink");
});

test("an audit-write failure is a saved change, so its config is adopted rather than discarded", () => {
  // `WebadminController::saveSignupPhotoConfig()` writes the document and bumps `revision` BEFORE
  // it tries to write the audit row, and attaches the saved `config` to the 500 on purpose. Reading
  // this as a generic failure keeps a draft whose `expected_revision` is one behind the stored
  // document, so the operator's next save 409s against their own write.
  const saved = validConfig();
  saved.revision = 4;
  const response = {
    success: false,
    status_code: 500,
    error: "audit-write-failed",
    config: saved,
  };
  assert.equal(signupPhotoFailureCode(response), "audit-write-failed");

  const adopted = signupPhotoConfig(response.config);
  assert.ok(adopted, "the audit-failure body carries a document the parser must accept");
  assert.equal(adopted.revision, 4);
  assert.equal(signupPhotoSavePayload(draftFromConfig(adopted)).expected_revision, 4);
  // Adopting it is also what stops the page reporting unsaved changes: the draft rebuilt from the
  // returned config produces the identical save payload the page compares for dirtiness.
  assert.deepEqual(
    signupPhotoSavePayload(draftFromConfig(adopted)),
    signupPhotoSavePayload(draftFromConfig(signupPhotoConfig(saved)!)),
  );

  // The other 500 is its opposite: the storage write threw, Core attaches no `config` — verified
  // against the handler, which adds one only for the conflict and for the audit failure — and the
  // operator's draft is the only copy of their edit.
  const writeFailed = { success: false, status_code: 500, error: "signup-photo-config-write-failed" };
  assert.equal(signupPhotoFailureCode(writeFailed), "signup-photo-config-write-failed");
  assert.equal(Object.hasOwn(writeFailed, "config"), false);
  // A bare 500 stays ambiguous — three different Core paths answer with one — so it must not be
  // guessed into either meaning.
  assert.equal(signupPhotoFailureCode({ success: false, status_code: 500 }), "");
});

test("Core's real admin payload spells an absent men's picture as an empty string", () => {
  // `SignupPhotoExperiencePolicy::adminPayload()` projects `image_male` through `text()`, which
  // returns `''` for an absent value. `null` is the PUBLIC payload's spelling; the editor read path
  // never sees it from a stored document, and the fixtures above modelled only that one.
  const payload = validConfig();
  const items = (payload.tips as { items: Array<Record<string, unknown>> }).items;
  items[0].image_male = "";
  items[1].image_male = "";
  const config = signupPhotoConfig(payload);
  assert.ok(config);
  assert.equal(config.tips.items[0]?.image_male, null);
  assert.equal(config.tips.items[1]?.image_male, null);

  // It must go back as `null`, the storable spelling, not as the empty string it arrived as.
  const wire = JSON.parse(String(signupPhotoSavePayload(draftFromConfig(config)).tips_json));
  assert.equal(wire.items[0].image_male, null);
  assert.equal(validateSignupPhotoDraft(draftFromConfig(config)), null);

  // The same projection stamps a never-written document as `updated_at: 0` and `updated_by: ''`
  // rather than omitting them. Both must read as "never written", not as 1970.
  const fresh = signupPhotoConfig({ ...emptyConfig(), updated_at: 0, updated_by: "" });
  assert.ok(fresh);
  assert.equal(fresh.updated_at, null);
  assert.equal(fresh.updated_by, "");
});

test("reordering moves the item and never leaves two cards sharing an order", () => {
  const draft = draftFromConfig(parsed());
  const [first, second] = draft.tips.items;
  const moved = movedTipItem(draft.tips.items, 1, -1);
  assert.deepEqual(moved.map((item) => item.key), [second.key, first.key]);
  assert.equal(movedTipItem(moved, 0, -1).map((item) => item.key).join(","), `${second.key},${first.key}`);

  const collided = draft.tips.items.map((item) => ({ ...item, sort_order: 10 }));
  const normalized = normalizeTipOrder(collided);
  assert.deepEqual(normalized.map((item) => item.sort_order), [10, 20]);
  // Equal orders would make the swap a no-op, so normalisation is what keeps the arrows working.
  assert.notDeepEqual(
    movedTipItem(collided, 1, -1).map((item) => item.key),
    collided.map((item) => item.key),
  );
});

test("the typed failure identity is read from either envelope field", () => {
  // Core's webadmin envelope uses a numeric `status_code`, which `lib/core.ts` promotes to the HTTP
  // status, while §4.2 writes the failure identity as `status_code: 'signup-photo-config-conflict'`.
  // Both spellings resolve; anything outside the contract's closed set does not.
  assert.equal(
    signupPhotoFailureCode({ success: false, error: "signup-photo-config-conflict" }),
    "signup-photo-config-conflict",
  );
  assert.equal(
    signupPhotoFailureCode({ success: false, status_code: "signup-photo-config-conflict" }),
    "signup-photo-config-conflict",
  );
  assert.equal(
    signupPhotoFailureCode({ success: false, error: "signup-photo-config-invalid-image-url" }),
    "signup-photo-config-invalid-image-url",
  );
  // A bare numeric 409 still reads as the conflict: §4.2 gives this action exactly one.
  assert.equal(signupPhotoFailureCode({ success: false, status_code: 409 }), "signup-photo-config-conflict");
  assert.equal(signupPhotoFailureCode({ success: false, error: "core-timeout" }), "");
  assert.equal(signupPhotoFailureCode({ success: false, status_code: 422 }), "");
  assert.equal(signupPhotoFailureCode({ success: false, status_code: 500 }), "");
  assert.equal(signupPhotoFailureCode(null), "");
  assert.equal(signupPhotoFailureCode("signup-photo-config-conflict"), "");
});

test("a revision conflict is resolved by adopting the server copy, never by merging", () => {
  const local = draftFromConfig(parsed());
  local.tips.items[0].caption.en = "A caption only this operator typed";
  local.min_photos = 1;

  // §4.2: the 409 carries the whole authoritative document. Adopting it must reproduce that
  // document exactly — no field of the discarded draft may survive into the adopted state.
  const authoritative = validConfig();
  authoritative.revision = 9;
  authoritative.min_photos = 3;
  const server = signupPhotoConfig((authoritative as { [key: string]: unknown }));
  assert.ok(server);
  const adopted = draftFromConfig(server);
  assert.equal(adopted.revision, 9);
  assert.equal(adopted.min_photos, 3);
  assert.equal(adopted.tips.items[0].caption.en, "Show your face clearly");
  assert.equal(signupPhotoSavePayload(adopted).expected_revision, 9);

  // An unreadable conflict body must not be adopted at all; the page then re-reads the document.
  assert.equal(signupPhotoConfig({ ...authoritative, schema_version: 2 }), null);
});

test("the console is wired to the two contract actions and their exact parameters", async () => {
  const actions = await readFile(new URL("../lib/adminActions.ts", import.meta.url), "utf8");
  assert.match(actions, /"signup_photo_config"/);
  assert.match(actions, /"save_signup_photo_config"/);
  assert.match(actions, /signup_photo_config: "read"/);
  assert.match(actions, /save_signup_photo_config: "write"/);

  const page = await readFile(
    new URL("../app/(dashboard)/signup-photos/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /adminCall\("signup_photo_config"\)/);
  assert.match(page, /adminCall\("save_signup_photo_config", signupPhotoSavePayload\(draft\)\)/);
  // Both upload slots go through the shared field, so they inherit its type, size and auth handling.
  assert.match(page, /ImageUploadField/);
  // The audit failure is answered by adopting the returned document, like the conflict, because the
  // write landed. A generic-failure path would keep a draft that is already one revision stale.
  assert.match(page, /failure === "audit-write-failed"/);
  assert.match(page, /if \(!adopt\(response\?\.config\)\)/);

  const payload = signupPhotoSavePayload(draftFromConfig(parsed()));
  assert.deepEqual(Object.keys(payload).sort(), [
    "avatar_json",
    "expected_revision",
    "max_photos",
    "min_photos",
    "moderation_json",
    "tips_json",
  ]);

  const shell = await readFile(new URL("../components/Shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /href: "\/signup-photos", key: "signupPhotos"/);

  // The code → message-key mapping is mechanical: drop the action's prefix and camel-case the rest.
  // Deriving it here rather than listing keys by hand is what makes the loop below exhaustive — a
  // failure code added to the closed set without its own message or its own branch fails this test
  // instead of silently reaching the generic `saveFailed`.
  const messageKey = (code: string) => code
    .replace(/^signup-photo-config-/, "")
    .replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
  for (const code of SIGNUP_PHOTO_FAILURE_CODES) {
    assert.match(page, new RegExp(`case "${code}": return t\\("errors\\.${messageKey(code)}"\\)`));
  }

  for (const locale of ["en", "hu"]) {
    const messages = JSON.parse(
      await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"),
    );
    assert.equal(typeof messages.nav.signupPhotos, "string");
    // Every failure identity gets its own message rather than a shared generic one — including the
    // two 500s, which mean opposite things: one change landed, the other did not.
    const errors = messages.signupPhotos.errors as Record<string, string>;
    assert.equal(new Set(Object.values(errors)).size, Object.keys(errors).length);
    for (const key of [...SIGNUP_PHOTO_FAILURE_CODES.map(messageKey), "saveFailed"]) {
      assert.equal(typeof errors[key], "string", `${locale}.signupPhotos.errors.${key}`);
    }

    // Same for the local validation answers: the page renders `validation.<issue>` directly, so a
    // new issue without a message would render as its own key at the operator.
    const validation = messages.signupPhotos.validation as Record<string, string>;
    assert.equal(new Set(Object.values(validation)).size, Object.keys(validation).length);
    for (const issue of SIGNUP_PHOTO_DRAFT_ISSUES) {
      assert.equal(typeof validation[issue], "string", `${locale}.signupPhotos.validation.${issue}`);
    }
  }
});
