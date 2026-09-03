"use server";

import {
  fingerprintLifecycleRequest,
  hashIdempotencyKey,
  isAllowedMutationOrigin,
} from "@memoid/security";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { workspaceProjectRuntime } from "../../lib/workspace-project-runtime";

export interface ProjectFormState {
  readonly message?: string;
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

async function requireSameOrigin(): Promise<void> {
  const incoming = await headers();
  const origin = incoming.get("origin");
  const expectedOrigin = process.env.MEMOID_APP_ORIGIN;
  if (!expectedOrigin || !isAllowedMutationOrigin(origin, expectedOrigin)) {
    throw new Error("ORIGIN_MISMATCH");
  }
}

function safeMessage(error: unknown): string {
  if (error instanceof Error && error.message.includes("STALE_PROJECT_VERSION")) {
    return "This project changed in another tab. Refresh and try again.";
  }
  if (error instanceof Error && error.message.includes("IDEMPOTENCY_CONFLICT")) {
    return "That submission was already used for different project details.";
  }
  if (error instanceof Error && error.message.includes("RESOURCE_UNAVAILABLE")) {
    return "This project is unavailable.";
  }
  return "We couldn’t save this project. Check the details and try again.";
}

export async function createProjectAction(
  _state: ProjectFormState,
  form: FormData,
): Promise<ProjectFormState> {
  let destination: string | undefined;
  try {
    await requireSameOrigin();
    const displayName = text(form, "displayName");
    const description = text(form, "description") || null;
    const reviewPolicy = text(form, "reviewPolicy") === "AUTOMATIC" ? "AUTOMATIC" : "MANUAL";
    const idempotencyKey = text(form, "idempotencyKey");
    if (!idempotencyKey) throw new Error("MISSING_IDEMPOTENCY_KEY");
    const runtime = await workspaceProjectRuntime("/projects/new");
    try {
      const result = await runtime.service.createProject(runtime.context, {
        displayName,
        description,
        reviewPolicy,
        idempotencyKeyHash: hashIdempotencyKey(idempotencyKey),
        requestFingerprint: fingerprintLifecycleRequest({ displayName, description, reviewPolicy }),
      });
      destination = `/projects/${result.project.id}`;
    } finally {
      await runtime.close();
    }
  } catch (error) {
    return { message: safeMessage(error) };
  }
  redirect(destination!);
}

export async function updateProjectAction(
  _state: ProjectFormState,
  form: FormData,
): Promise<ProjectFormState> {
  let destination: string | undefined;
  try {
    await requireSameOrigin();
    const projectId = text(form, "projectId");
    const expectedVersion = Number(text(form, "expectedVersion"));
    const runtime = await workspaceProjectRuntime(`/projects/${projectId}/settings`);
    try {
      const project = await runtime.service.updateProject(runtime.context, {
        projectId: projectId as never,
        expectedVersion,
        displayName: text(form, "displayName"),
        description: text(form, "description") || null,
      });
      destination = `/projects/${project.id}`;
    } finally {
      await runtime.close();
    }
  } catch (error) {
    return { message: safeMessage(error) };
  }
  redirect(destination!);
}
