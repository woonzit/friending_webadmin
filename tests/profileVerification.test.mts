import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  PROFILE_VERIFICATION_BADGE_STATUSES,
  PROFILE_VERIFICATION_DETAIL_STATUSES,
  PROFILE_VERIFICATION_PROMPTS,
  cloneProfileVerificationConfig,
  isProfileVerificationColor,
  normalizeProfileVerificationConfig,
  profileVerificationDetail,
  profileVerificationEvidenceUrl,
  profileVerificationQueue,
  profileVerificationSavePayload,
} from "../lib/profileVerification.ts";

const l10n = (en: string, hu = `${en} hu`) => ({ en, hu });

function validConfig(): Record<string, unknown> {
  const account = Object.fromEntries(PROFILE_VERIFICATION_BADGE_STATUSES.map((status, index) => [status, {
    title: l10n(`${status} title`),
    subtitle: l10n(`${status} subtitle`),
    icon_color: { light: `#${String(index + 1).repeat(6)}`, dark: `#${String(index + 5).repeat(6)}` },
  }]));
  const statuses = Object.fromEntries(PROFILE_VERIFICATION_DETAIL_STATUSES.map((status) => [status, {
    title: l10n(`${status} title`),
    subtitle: l10n(`${status} subtitle`),
  }]));
  return {
    config: "profile_video_verification",
    schema_version: 1,
    revision: 7,
    enabled: false,
    copy: {
      intro: {
        title: l10n("Verify your profile"),
        body: l10n("Record a short video selfie."),
        steps: [
          { key: "record", title: l10n("Record"), body: l10n("Follow the prompts.") },
          { key: "badge", title: l10n("Badge"), body: l10n("Receive the badge.") },
        ],
        action: l10n("Verify me"),
      },
      camera: {
        title: l10n("Get ready"),
        framing: l10n("Place your face in the oval"),
        ready: l10n("I'm ready"),
        recording: l10n("Follow the instruction"),
      },
      preview: {
        title: l10n("Review"),
        body: l10n("Check every movement."),
        retake: l10n("Retake"),
        submit: l10n("Submit"),
      },
      account_card: account,
      status: statuses,
      consent: {
        body: l10n("I consent to private evidence storage."),
        link_title: l10n("Privacy information"),
        link_url: "https://freelove.hu/privacy",
      },
    },
    prompts: PROFILE_VERIFICATION_PROMPTS.map((key) => ({
      key,
      enabled: true,
      label: l10n(key),
    })),
    updated_at: 1786300000,
    updated_by: "admin@example.invalid",
  };
}

function validQueue() {
  return {
    items: [{
      uid: 42,
      status: "pending",
      case_id: "a".repeat(32),
      submission_id: "b".repeat(32),
      trigger: "initial_submission",
      display_name: "Ada",
      gender: "female",
      avatar_available: true,
      birthday: 631152000,
      submitted_at: 1786300000,
      updated_at: 1786300100,
      lease_owner: null,
      lease_expires_at: null,
    }],
    has_more: false,
    next_before_millis: null,
    next_before_uid: null,
  };
}

function validDetail() {
  const caseId = "a".repeat(32);
  return {
    state: {
      uid: 42,
      status: "pending",
      revision: 2,
      active_submission_id: "b".repeat(32),
      active_case_id: caseId,
      current_avatar_hash: "avatar_hash",
      approved_avatar_hash: "",
      submitted_at: 1786300000,
      last_decision_at: null,
      last_rejection_reason: null,
      updated_trigger: "initial_submission",
      updated_at: 1786300100,
    },
    case: {
      case_id: caseId,
      uid: 42,
      submission_id: "b".repeat(32),
      trigger: "initial_submission",
      avatar_hash: "avatar_hash",
      has_avatar_snapshot: true,
      identity_snapshot: { display_name: "Ada", gender: "female", birthday: 631152000 },
      status: "pending",
      revision: 1,
      lease_owner: null,
      lease_expires_at: null,
      decision: null,
      decision_reason: null,
      decision_note: null,
      decided_by: null,
      decided_at: null,
      created_at: 1786300000,
      updated_at: 1786300100,
    },
    submission: {
      submission_id: "b".repeat(32),
      challenge_id: "c".repeat(32),
      config_revision: 7,
      consent_revision: 7,
      sha256: "d".repeat(64),
      bytes: 1024,
      mime: "video/mp4",
      duration_seconds: 4.2,
      width: 720,
      height: 1280,
      codec: "h264",
      audio: false,
      actions: ["turn_left", "smile", "turn_right"],
      client_diagnostics: {},
      lifecycle: "active",
      has_video: true,
      created_at: 1786300000,
    },
    user: {
      uid: 42,
      display_name: "Ada",
      gender: "female",
      birthday: 631152000,
      current_avatar_hash: "avatar_hash",
      current_avatar_url: "https://pic.freelove.hu/api/cache/ad/ada/avatar_hash_free_pop_up.jpeg",
    },
    history: [{
      event_id: "e".repeat(32),
      event_type: "submission_created",
      submission_id: "b".repeat(32),
      case_id: caseId,
      actor_kind: "member",
      actor_id: "42",
      previous_status: "not_started",
      new_status: "pending",
      previous_avatar_hash: "",
      new_avatar_hash: "avatar_hash",
      reason: "",
      metadata: {},
      created_at: 1786300000,
    }],
  };
}

test("the complete bilingual configuration round-trips without audit fields on the save wire", () => {
  const parsed = normalizeProfileVerificationConfig(validConfig());
  assert.ok(parsed);
  assert.equal(parsed.revision, 7);
  assert.equal(parsed.copy.account_card.verified.icon_color.dark, "#888888");
  assert.equal(parsed.prompts.length, PROFILE_VERIFICATION_PROMPTS.length);

  const draft = cloneProfileVerificationConfig(parsed);
  draft.copy.account_card.pending.icon_color.light = "#AABBCC";
  const payload = profileVerificationSavePayload(draft);
  assert.equal("revision" in payload, false);
  assert.equal("updated_by" in payload, false);
  assert.equal((payload.copy as typeof draft.copy).account_card.pending.icon_color.light, "#AABBCC");

  const rebuilt = normalizeProfileVerificationConfig({
    ...validConfig(),
    ...payload,
  });
  assert.equal(rebuilt?.copy.account_card.pending.icon_color.light, "#AABBCC");
});

test("all four Light/Dark status colours are strict #RRGGBB values", () => {
  assert.equal(isProfileVerificationColor("#AABBCC"), true);
  assert.equal(isProfileVerificationColor("#aabbcc"), true);
  for (const invalid of ["AABBCC", "#ABC", "#GG0000", "#12345678", "", " #FFFFFF"] ) {
    assert.equal(isProfileVerificationColor(invalid), false, invalid);
  }

  for (const status of PROFILE_VERIFICATION_BADGE_STATUSES) {
    for (const mode of ["light", "dark"] as const) {
      const broken = validConfig();
      const copy = broken.copy as { account_card: Record<string, { icon_color: Record<string, string> }> };
      copy.account_card[status].icon_color[mode] = "red";
      assert.equal(normalizeProfileVerificationConfig(broken), null, `${status}.${mode}`);
    }
  }
});

test("missing locales, prompt reorder and disabling either head turn fail the whole document", () => {
  const missingLocale = validConfig();
  delete ((missingLocale.copy as { intro: { title: Record<string, string> } }).intro.title.hu);
  assert.equal(normalizeProfileVerificationConfig(missingLocale), null);

  const reordered = validConfig();
  const prompts = reordered.prompts as Array<Record<string, unknown>>;
  [prompts[0], prompts[1]] = [prompts[1], prompts[0]];
  assert.equal(normalizeProfileVerificationConfig(reordered), null);

  for (const key of ["turn_left", "turn_right"]) {
    const broken = validConfig();
    const row = (broken.prompts as Array<Record<string, unknown>>).find((entry) => entry.key === key)!;
    row.enabled = false;
    assert.equal(normalizeProfileVerificationConfig(broken), null);
  }
});

test("queue parsing distinguishes a proven empty list from malformed success", () => {
  assert.deepEqual(profileVerificationQueue({
    items: [], has_more: false, next_before_millis: null, next_before_uid: null,
  }), {
    items: [], has_more: false, next_before_millis: null, next_before_uid: null,
  });
  assert.equal(profileVerificationQueue(validQueue())?.items[0]?.uid, 42);

  const paged = {
    ...validQueue(),
    has_more: true,
    next_before_millis: 1_786_300_100_123,
    next_before_uid: 42,
  };
  assert.equal(profileVerificationQueue(paged)?.next_before_uid, 42);
  assert.equal(profileVerificationQueue({ ...paged, next_before_uid: null }), null);

  const unknown = validQueue();
  unknown.items[0].status = "invented";
  assert.equal(profileVerificationQueue(unknown), null);
  const missing = validQueue() as Record<string, unknown>;
  delete missing.items;
  assert.equal(profileVerificationQueue(missing), null);
});

test("detail parsing preserves private comparison metadata and rejects malformed evidence flags", () => {
  const parsed = profileVerificationDetail(validDetail());
  assert.ok(parsed);
  assert.equal(parsed.case?.identity_snapshot.birthday, 631152000);
  assert.equal(parsed.submission?.actions[1], "smile");
  assert.equal(parsed.user.current_avatar_url?.startsWith("https://pic.freelove.hu/"), true);
  assert.equal(parsed.history.length, 1);

  const broken = validDetail();
  broken.submission.has_video = "yes" as unknown as boolean;
  assert.equal(profileVerificationDetail(broken), null);

  const insecureAvatar = validDetail();
  insecureAvatar.user.current_avatar_url = "http://pic.freelove.hu/avatar.jpeg";
  assert.equal(profileVerificationDetail(insecureAvatar), null);
});

test("detail parsing tolerates PHP empty-map arrays without accepting populated lists", () => {
  const bridged = validDetail();
  bridged.submission.client_diagnostics = [] as unknown as Record<string, unknown>;
  bridged.history[0].metadata = [] as unknown as Record<string, unknown>;
  const parsed = profileVerificationDetail(bridged);
  assert.ok(parsed);
  assert.deepEqual(parsed.submission?.client_diagnostics, {});
  assert.deepEqual(parsed.history[0]?.metadata, {});

  const malformed = validDetail();
  malformed.history[0].metadata = ["unexpected"] as unknown as Record<string, unknown>;
  assert.equal(profileVerificationDetail(malformed), null);
});

test("evidence URLs accept only opaque case IDs and a closed kind", () => {
  const caseId = "a".repeat(32);
  assert.equal(
    profileVerificationEvidenceUrl(caseId, "video"),
    `/api/admin/profile-verification-evidence?case_id=${caseId}&kind=video`,
  );
  assert.equal(profileVerificationEvidenceUrl("../secret", "video"), "");
});

test("the existing Configuration route owns the editor and the queue has its own navigation entry", async () => {
  const [configuration, shell, evidenceRoute] = await Promise.all([
    readFile(new URL("../app/(dashboard)/configuration/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/Shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/profile-verification-evidence/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(configuration, /ProfileVerificationConfiguration/);
  assert.match(shell, /href: "\/profile-verification"/);
  assert.match(evidenceRoute, /requireAdminWriter/);
  assert.match(evidenceRoute, /Cache-Control.*private, no-store/s);
  assert.match(evidenceRoute, /Cross-Origin-Resource-Policy/);
});
