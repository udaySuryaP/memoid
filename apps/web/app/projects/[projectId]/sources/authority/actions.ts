"use server";

import {
  parseUuidV7,
  type ProjectId,
  type SourceAuthorityScopeId,
  type SourceId,
} from "@memoid/domain/identifiers";
import {
  fingerprintLifecycleRequest,
  hashIdempotencyKey,
  isAllowedMutationOrigin,
} from "@memoid/security";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sourceAuthorityRuntime } from "../../../../../lib/source-authority-runtime";

export interface AuthorityFormState {
  readonly message?: string;
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

async function requireSameOrigin(): Promise<void> {
  const origin = (await headers()).get("origin");
  const expected = process.env.MEMOID_APP_ORIGIN;
  if (!expected || !isAllowedMutationOrigin(origin, expected)) throw new Error("ORIGIN_MISMATCH");
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("AUTHORITY_REVIEW_REQUIRED"))
    return "Confirm the scoped impact before saving this authority decision.";
  if (message.includes("STEP_UP"))
    return "Verify your identity again before changing Source Authority.";
  if (message.includes("STALE_AUTHORITY_VERSION"))
    return "This authority scope changed in another tab. Refresh and review it again.";
  if (message.includes("SOURCE_UNAVAILABLE"))
    return "The selected Source is unavailable. Authority was not changed.";
  if (message.includes("IDEMPOTENCY_CONFLICT"))
    return "That submission was already used for a different authority decision.";
  return "Memoid could not save this authority decision. Review the controlled fields and try again.";
}

export async function setSourceAuthorityAction(
  _state: AuthorityFormState,
  form: FormData,
): Promise<AuthorityFormState> {
  let destination: string | undefined;
  try {
    await requireSameOrigin();
    const projectId = parseUuidV7(text(form, "projectId"), "ProjectId") as ProjectId;
    const sourceId = parseUuidV7(text(form, "sourceId"), "SourceId") as SourceId;
    const input = {
      projectId,
      sourceId,
      categoryFacet: text(form, "categoryFacet"),
      scopeKind: text(form, "scopeKind"),
      scopeKey: text(form, "scopeKey") || null,
      refSelector: text(form, "refSelector"),
      refKey: text(form, "refKey") || null,
      expectedVersion: Number(text(form, "expectedVersion")),
      reasonKey: text(form, "reasonKey"),
      reasonNote: text(form, "reasonNote") || null,
    };
    const idempotencyKey = text(form, "idempotencyKey");
    if (text(form, "confirmedImpact") !== "yes") throw new Error("AUTHORITY_REVIEW_REQUIRED");
    if (!idempotencyKey) throw new Error("MISSING_IDEMPOTENCY_KEY");
    const runtime = await sourceAuthorityRuntime(`/projects/${projectId}/sources/authority`);
    try {
      await runtime.service.set(runtime.context, {
        ...input,
        scopeKind: input.scopeKind as never,
        refSelector: input.refSelector as never,
        reasonKey: input.reasonKey as never,
        idempotencyKeyHash: hashIdempotencyKey(idempotencyKey),
        requestFingerprint: fingerprintLifecycleRequest(input),
      });
      destination = `/projects/${projectId}/sources/authority`;
    } finally {
      await runtime.close();
    }
  } catch (error) {
    return { message: safeMessage(error) };
  }
  redirect(destination!);
}

export async function revokeSourceAuthorityAction(
  _state: AuthorityFormState,
  form: FormData,
): Promise<AuthorityFormState> {
  let destination: string | undefined;
  try {
    await requireSameOrigin();
    const projectId = parseUuidV7(text(form, "projectId"), "ProjectId") as ProjectId;
    const scopeId = parseUuidV7(
      text(form, "scopeId"),
      "SourceAuthorityScopeId",
    ) as SourceAuthorityScopeId;
    const input = {
      projectId,
      scopeId,
      expectedVersion: Number(text(form, "expectedVersion")),
      reasonKey: text(form, "reasonKey"),
      reasonNote: text(form, "reasonNote") || null,
    };
    const idempotencyKey = text(form, "idempotencyKey");
    if (text(form, "confirmedImpact") !== "yes") throw new Error("AUTHORITY_REVIEW_REQUIRED");
    if (!idempotencyKey) throw new Error("MISSING_IDEMPOTENCY_KEY");
    const runtime = await sourceAuthorityRuntime(`/projects/${projectId}/sources/authority`);
    try {
      await runtime.service.revoke(runtime.context, {
        ...input,
        reasonKey: input.reasonKey as never,
        idempotencyKeyHash: hashIdempotencyKey(idempotencyKey),
        requestFingerprint: fingerprintLifecycleRequest(input),
      });
      destination = `/projects/${projectId}/sources/authority`;
    } finally {
      await runtime.close();
    }
  } catch (error) {
    return { message: safeMessage(error) };
  }
  redirect(destination!);
}
