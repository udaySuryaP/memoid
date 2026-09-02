import {
  authorize,
  decideIdentityBinding,
  parseUuidV7,
  requiresFreshAuthentication,
  type AccountIdentityBinding,
  type SessionSecurityState,
} from "../../packages/domain/src/index.js";
import { describe, expect, it } from "vitest";

const accountA = parseUuidV7("018f47c2-1723-7b41-8e0b-3f63207d9401", "AccountId");
const accountB = parseUuidV7("018f47c2-1723-7b41-8e0b-3f63207d9402", "AccountId");
const workspace = parseUuidV7("018f47c2-1723-7b41-8e0b-3f63207d9403", "WorkspaceId");
const workspaceB = parseUuidV7("018f47c2-1723-7b41-8e0b-3f63207d9407", "WorkspaceId");
const actor = parseUuidV7("018f47c2-1723-7b41-8e0b-3f63207d9404", "ActorId");
const bindingId = parseUuidV7("018f47c2-1723-7b41-8e0b-3f63207d9405", "IdentityBindingId");
const sessionId = parseUuidV7("018f47c2-1723-7b41-8e0b-3f63207d9406", "AuthSessionId");

const binding: AccountIdentityBinding = {
  id: bindingId,
  accountId: accountA,
  providerKey: "workos",
  providerSubject: "user_01",
  normalizedEmail: "owner@example.test",
  emailVerified: true,
  state: "ACTIVE",
};

describe("Stage 10C identity, session, and authorization decisions", () => {
  it("requires verified identity evidence and never merges a different subject by email", () => {
    const evidence = {
      providerKey: "workos",
      providerSubject: "user_02",
      email: "OWNER@example.test",
      emailVerified: true,
      providerSessionId: "session_01",
      impersonated: false,
    };
    expect(decideIdentityBinding({ ...evidence, emailVerified: false }, null, null)).toEqual({
      outcome: "DENY",
      reason: "EMAIL_NOT_VERIFIED",
    });
    expect(decideIdentityBinding({ ...evidence, impersonated: true }, null, null)).toEqual({
      outcome: "DENY",
      reason: "IMPERSONATION_NOT_ALLOWED",
    });
    expect(decideIdentityBinding(evidence, null, binding)).toEqual({
      outcome: "DENY",
      reason: "IDENTITY_LINK_AMBIGUOUS",
    });
    expect(
      decideIdentityBinding(
        evidence,
        { ...binding, accountId: accountB, providerSubject: "user_02" },
        binding,
      ),
    ).toEqual({ outcome: "DENY", reason: "IDENTITY_LINK_AMBIGUOUS" });
  });

  it("fails closed for stale sessions and requires provider revalidation for fresh auth", () => {
    const now = Date.now();
    const state: SessionSecurityState = {
      id: sessionId,
      accountId: accountA,
      securityEpoch: 2,
      currentAccountSecurityEpoch: 2,
      createdAt: now - 1_000,
      lastActivityAt: now - 1_000,
      absoluteExpiresAt: now + 10_000,
      idleExpiresAt: now + 10_000,
      providerVerifiedUntil: now - 1,
      providerExpiresAt: now + 10_000,
      freshAuthenticatedAt: now - 1_000,
      revokedAt: null,
      bindingActive: true,
      emailVerified: true,
    };
    expect(requiresFreshAuthentication(state, now)).toBe(true);
    expect(requiresFreshAuthentication({ ...state, providerVerifiedUntil: now + 1_000 }, now)).toBe(
      false,
    );
    expect(requiresFreshAuthentication({ ...state, currentAccountSecurityEpoch: 3 }, now)).toBe(
      true,
    );
  });

  it("binds a human Actor to the Account and applies deny before role allow", () => {
    const principal = {
      kind: "HUMAN" as const,
      id: "user_01",
      accountId: accountA,
      active: true,
      sessionRevoked: false,
      roleAssignments: [{ role: "PERSONAL_WORKSPACE_OWNER" as const, workspaceId: workspace }],
    };
    const actorBinding = { id: actor, kind: "HUMAN" as const, reference: `account:${accountA}` };
    const request = {
      principal,
      actor: actorBinding,
      capability: "WORKSPACE_MANAGE_SECURITY" as const,
      workspaceId: workspace,
      grants: [],
      freshAuthenticationRequired: true,
      freshAuthenticationSatisfied: true,
    };
    expect(authorize(request)).toEqual({ allowed: true, basis: "ROLE" });
    expect(
      authorize({
        ...request,
        grants: [
          {
            capability: request.capability,
            effect: "DENY" as const,
            state: "ACTIVE" as const,
            workspaceId: workspace,
          },
        ],
      }),
    ).toEqual({ allowed: false, reason: "EXPLICIT_DENY" });
    expect(
      authorize({ ...request, actor: { ...actorBinding, reference: `account:${accountB}` } }),
    ).toEqual({ allowed: false, reason: "ACTOR_MISMATCH" });
    expect(authorize({ ...request, freshAuthenticationSatisfied: false })).toEqual({
      allowed: false,
      reason: "FRESH_AUTH_REQUIRED",
    });
    expect(authorize({ ...request, workspaceId: workspaceB })).toEqual({
      allowed: false,
      reason: "CAPABILITY_ABSENT",
    });
    expect(
      authorize({
        ...request,
        principal: {
          ...principal,
          kind: "UNKNOWN" as never,
          roleAssignments: [{ role: "UNKNOWN" as never, workspaceId: workspace }],
        },
        actor: { ...actorBinding, kind: "MEMOID_SYSTEM" },
      }),
    ).toEqual({ allowed: false, reason: "ACTOR_MISMATCH" });
  });
});
