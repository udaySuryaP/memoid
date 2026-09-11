import { parseUuidV7, type ProjectId } from "@memoid/domain/identifiers";
import {
  createOpaqueStepUpNonce,
  isAllowedMutationOrigin,
  sealAuthFlowState,
  serializeAuthFlowCookie,
} from "@memoid/security";
import { NextResponse } from "next/server";
import { authRuntime } from "../../../../../../lib/auth-runtime";
import { sourceAuthorityRuntime } from "../../../../../../lib/source-authority-runtime";

export async function POST(
  request: Request,
  { params }: { readonly params: Promise<{ projectId: string }> },
) {
  const { projectId: rawProjectId } = await params;
  const projectId = parseUuidV7(rawProjectId, "ProjectId") as ProjectId;
  const returnPath = `/projects/${projectId}/sources/authority`;
  const projectRuntime = await sourceAuthorityRuntime(returnPath);
  const auth = authRuntime();
  try {
    if (!isAllowedMutationOrigin(request.headers.get("origin"), auth.origin))
      return new NextResponse(null, { status: 403 });
    await projectRuntime.projectService.readProject(projectRuntime.context, projectId);
    const nonce = createOpaqueStepUpNonce();
    const intentId = await auth.sessions.createStepUp({
      tokenHash: projectRuntime.context.sessionCredentialHash,
      nonceHash: nonce.hash,
      actionKey: "MANAGE_SOURCE_AUTHORITY",
      workspaceId: projectRuntime.context.workspaceId,
      projectId,
      returnPath,
    });
    const authorization = await auth.provider.createAuthorizationRequest({
      redirectUri: `${auth.origin}/auth/callback`,
      maxAgeSeconds: 0,
    });
    const flow = sealAuthFlowState(
      {
        state: authorization.state,
        codeVerifier: authorization.codeVerifier,
        returnPath,
        stepUpIntentId: intentId,
        stepUpNonce: nonce.nonce,
        expiresAt: Date.now() + 10 * 60 * 1_000,
      },
      auth.flowSecret,
    );
    const response = NextResponse.redirect(authorization.url, 303);
    response.headers.append("Set-Cookie", serializeAuthFlowCookie(flow));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } finally {
    await auth.sessions.close();
    await projectRuntime.close();
  }
}

export const dynamic = "force-dynamic";
