import {
  parseUuidV7,
  type GitHubConnectionIntentId,
  type ProjectId,
} from "@memoid/domain/identifiers";
import {
  GITHUB_FLOW_COOKIE_NAME,
  clearHostCookie,
  sealGitHubFlowState,
  serializeGitHubFlowCookie,
  unsealGitHubFlowState,
} from "@memoid/security";
import { NextResponse } from "next/server";
import { requestCookie } from "../../../../lib/auth-runtime";
import { githubSourceRuntime } from "../../../../lib/github-source-runtime";

export async function GET(request: Request) {
  const origin = process.env.MEMOID_APP_ORIGIN ?? "https://localhost:3000";
  const fail = () => {
    const response = NextResponse.redirect(new URL("/protected-error", origin), 303);
    response.headers.append("Set-Cookie", clearHostCookie(GITHUB_FLOW_COOKIE_NAME));
    response.headers.set("Cache-Control", "no-store");
    return response;
  };
  let runtime: Awaited<ReturnType<typeof githubSourceRuntime>> | null = null;
  try {
    const cookie = requestCookie(request, GITHUB_FLOW_COOKIE_NAME);
    if (!cookie) return fail();
    const flow = unsealGitHubFlowState(
      cookie,
      Buffer.from(process.env.MEMOID_GITHUB_FLOW_SECRET ?? "", "base64url"),
    );
    if (!flow) return fail();
    const projectId = parseUuidV7(flow.projectId, "ProjectId") as ProjectId;
    runtime = await githubSourceRuntime(`/projects/${projectId}/sources/github`);
    const url = new URL(request.url);
    if (url.searchParams.get("state") !== flow.state) return fail();
    const code = url.searchParams.get("code");
    if (!code) {
      const installationId = url.searchParams.get("installation_id");
      if (!installationId || !/^[1-9][0-9]{0,39}$/.test(installationId)) return fail();
      const oauthState = await runtime.repository.rotateState(runtime.context, {
        projectId,
        intentId: parseUuidV7(
          flow.intentId,
          "GitHubConnectionIntentId",
        ) as GitHubConnectionIntentId,
        rawState: flow.state,
      });
      const response = NextResponse.redirect(
        runtime.provider.userAuthorizationUrl(oauthState),
        303,
      );
      response.headers.append(
        "Set-Cookie",
        serializeGitHubFlowCookie(
          sealGitHubFlowState({ ...flow, state: oauthState, installationId }, runtime.flowSecret),
        ),
      );
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    if (!flow.installationId) return fail();
    await runtime.service.discover(runtime.context, {
      projectId,
      intentId: parseUuidV7(flow.intentId, "GitHubConnectionIntentId") as GitHubConnectionIntentId,
      rawState: flow.state,
      installationId: flow.installationId,
      code,
    });
    const response = NextResponse.redirect(
      new URL(`/projects/${projectId}/sources/github/select`, runtime.origin),
      303,
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return fail();
  } finally {
    await runtime?.close();
  }
}
export const dynamic = "force-dynamic";
