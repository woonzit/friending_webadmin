import { NextRequest, NextResponse } from "next/server";
import { coreCall } from "@/lib/core";
import { isSameOrigin } from "@/lib/requestGuard";
import { isVerificationCodeComplete } from "@/lib/authCode";
import {
  authAddressThrottle,
  clientAddress,
  readBoundedJsonObject,
  throttleKey,
  verifyCodeCallerThrottle,
  verifyCodeFailure,
} from "@/lib/authPolicy";
import {
  ADMIN_COOKIE,
  adminCookieOptions,
  issueAdminSession,
} from "@/lib/session";

export const dynamic = "force-dynamic";

function throttled(retryAfterSeconds: number) {
  return NextResponse.json(
    { ok: false, error: "rate-limited" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request.headers)) {
    return NextResponse.json({ ok: false, error: "bad-origin" }, { status: 403 });
  }
  const address = clientAddress(request.headers);
  if (address !== "") {
    const perAddress = authAddressThrottle.check(address);
    if (!perAddress.allowed) return throttled(perAddress.retryAfterSeconds);
  }

  let email = "";
  let code = "";
  const body = await readBoundedJsonObject(request);
  if (body.kind === "too-large") {
    return NextResponse.json({ ok: false, error: "too-large" }, { status: 413 });
  }
  if (body.kind === "ok") {
    email = String(body.value.email ?? "").trim().toLowerCase().slice(0, 320);
    code = String(body.value.code ?? "");
  }
  if (!email || !isVerificationCodeComplete(code)) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 401 });
  }
  const perCaller = verifyCodeCallerThrottle.check(throttleKey(address, email));
  if (!perCaller.allowed) return throttled(perCaller.retryAfterSeconds);

  const result = await coreCall<{ success?: boolean; email?: string; error?: string }>(
    "verify_code",
    { email, code },
  );
  if (result.status !== 200 || !result.data?.success || !result.data.email) {
    // Core separates "not an administrator", "no outstanding code" and "wrong
    // code"; the caller must not be able to tell them apart. The distinction
    // survives only in this server-side log line.
    console.warn(
      `webadmin.verify_code_failed status=${result.status} error=${result.data?.error ?? "none"}`,
    );
    const failure = verifyCodeFailure(result.status, result.data?.error);
    return NextResponse.json({ ok: false, error: failure.error }, { status: failure.status });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    ADMIN_COOKIE,
    issueAdminSession(String(result.data.email)),
    adminCookieOptions(),
  );
  return response;
}
