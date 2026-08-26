/** Typed browser boundary for Profile Video Verification V1. */

export const PROFILE_VERIFICATION_SCHEMA_VERSION = 1;
export const PROFILE_VERIFICATION_BADGE_STATUSES = [
  "not_started",
  "pending",
  "denied",
  "verified",
] as const;
export const PROFILE_VERIFICATION_STATUSES = [
  "not_started",
  "missing_requirements",
  "pending",
  "verified",
  "pending_re_review",
  "awaiting_avatar",
  "rejected",
  "new_video_requested",
] as const;
export const PROFILE_VERIFICATION_DETAIL_STATUSES = [
  "not_started",
  "missing_requirements",
  "pending",
  "verified",
  "pending_re_review",
  "awaiting_avatar",
  "rejected",
  "new_video_requested",
] as const;
export const PROFILE_VERIFICATION_PROMPTS = [
  "turn_left",
  "turn_right",
  "smile",
  "wink",
  "blink",
  "raise_eyebrows",
  "open_mouth",
] as const;
export const PROFILE_VERIFICATION_REJECTION_REASONS = [
  "face_mismatch",
  "face_not_visible",
  "multiple_people",
  "challenge_not_followed",
  "video_quality",
  "avatar_not_comparable",
  "suspected_replay",
  "other_policy_reason",
] as const;

export type ProfileVerificationBadgeStatus = (typeof PROFILE_VERIFICATION_BADGE_STATUSES)[number];
export type ProfileVerificationStatus = (typeof PROFILE_VERIFICATION_STATUSES)[number];
export type ProfileVerificationDetailStatus = (typeof PROFILE_VERIFICATION_DETAIL_STATUSES)[number];
export type ProfileVerificationPromptKey = (typeof PROFILE_VERIFICATION_PROMPTS)[number];
export type ProfileVerificationLocalizedText = { en: string; hu: string };
export type ProfileVerificationIconColor = { light: string; dark: string };

export type ProfileVerificationAccountCard = {
  title: ProfileVerificationLocalizedText;
  subtitle: ProfileVerificationLocalizedText;
  icon_color: ProfileVerificationIconColor;
};

export type ProfileVerificationConfig = {
  config: "profile_video_verification";
  schema_version: 1;
  revision: number;
  enabled: boolean;
  copy: {
    intro: {
      title: ProfileVerificationLocalizedText;
      body: ProfileVerificationLocalizedText;
      steps: Array<{
        key: string;
        title: ProfileVerificationLocalizedText;
        body: ProfileVerificationLocalizedText;
      }>;
      action: ProfileVerificationLocalizedText;
    };
    camera: {
      title: ProfileVerificationLocalizedText;
      framing: ProfileVerificationLocalizedText;
      ready: ProfileVerificationLocalizedText;
      recording: ProfileVerificationLocalizedText;
    };
    preview: {
      title: ProfileVerificationLocalizedText;
      body: ProfileVerificationLocalizedText;
      retake: ProfileVerificationLocalizedText;
      submit: ProfileVerificationLocalizedText;
    };
    account_card: Record<ProfileVerificationBadgeStatus, ProfileVerificationAccountCard>;
    status: Record<ProfileVerificationDetailStatus, {
      title: ProfileVerificationLocalizedText;
      subtitle: ProfileVerificationLocalizedText;
    }>;
    consent: {
      body: ProfileVerificationLocalizedText;
      link_title: ProfileVerificationLocalizedText;
      link_url: string;
    };
  };
  prompts: Array<{
    key: ProfileVerificationPromptKey;
    enabled: boolean;
    label: ProfileVerificationLocalizedText;
  }>;
  updated_at: number | null;
  updated_by: string;
};

export type ProfileVerificationQueueItem = {
  uid: number;
  status: ProfileVerificationStatus;
  case_id: string;
  submission_id: string;
  trigger: string;
  display_name: string;
  gender: string;
  avatar_available: boolean;
  birthday: number | null;
  submitted_at: number | null;
  updated_at: number | null;
  lease_owner: string | null;
  lease_expires_at: number | null;
};

export type ProfileVerificationQueue = {
  items: ProfileVerificationQueueItem[];
  has_more: boolean;
  next_before_millis: number | null;
  next_before_uid: number | null;
};

export type ProfileVerificationCase = {
  case_id: string;
  uid: number;
  submission_id: string;
  trigger: string;
  avatar_hash: string;
  has_avatar_snapshot: boolean;
  identity_snapshot: { display_name: string; gender: string; birthday: number | null };
  status: string;
  revision: number;
  lease_owner: string | null;
  lease_expires_at: number | null;
  decision: string | null;
  decision_reason: string | null;
  decision_note: string | null;
  decided_by: string | null;
  decided_at: number | null;
  created_at: number | null;
  updated_at: number | null;
};

export type ProfileVerificationDetail = {
  state: {
    uid: number;
    status: ProfileVerificationStatus;
    revision: number;
    active_submission_id: string;
    active_case_id: string;
    current_avatar_hash: string;
    approved_avatar_hash: string;
    submitted_at: number | null;
    last_decision_at: number | null;
    last_rejection_reason: string | null;
    updated_trigger: string;
    updated_at: number | null;
  };
  case: ProfileVerificationCase | null;
  submission: null | {
    submission_id: string;
    challenge_id: string;
    config_revision: number;
    consent_revision: number;
    sha256: string;
    bytes: number;
    mime: string;
    duration_seconds: number;
    width: number;
    height: number;
    codec: string;
    audio: boolean;
    actions: string[];
    client_diagnostics: Record<string, unknown>;
    lifecycle: string;
    has_video: boolean;
    created_at: number | null;
  };
  user: {
    uid: number;
    display_name: string;
    gender: string;
    birthday: number | null;
    current_avatar_hash: string;
    current_avatar_url: string | null;
  };
  history: Array<{
    event_id: string;
    event_type: string;
    submission_id: string;
    case_id: string;
    actor_kind: string;
    actor_id: string;
    previous_status: string;
    new_status: string;
    previous_avatar_hash: string;
    new_avatar_hash: string;
    reason: string;
    metadata: Record<string, unknown>;
    created_at: number | null;
  }>;
};

const CONTROL = /[\u0000-\u001F\u007F]/u;
const MACHINE_KEY = /^[a-z][a-z0-9_]{0,47}$/;
const IDENTIFIER = /^[a-f0-9]{32}$/;
const STATUS_SET: ReadonlySet<string> = new Set(PROFILE_VERIFICATION_STATUSES);
const PROMPT_SET: ReadonlySet<string> = new Set(PROFILE_VERIFICATION_PROMPTS);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function phpObjectMap(value: unknown): Record<string, unknown> | null {
  // PHP's json_encode turns an empty associative map into [] unless Core
  // explicitly wraps it as stdClass. Accept only that empty-list bridge shape;
  // non-empty arrays are still malformed for object-map fields.
  if (Array.isArray(value)) return value.length === 0 ? {} : null;
  return record(value);
}

function list(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function integer(value: unknown, minimum = 0): number | null {
  return Number.isInteger(value) && Number(value) >= minimum ? Number(value) : null;
}

function finite(value: unknown, minimum = 0): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum ? value : null;
}

function boundedText(value: unknown, maximum: number, allowEmpty = false): string | null {
  if (typeof value !== "string" || value.trim() !== value || CONTROL.test(value)) return null;
  if ((!allowEmpty && value === "") || Array.from(value).length > maximum) return null;
  return value;
}

function nullableText(value: unknown, maximum: number): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const parsed = boundedText(value, maximum);
  return parsed === null ? undefined : parsed;
}

function epoch(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  return integer(value);
}

function localized(value: unknown, maximum: number): ProfileVerificationLocalizedText | null {
  const row = record(value);
  if (!row) return null;
  const en = boundedText(row.en, maximum);
  const hu = boundedText(row.hu, maximum);
  return en === null || hu === null ? null : { en, hu };
}

export function isProfileVerificationColor(value: string): boolean {
  return /^#[0-9A-F]{6}$/.test(value.toUpperCase());
}

function color(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const upper = value.toUpperCase();
  return isProfileVerificationColor(upper) ? upper : null;
}

function iconColor(value: unknown): ProfileVerificationIconColor | null {
  const row = record(value);
  if (!row) return null;
  const light = color(row.light);
  const dark = color(row.dark);
  return light && dark ? { light, dark } : null;
}

function httpsUrl(value: unknown): string | null {
  const text = boundedText(value, 2048);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? text : null;
  } catch {
    return null;
  }
}

export function normalizeProfileVerificationConfig(value: unknown): ProfileVerificationConfig | null {
  const source = record(value);
  const copy = record(source?.copy);
  const intro = record(copy?.intro);
  const camera = record(copy?.camera);
  const preview = record(copy?.preview);
  const account = record(copy?.account_card);
  const statuses = record(copy?.status);
  const consent = record(copy?.consent);
  const revision = integer(source?.revision);
  const updatedAt = epoch(source?.updated_at);
  if (
    source?.config !== "profile_video_verification"
    || source.schema_version !== PROFILE_VERIFICATION_SCHEMA_VERSION
    || revision === null
    || typeof source.enabled !== "boolean"
    || !copy || !intro || !camera || !preview || !account || !statuses || !consent
    || updatedAt === undefined
  ) return null;

  const introTitle = localized(intro.title, 180);
  const introBody = localized(intro.body, 1200);
  const introAction = localized(intro.action, 120);
  const rawSteps = list(intro.steps);
  if (!introTitle || !introBody || !introAction || !rawSteps || rawSteps.length < 1 || rawSteps.length > 4) return null;
  const seenStepKeys = new Set<string>();
  const steps: ProfileVerificationConfig["copy"]["intro"]["steps"] = [];
  for (const raw of rawSteps) {
    const row = record(raw);
    const key = boundedText(row?.key, 48);
    const title = localized(row?.title, 180);
    const body = localized(row?.body, 700);
    if (!key || !MACHINE_KEY.test(key) || seenStepKeys.has(key) || !title || !body) return null;
    seenStepKeys.add(key);
    steps.push({ key, title, body });
  }

  const cameraTitle = localized(camera.title, 180);
  const cameraFraming = localized(camera.framing, 320);
  const cameraReady = localized(camera.ready, 120);
  const cameraRecording = localized(camera.recording, 240);
  const previewTitle = localized(preview.title, 180);
  const previewBody = localized(preview.body, 700);
  const previewRetake = localized(preview.retake, 120);
  const previewSubmit = localized(preview.submit, 120);
  if (!cameraTitle || !cameraFraming || !cameraReady || !cameraRecording
    || !previewTitle || !previewBody || !previewRetake || !previewSubmit) return null;

  const accountCards = {} as Record<ProfileVerificationBadgeStatus, ProfileVerificationAccountCard>;
  for (const status of PROFILE_VERIFICATION_BADGE_STATUSES) {
    const row = record(account[status]);
    const title = localized(row?.title, 160);
    const subtitle = localized(row?.subtitle, 320);
    const colors = iconColor(row?.icon_color);
    if (!title || !subtitle || !colors) return null;
    accountCards[status] = { title, subtitle, icon_color: colors };
  }

  const statusCopy = {} as ProfileVerificationConfig["copy"]["status"];
  for (const status of PROFILE_VERIFICATION_DETAIL_STATUSES) {
    const row = record(statuses[status]);
    const title = localized(row?.title, 180);
    const subtitle = localized(row?.subtitle, 500);
    if (!title || !subtitle) return null;
    statusCopy[status] = { title, subtitle };
  }

  const consentBody = localized(consent.body, 1800);
  const consentLinkTitle = localized(consent.link_title, 180);
  const consentLinkUrl = httpsUrl(consent.link_url);
  if (!consentBody || !consentLinkTitle || !consentLinkUrl) return null;

  const rawPrompts = list(source.prompts);
  if (!rawPrompts || rawPrompts.length !== PROFILE_VERIFICATION_PROMPTS.length) return null;
  const prompts: ProfileVerificationConfig["prompts"] = [];
  for (let index = 0; index < PROFILE_VERIFICATION_PROMPTS.length; index += 1) {
    const row = record(rawPrompts[index]);
    const key = boundedText(row?.key, 48);
    const label = localized(row?.label, 180);
    if (key !== PROFILE_VERIFICATION_PROMPTS[index] || !PROMPT_SET.has(key) || typeof row?.enabled !== "boolean" || !label) return null;
    if (["turn_left", "turn_right"].includes(key) && row.enabled !== true) return null;
    prompts.push({ key: key as ProfileVerificationPromptKey, enabled: row.enabled, label });
  }

  const updatedBy = boundedText(source.updated_by ?? "", 320, true);
  if (updatedBy === null) return null;
  return {
    config: "profile_video_verification",
    schema_version: 1,
    revision,
    enabled: source.enabled,
    copy: {
      intro: { title: introTitle, body: introBody, steps, action: introAction },
      camera: { title: cameraTitle, framing: cameraFraming, ready: cameraReady, recording: cameraRecording },
      preview: { title: previewTitle, body: previewBody, retake: previewRetake, submit: previewSubmit },
      account_card: accountCards,
      status: statusCopy,
      consent: { body: consentBody, link_title: consentLinkTitle, link_url: consentLinkUrl },
    },
    prompts,
    updated_at: updatedAt,
    updated_by: updatedBy,
  };
}

export function profileVerificationSavePayload(config: ProfileVerificationConfig): Record<string, unknown> {
  return {
    enabled: config.enabled,
    copy: config.copy,
    prompts: config.prompts,
  };
}

export function cloneProfileVerificationConfig(config: ProfileVerificationConfig): ProfileVerificationConfig {
  return JSON.parse(JSON.stringify(config)) as ProfileVerificationConfig;
}

export function profileVerificationQueue(value: unknown): ProfileVerificationQueue | null {
  const source = record(value);
  const rawItems = list(source?.items);
  if (!source || !rawItems || typeof source.has_more !== "boolean") return null;
  const next = epoch(source.next_before_millis);
  const nextUid = epoch(source.next_before_uid);
  if (next === undefined || nextUid === undefined
    || source.has_more !== (next !== null && nextUid !== null)) return null;
  const items: ProfileVerificationQueueItem[] = [];
  for (const raw of rawItems) {
    const row = record(raw);
    const uid = integer(row?.uid, 1);
    const status = boundedText(row?.status, 80);
    const birthday = epoch(row?.birthday);
    const submittedAt = epoch(row?.submitted_at);
    const updatedAt = epoch(row?.updated_at);
    const leaseExpiresAt = epoch(row?.lease_expires_at);
    const leaseOwner = nullableText(row?.lease_owner, 320);
    if (!row || uid === null || !status || !STATUS_SET.has(status)
      || typeof row.avatar_available !== "boolean" || birthday === undefined
      || submittedAt === undefined || updatedAt === undefined || leaseExpiresAt === undefined
      || leaseOwner === undefined) return null;
    const caseId = boundedText(row.case_id ?? "", 32, true);
    const submissionId = boundedText(row.submission_id ?? "", 32, true);
    const trigger = boundedText(row.trigger ?? "", 80, true);
    const displayName = boundedText(row.display_name ?? "", 180, true);
    const gender = boundedText(row.gender ?? "", 80, true);
    if (caseId === null || (caseId !== "" && !IDENTIFIER.test(caseId)) || submissionId === null
      || trigger === null || displayName === null || gender === null) return null;
    items.push({
      uid,
      status: status as ProfileVerificationStatus,
      case_id: caseId,
      submission_id: submissionId,
      trigger,
      display_name: displayName,
      gender,
      avatar_available: row.avatar_available,
      birthday,
      submitted_at: submittedAt,
      updated_at: updatedAt,
      lease_owner: leaseOwner,
      lease_expires_at: leaseExpiresAt,
    });
  }
  return {
    items,
    has_more: source.has_more,
    next_before_millis: next,
    next_before_uid: nextUid,
  };
}

function verificationCase(value: unknown): ProfileVerificationCase | null | undefined {
  if (value === null) return null;
  const row = record(value);
  const identity = record(row?.identity_snapshot);
  if (!row || !identity) return undefined;
  const caseId = boundedText(row.case_id, 32);
  const uid = integer(row.uid, 1);
  const revision = integer(row.revision, 1);
  const birthday = epoch(identity.birthday);
  const fields = ["submission_id", "trigger", "avatar_hash", "status"] as const;
  const texts = fields.map((key) => boundedText(row[key] ?? "", key === "avatar_hash" ? 200 : 80, key === "avatar_hash"));
  const identityName = boundedText(identity.display_name ?? "", 180, true);
  const identityGender = boundedText(identity.gender ?? "", 80, true);
  const nullableFields = ["lease_owner", "decision", "decision_reason", "decision_note", "decided_by"] as const;
  const nullableValues = nullableFields.map((key) => nullableText(row[key], key === "decision_note" ? 1000 : 320));
  const dateFields = ["lease_expires_at", "decided_at", "created_at", "updated_at"] as const;
  const dates = dateFields.map((key) => epoch(row[key]));
  if (!caseId || !IDENTIFIER.test(caseId) || uid === null || revision === null || birthday === undefined
    || texts.some((entry) => entry === null) || identityName === null || identityGender === null
    || nullableValues.some((entry) => entry === undefined) || dates.some((entry) => entry === undefined)
    || typeof row.has_avatar_snapshot !== "boolean") return undefined;
  return {
    case_id: caseId,
    uid,
    submission_id: texts[0] as string,
    trigger: texts[1] as string,
    avatar_hash: texts[2] as string,
    has_avatar_snapshot: row.has_avatar_snapshot,
    identity_snapshot: { display_name: identityName, gender: identityGender, birthday },
    status: texts[3] as string,
    revision,
    lease_owner: nullableValues[0] as string | null,
    lease_expires_at: dates[0] as number | null,
    decision: nullableValues[1] as string | null,
    decision_reason: nullableValues[2] as string | null,
    decision_note: nullableValues[3] as string | null,
    decided_by: nullableValues[4] as string | null,
    decided_at: dates[1] as number | null,
    created_at: dates[2] as number | null,
    updated_at: dates[3] as number | null,
  };
}

export function profileVerificationDetail(value: unknown): ProfileVerificationDetail | null {
  const source = record(value);
  const state = record(source?.state);
  const user = record(source?.user);
  const parsedCase = verificationCase(source?.case);
  const rawHistory = list(source?.history);
  if (!source || !state || !user || parsedCase === undefined || !rawHistory) return null;
  const stateUid = integer(state.uid, 1);
  const stateRevision = integer(state.revision);
  const stateStatus = boundedText(state.status, 80);
  const stateDates = [state.submitted_at, state.last_decision_at, state.updated_at].map(epoch);
  const stateTexts = [
    state.active_submission_id, state.active_case_id, state.current_avatar_hash,
    state.approved_avatar_hash, state.updated_trigger,
  ].map((entry) => boundedText(entry ?? "", 200, true));
  const lastReason = nullableText(state.last_rejection_reason, 80);
  if (stateUid === null || stateRevision === null || !stateStatus || !STATUS_SET.has(stateStatus)
    || stateDates.some((entry) => entry === undefined) || stateTexts.some((entry) => entry === null)
    || lastReason === undefined) return null;

  const userUid = integer(user.uid, 1);
  const userBirthday = epoch(user.birthday);
  const userName = boundedText(user.display_name ?? "", 180, true);
  const userGender = boundedText(user.gender ?? "", 80, true);
  const userHash = boundedText(user.current_avatar_hash ?? "", 200, true);
  let userUrl: string | null;
  if (user.current_avatar_url === null) {
    userUrl = null;
  } else {
    userUrl = httpsUrl(user.current_avatar_url);
    if (!userUrl) return null;
  }
  if (userUid === null || userBirthday === undefined || userName === null || userGender === null
    || userHash === null) return null;

  let submission: ProfileVerificationDetail["submission"] = null;
  if (source.submission !== null) {
    const row = record(source.submission);
    const actions = list(row?.actions);
    const diagnostics = phpObjectMap(row?.client_diagnostics);
    if (!row || !actions || !diagnostics || typeof row.audio !== "boolean" || typeof row.has_video !== "boolean") return null;
    const identifiers = ["submission_id", "challenge_id", "sha256", "mime", "codec", "lifecycle"] as const;
    const values = identifiers.map((key) => boundedText(row[key] ?? "", key === "sha256" ? 64 : 120, true));
    const numeric = [row.config_revision, row.consent_revision, row.bytes, row.width, row.height].map(integer);
    const duration = finite(row.duration_seconds);
    const createdAt = epoch(row.created_at);
    const parsedActions = actions.map((entry) => boundedText(entry, 48)).filter((entry): entry is string => entry !== null);
    if (values.some((entry) => entry === null) || numeric.some((entry) => entry === null)
      || duration === null || createdAt === undefined || parsedActions.length !== actions.length) return null;
    submission = {
      submission_id: values[0] as string,
      challenge_id: values[1] as string,
      config_revision: numeric[0] as number,
      consent_revision: numeric[1] as number,
      sha256: values[2] as string,
      bytes: numeric[2] as number,
      mime: values[3] as string,
      duration_seconds: duration,
      width: numeric[3] as number,
      height: numeric[4] as number,
      codec: values[4] as string,
      audio: row.audio,
      actions: parsedActions,
      client_diagnostics: diagnostics,
      lifecycle: values[5] as string,
      has_video: row.has_video,
      created_at: createdAt,
    };
  }

  const history: ProfileVerificationDetail["history"] = [];
  for (const raw of rawHistory) {
    const row = record(raw);
    if (!row) return null;
    const keys = ["event_id", "event_type", "submission_id", "case_id", "actor_kind", "actor_id", "previous_status", "new_status", "previous_avatar_hash", "new_avatar_hash", "reason"] as const;
    const values = keys.map((key) => boundedText(row[key] ?? "", key.includes("hash") ? 200 : 320, true));
    const metadata = phpObjectMap(row.metadata);
    const createdAt = epoch(row.created_at);
    if (values.some((entry) => entry === null) || !metadata || createdAt === undefined) return null;
    history.push({
      event_id: values[0] as string,
      event_type: values[1] as string,
      submission_id: values[2] as string,
      case_id: values[3] as string,
      actor_kind: values[4] as string,
      actor_id: values[5] as string,
      previous_status: values[6] as string,
      new_status: values[7] as string,
      previous_avatar_hash: values[8] as string,
      new_avatar_hash: values[9] as string,
      reason: values[10] as string,
      metadata,
      created_at: createdAt,
    });
  }

  return {
    state: {
      uid: stateUid,
      status: stateStatus as ProfileVerificationStatus,
      revision: stateRevision,
      active_submission_id: stateTexts[0] as string,
      active_case_id: stateTexts[1] as string,
      current_avatar_hash: stateTexts[2] as string,
      approved_avatar_hash: stateTexts[3] as string,
      submitted_at: stateDates[0] as number | null,
      last_decision_at: stateDates[1] as number | null,
      last_rejection_reason: lastReason,
      updated_trigger: stateTexts[4] as string,
      updated_at: stateDates[2] as number | null,
    },
    case: parsedCase,
    submission,
    user: {
      uid: userUid,
      display_name: userName,
      gender: userGender,
      birthday: userBirthday,
      current_avatar_hash: userHash,
      current_avatar_url: userUrl,
    },
    history,
  };
}

export function profileVerificationEvidenceUrl(caseId: string, kind: "video" | "avatar_snapshot"): string {
  if (!IDENTIFIER.test(caseId)) return "";
  return `/api/admin/profile-verification-evidence?case_id=${encodeURIComponent(caseId)}&kind=${kind}`;
}

export function profileVerificationResponseData(response: unknown): unknown {
  return record(response)?.data;
}
