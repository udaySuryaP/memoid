import {
  AUTH_FLOW_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  clearHostCookie,
  createOpaqueSessionCredential,
  hashSessionCredential,
  hashStepUpNonce,
  serializeSessionCookie,
  unsealAuthFlowState,
} from "@memoid/security";
import { NextResponse } from "next/server";
import { authRuntime, requestCookie } from "../../../lib/auth-runtime";

export async function GET(request: Request) {
  const runtime = authRuntime();
  const fail = (path: string) => {
    const response = NextResponse.redirect(new URL(path, runtime.origin), 303);
    response.headers.append("Set-Cookie", clearHostCookie(AUTH_FLOW_COOKIE_NAME));
    response.headers.set("Cache-Control", "no-store");
    return response;
  };
  try {
    const url = new URL(request.url);
    const flowValue = requestCookie(request, AUTH_FLOW_COOKIE_NAME);
    const flow = flowValue ? unsealAuthFlowState(flowValue, runtime.flowSecret) : null;
    const code = url.searchParams.get("code");
    if (!flow || !code || url.searchParams.get("state") !== flow.state)
      return fail("/protected-error");

    const userAgent = request.headers.get("user-agent");
    const identity = await runtime.provider.exchangeAuthorizationCode({
      code,
      codeVerifier: flow.codeVerifier,
      ...(userAgent ? { userAgent } : {}),
    });
    if (!identity.emailVerified) return fail("/auth/verify");
    if (identity.impersonated) return fail("/protected-error");

    const credential = createOpaqueSessionCredential();
    let returnPath = flow.returnPath;
    if (flow.stepUpIntentId && flow.stepUpNonce) {
      const oldToken = requestCookie(request, SESSION_COOKIE_NAME);
      if (!oldToken) return fail("/auth/access");
      const completed = await runtime.sessions.completeStepUp(identity, {
        oldTokenHash: hashSessionCredential(oldToken),
        nonceHash: hashStepUpNonce(flow.stepUpNonce),
        intentId: flow.stepUpIntentId,
        newTokenHash: credential.hash,
      });
      returnPath = completed.returnPath;
    } else {
      await runtime.sessions.create(identity, credential.hash);
    }
    const response = NextResponse.redirect(new URL(returnPath, runtime.origin), 303);
    response.headers.append("Set-Cookie", clearHostCookie(AUTH_FLOW_COOKIE_NAME));
    response.headers.append("Set-Cookie", serializeSessionCookie(credential.token, 24 * 60 * 60));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return fail("/protected-error");
  } finally {
    await runtime.sessions.close();
  }
}
