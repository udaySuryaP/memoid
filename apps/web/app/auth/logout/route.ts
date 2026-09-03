import {
  SESSION_COOKIE_NAME,
  clearHostCookie,
  hashSessionCredential,
  isAllowedMutationOrigin,
} from "@memoid/security";
import { NextResponse } from "next/server";
import { authRuntime, requestCookie } from "../../../lib/auth-runtime";

export async function POST(request: Request) {
  const runtime = authRuntime();
  try {
    if (!isAllowedMutationOrigin(request.headers.get("origin"), runtime.origin))
      return new NextResponse(null, { status: 403 });
    const token = requestCookie(request, SESSION_COOKIE_NAME);
    if (token) {
      let providerSessionId: string | null = null;
      try {
        providerSessionId = await runtime.sessions.revoke(
          hashSessionCredential(token),
          "USER_LOGOUT",
        );
      } catch {
        // A malformed or already-invalid local credential still receives a cleared cookie.
      }
      if (providerSessionId) await runtime.provider.revokeProviderSession(providerSessionId);
    }
    const response = NextResponse.redirect(new URL("/auth/access", runtime.origin), 303);
    response.headers.append("Set-Cookie", clearHostCookie(SESSION_COOKIE_NAME));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } finally {
    await runtime.sessions.close();
  }
}
