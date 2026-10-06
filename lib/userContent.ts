import { ADMIN_REQUEST_OUTCOME_UNKNOWN } from "@/lib/adminMembershipClientError";

/** The admin editor shares the member's content revision chain. */
export type UserContentRevision = number | undefined | null;
export type UserContent = { headline: string; about: string; revision: number };
export type UserContentCall = (
  action: string,
  body: Record<string, unknown>,
) => Promise<{ success?: unknown; error?: unknown; [key: string]: unknown } | null>;

/** Older reads omit the revision. A present malformed value must not disable the fence. */
export function userContentRevision(value: unknown): UserContentRevision {
  if (value === undefined) return undefined;
  const parsed = typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value) ? Number(value) : value;
  return typeof parsed === "number" && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** A conflict needs both newer texts and their usable fence before another save is allowed. */
export async function readUserContent(call: UserContentCall, uid: number): Promise<UserContent | null> {
  const response = await call("user_detail", { uid });
  const profile = response?.success === true ? record(response.profile) : null;
  const revision = userContentRevision(profile?.content_revision);
  if (!profile || Number(profile.uid) !== uid || typeof revision !== "number"
    || typeof profile.headline !== "string" || typeof profile.about_me !== "string") return null;
  return { headline: profile.headline, about: profile.about_me, revision };
}

export type UserContentSaveResult =
  | { kind: "saved"; content: UserContent }
  | { kind: "conflict"; current: UserContent | null }
  | { kind: "failed"; errorKey: "contentRevisionInvalid" | "contentInvalid" | "contentSaveFailed" | "contentResponseInvalid" | "contentOutcomeUnknown" };

/** A conflict never resubmits or replaces the operator's draft; review belongs to the operator. */
export async function saveUserContent(
  call: UserContentCall,
  input: { uid: number; headline: string; about: string; revision: UserContentRevision },
): Promise<UserContentSaveResult> {
  if (input.revision === null) return { kind: "failed", errorKey: "contentRevisionInvalid" };
  const response = await call("admin_save_user_content", {
    uid: input.uid, headline: input.headline, about: input.about,
    ...(input.revision === undefined ? {} : { expected_revision: input.revision }),
  });
  if (response?.success !== true) {
    if (response?.error === ADMIN_REQUEST_OUTCOME_UNKNOWN) return { kind: "failed", errorKey: "contentOutcomeUnknown" };
    if (response?.error === "profile-content-conflict") {
      return { kind: "conflict", current: await readUserContent(call, input.uid) };
    }
    return { kind: "failed", errorKey: response?.error === "profile-content-revision-invalid"
      ? "contentRevisionInvalid" : response?.error === "profile-content-invalid" ? "contentInvalid" : "contentSaveFailed" };
  }
  const content = record(response.content);
  const revision = userContentRevision(content?.revision);
  if (!content || typeof content.headline !== "string" || typeof content.about_me !== "string"
    || typeof revision !== "number") return { kind: "failed", errorKey: "contentResponseInvalid" };
  return { kind: "saved", content: { headline: content.headline, about: content.about_me, revision } };
}
