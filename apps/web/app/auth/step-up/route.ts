import {
  SESSION_COOKIE_NAME,
  createOpaqueStepUpNonce,
  hashSessionCredential,
  isAllowedMutationOrigin,
  sealAuthFlowState,
  serializeAuthFlowCookie,
} from "@memoid/security";
import { NextResponse } from "next/server";
import { authRuntime, requestCookie } from "../../../lib/auth-runtime";

export async function POST(request: Request) {
  const runtime = authRuntime();
  try {
    if (!isAllowedMutationOrigin(request.headers.get("origin"), runtime.origin))
      return new NextResponse(null, { status: 403 });
    const token = requestCookie(request, SESSION_COOKIE_NAME);
    if (!token) return NextResponse.redirect(new URL("/auth/access", runtime.origin), 303);
    let tokenHash: Buffer;
    try {
      tokenHash = hashSessionCredential(token);
    } catch {
      return NextResponse.redirect(new URL("/auth/access", runtime.origin), 303);
    }

    const nonce = createOpaqueStepUpNonce();
    const intentId = await runtime.sessions.createStepUp({
      tokenHash,
      nonceHash: nonce.hash,
      actionKey: "MANAGE_ACCOUNT_SECURITY",
      returnPath: "/account/security",
    });
    const authorization = await runtime.provider.createAuthorizationRequest({
      redirectUri: `${runtime.origin}/auth/callback`,
      maxAgeSeconds: 0,
    });
    const flow = sealAuthFlowState(
      {
        state: authorization.state,
        codeVerifier: authorization.codeVerifier,
        returnPath: "/account/security",
        stepUpIntentId: intentId,
        stepUpNonce: nonce.nonce,
        expiresAt: Date.now() + 10 * 60 * 1_000,
      },
      runtime.flowSecret,
    );
    const response = NextResponse.redirect(authorization.url, 303);
    response.headers.append("Set-Cookie", serializeAuthFlowCookie(flow));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } finally {
    await runtime.sessions.close();
  }
}
