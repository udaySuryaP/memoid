import { sealAuthFlowState, serializeAuthFlowCookie } from "@memoid/security";
import { NextResponse } from "next/server";
import { authRuntime, localReturnPath } from "../../../lib/auth-runtime";

export async function GET(request: Request) {
  const runtime = authRuntime();
  try {
    const url = new URL(request.url);
    const authorization = await runtime.provider.createAuthorizationRequest({
      redirectUri: `${runtime.origin}/auth/callback`,
      ...(url.searchParams.get("fresh") === "1" ? { maxAgeSeconds: 0 } : {}),
    });
    const sealed = sealAuthFlowState(
      {
        state: authorization.state,
        codeVerifier: authorization.codeVerifier,
        returnPath: localReturnPath(url.searchParams.get("return")),
        expiresAt: Date.now() + 10 * 60 * 1_000,
      },
      runtime.flowSecret,
    );
    const response = NextResponse.redirect(authorization.url, 303);
    response.headers.append("Set-Cookie", serializeAuthFlowCookie(sealed));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } finally {
    await runtime.sessions.close();
  }
}
