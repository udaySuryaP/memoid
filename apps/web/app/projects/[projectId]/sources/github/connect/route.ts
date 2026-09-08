import { parseUuidV7, type ProjectId } from "@memoid/domain/identifiers";
import {
  isAllowedMutationOrigin,
  sealGitHubFlowState,
  serializeGitHubFlowCookie,
} from "@memoid/security";
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { githubSourceRuntime } from "../../../../../../lib/github-source-runtime";

export async function POST(
  request: Request,
  { params }: { readonly params: Promise<{ projectId: string }> },
) {
  const { projectId: rawProjectId } = await params;
  const projectId = parseUuidV7(rawProjectId, "ProjectId") as ProjectId;
  const runtime = await githubSourceRuntime(`/projects/${projectId}/sources/github`);
  try {
    if (!isAllowedMutationOrigin(request.headers.get("origin"), runtime.origin))
      return new NextResponse("Forbidden", { status: 403 });
    const intent = await runtime.service.begin(runtime.context, projectId);
    const sealed = sealGitHubFlowState(
      {
        state: intent.rawState,
        intentId: intent.id,
        projectId,
        idempotencyKey: randomBytes(32).toString("base64url"),
        expiresAt: Date.now() + 10 * 60 * 1_000,
      },
      runtime.flowSecret,
    );
    const response = NextResponse.redirect(intent.installationUrl, 303);
    response.headers.append("Set-Cookie", serializeGitHubFlowCookie(sealed));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } finally {
    await runtime.close();
  }
}
export const dynamic = "force-dynamic";
