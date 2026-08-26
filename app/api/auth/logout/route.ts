import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, adminCookieOptions, revokeCurrentAdminSession } from "@/lib/session";
import { isSameOrigin } from "@/lib/requestGuard";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request.headers)) {
    return NextResponse.json({ ok: false, error: "bad-origin" }, { status: 403 });
  }
  // Clearing the cookie only instructs this one browser to forget the token.
  // Revoking the nonce is what makes a captured copy stop working here.
  await revokeCurrentAdminSession();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, "", adminCookieOptions(0));
  return response;
}
