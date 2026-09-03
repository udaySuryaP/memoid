import { SESSION_COOKIE_NAME, clearHostCookie, hashSessionCredential } from "@memoid/security";
import { type NextRequest, NextResponse } from "next/server";
import { authRuntime, requestCookie } from "./lib/auth-runtime";

export async function proxy(request: NextRequest) {
  const runtime = authRuntime();
  try {
    const token = requestCookie(request, SESSION_COOKIE_NAME);
    if (!token) return accessRedirect(request, false);
    let hash: Buffer;
    try {
      hash = hashSessionCredential(token);
    } catch {
      return accessRedirect(request, true);
    }
    const session = await runtime.sessions.authenticate(hash);
    if (!session) return accessRedirect(request, true);
    if (session.providerRecheckRequired) {
      const active = await runtime.provider.isProviderSessionActive(
        session.providerSubject,
        session.providerSessionId,
      );
      await runtime.sessions.markProviderState(hash, active, session.providerExpiresAt);
      if (!active) return accessRedirect(request, true);
    }
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/protected-error", request.url), 303);
  } finally {
    await runtime.sessions.close();
  }
}

function accessRedirect(request: NextRequest, clear: boolean) {
  const target = new URL("/auth/access", request.url);
  target.searchParams.set("return", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  const response = NextResponse.redirect(target, 303);
  if (clear) response.headers.append("Set-Cookie", clearHostCookie(SESSION_COOKIE_NAME));
  return response;
}

export const config = { matcher: ["/account/:path*", "/projects/:path*", "/step-up"] };
