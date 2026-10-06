import { classifyAdminMembership } from "@/lib/adminMembership";
import { webadminErrorEnvelope } from "@/lib/webadminEnvelope";

/** An attempted action may have run: never label these errors as pre-forward refusals. */
export function adminPostForwardError(result: { status: number; data: unknown }, email: string, abandoned = false):
  { status: number; error: string } | null {
  if (abandoned) return { status: 502, error: "core-timeout" };
  if (classifyAdminMembership(result, email).kind === "revoked") return { status: 401, error: "auth-required" };
  const denied = webadminErrorEnvelope(result.data);
  if (result.status === 403 && denied?.status_code === 403
    && (denied.error === "admin-write-required" || denied.error === "owner-required")) {
    return { status: 403, error: denied.error };
  }
  const namedRefusal = denied ?? webadminErrorEnvelope(result.data, "required");
  if (result.status >= 500 && namedRefusal?.status_code === result.status) {
    // As on the generic bridge, the feature owns settlement. Preserving a
    // complete named refusal is NOT proof that the attempted write did not run.
    return { status: result.status, error: namedRefusal.error };
  }
  if (result.status === 401 || result.status === 403 || result.status >= 500) {
    const data = result.data as { success?: unknown; error?: unknown } | null;
    const error = data?.success === false && (data.error === "core-timeout" || data.error === "core-unavailable") ? data.error : "invalid-core-response";
    return { status: 502, error };
  }
  // AUTH outcomes only. A feature can own `message` (support_send carries the
  // sent message object), and its success/validation shape is not membership.
  // Pass 2xx and existing non-auth refusals to the original feature handler.
  return null;
}
