import { NextRequest, NextResponse } from "next/server";
import { coreCall } from "@/lib/core";
import { isSameOrigin } from "@/lib/requestGuard";
import {
  authAddressThrottle,
  clientAddress,
  requestCodeCallerThrottle,
  requestCodeFailure,
  readBoundedJsonObject,
  throttleKey,
} from "@/lib/authPolicy";

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
  const body = await readBoundedJsonObject(request);
  if (body.kind === "too-large") {
    return NextResponse.json({ ok: false, error: "too-large" }, { status: 413 });
  }
  if (body.kind === "ok") {
    email = String(body.value.email ?? "").trim().toLowerCase().slice(0, 320);
  }
  const perCaller = requestCodeCallerThrottle.check(throttleKey(address, email));
  if (!perCaller.allowed) return throttled(perCaller.retryAfterSeconds);

  const result = await coreCall<{ success?: boolean; error?: string }>("request_code", { email });
  if (result.status === 200 && result.data?.success) {
    return NextResponse.json({ ok: true });
  }
  // The specific Core outcome stays in the server log; the caller sees one answer.
  console.warn(
    `webadmin.request_code_failed status=${result.status} error=${result.data?.error ?? "none"}`,
  );
  const failure = requestCodeFailure(result.status, result.data?.error);
  return NextResponse.json({ ok: false, error: failure.error }, { status: failure.status });
}
