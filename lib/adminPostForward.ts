import { classifyAdminMembership } from "@/lib/adminMembership";
import { webadminEnvelope, webadminErrorEnvelope } from "@/lib/webadminEnvelope";

/** An attempted action may have run: never label these errors as pre-forward refusals. */
export function adminPostForwardError(result: { status: number; data: unknown }, email: string, abandoned = false):
  { status: 401 | 403 | 502; error: string } | null {
  if (abandoned) return { status: 502, error: "core-timeout" };
  if (classifyAdminMembership(result, email).kind === "revoked") return { status: 401, error: "auth-required" };
  const denied = webadminErrorEnvelope(result.data);
  if (result.status === 403 && denied?.status_code === 403
    && (denied.error === "admin-write-required" || denied.error === "owner-required")) {
    return { status: 403, error: denied.error };
  }
  if (result.status === 401 || result.status === 403 || result.status >= 500) {
    const data = result.data as { success?: unknown; error?: unknown } | null;
    const error = data?.success === false && (data.error === "core-timeout" || data.error === "core-unavailable") ? data.error : "invalid-core-response";
    return { status: 502, error };
  }
  if (result.status >= 200 && result.status < 400) {
    const positive = webadminEnvelope(result.data, true, []);
    if (result.status !== 200 || positive?.status_code !== 200 || Object.hasOwn(result.data as object, "error")) {
      return { status: 502, error: "invalid-core-response" };
    }
  }
  // Existing named validation/conflict refusals (4xx other than auth) remain
  // the feature handler's responsibility; no feature vocabulary is changed.
  return null;
}
