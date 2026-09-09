import {
  parseUuidV7,
  type GitHubConnectionIntentId,
  type ProjectId,
} from "@memoid/domain/identifiers";
import {
  GITHUB_FLOW_COOKIE_NAME,
  clearHostCookie,
  fingerprintLifecycleRequest,
  hashIdempotencyKey,
  isAllowedMutationOrigin,
  unsealGitHubFlowState,
} from "@memoid/security";
import { NextResponse } from "next/server";
import { requestCookie } from "../../../../../../../lib/auth-runtime";
import { githubSourceRuntime } from "../../../../../../../lib/github-source-runtime";

export async function POST(
  request: Request,
  { params }: { readonly params: Promise<{ projectId: string }> },
) {
  const { projectId: rawProjectId } = await params;
  const projectId = parseUuidV7(rawProjectId, "ProjectId") as ProjectId;
  const runtime = await githubSourceRuntime(`/projects/${projectId}/sources/github/select`);
  const fail = () => {
    const response = NextResponse.redirect(new URL("/protected-error", runtime.origin), 303);
    response.headers.append("Set-Cookie", clearHostCookie(GITHUB_FLOW_COOKIE_NAME));
    response.headers.set("Cache-Control", "no-store");
    return response;
  };
  try {
    if (!isAllowedMutationOrigin(request.headers.get("origin"), runtime.origin))
      return new NextResponse("Forbidden", { status: 403 });
    const cookie = requestCookie(request, GITHUB_FLOW_COOKIE_NAME);
    const flow = cookie ? unsealGitHubFlowState(cookie, runtime.flowSecret) : null;
    if (!flow || flow.projectId !== projectId || !flow.installationId) return fail();
    const repositoryId = (await request.formData()).get("repositoryId");
    if (typeof repositoryId !== "string") return fail();
    await runtime.service.connect(runtime.context, {
      projectId,
      intentId: parseUuidV7(flow.intentId, "GitHubConnectionIntentId") as GitHubConnectionIntentId,
      rawState: flow.state,
      installationId: flow.installationId,
      repositoryId,
      idempotencyKeyHash: hashIdempotencyKey(flow.idempotencyKey),
      requestFingerprint: fingerprintLifecycleRequest({
        projectId,
        installationId: flow.installationId,
        repositoryId,
      }),
    });
    const response = NextResponse.redirect(
      new URL(`/projects/${projectId}/sources/github`, runtime.origin),
      303,
    );
    response.headers.append("Set-Cookie", clearHostCookie(GITHUB_FLOW_COOKIE_NAME));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return fail();
  } finally {
    await runtime.close();
  }
}
export const dynamic = "force-dynamic";
