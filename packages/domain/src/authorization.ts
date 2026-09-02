import type { AccountId, ActorId, ProjectId, WorkspaceId } from "./identifiers.js";
import type { ActorKind } from "./actor.js";

export const CAPABILITIES = [
  "WORKSPACE_DISCOVER",
  "WORKSPACE_READ",
  "WORKSPACE_MANAGE_SECURITY",
  "PROJECT_DISCOVER",
  "PROJECT_READ",
  "PROJECT_SUBMIT_CANDIDATE",
  "PROJECT_CONTROL",
  "AUDIT_READ",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const ROLE_BUNDLES = ["PERSONAL_WORKSPACE_OWNER", "INTEGRATION_BASE"] as const;
export type RoleBundle = (typeof ROLE_BUNDLES)[number];
export type PrincipalKind = "HUMAN" | "INTEGRATION" | "DEVELOPER_CLIENT" | "SYSTEM";

export interface RoleAssignment {
  readonly role: RoleBundle;
  readonly workspaceId: WorkspaceId;
  readonly projectId?: ProjectId;
}

const ROLE_CAPABILITIES: Readonly<Record<RoleBundle, ReadonlySet<Capability>>> = {
  PERSONAL_WORKSPACE_OWNER: new Set(CAPABILITIES),
  INTEGRATION_BASE: new Set([
    "WORKSPACE_DISCOVER",
    "WORKSPACE_READ",
    "PROJECT_DISCOVER",
    "PROJECT_READ",
    "PROJECT_SUBMIT_CANDIDATE",
  ]),
};

export interface AuthenticatedPrincipal {
  readonly kind: PrincipalKind;
  readonly id: string;
  readonly accountId?: AccountId;
  readonly active: boolean;
  readonly sessionRevoked: boolean;
  readonly roleAssignments: readonly RoleAssignment[];
}

export interface AuthorizationActor {
  readonly id: ActorId;
  readonly kind: ActorKind;
  readonly reference: string;
}

export interface CapabilityGrant {
  readonly capability: Capability;
  readonly effect: "ALLOW" | "DENY";
  readonly state: "ACTIVE" | "REVOKED";
  readonly workspaceId: WorkspaceId;
  readonly projectId?: ProjectId;
}

export interface AuthorizationRequest {
  readonly principal: AuthenticatedPrincipal | null;
  readonly actor: AuthorizationActor | null;
  readonly capability: Capability;
  readonly workspaceId: WorkspaceId;
  readonly projectId?: ProjectId;
  readonly grants: readonly CapabilityGrant[];
  readonly resourceState?: "ACTIVE" | "ARCHIVED" | "DELETING";
  readonly freshAuthenticationRequired?: boolean;
  readonly freshAuthenticationSatisfied?: boolean;
}

export type AuthorizationDecision =
  | { readonly allowed: true; readonly basis: "ROLE" | "EXPLICIT_GRANT" }
  | {
      readonly allowed: false;
      readonly reason:
        | "UNAUTHENTICATED"
        | "STALE_PRINCIPAL"
        | "ACTOR_MISMATCH"
        | "SYSTEM_ACTOR_FORBIDDEN"
        | "RESOURCE_UNAVAILABLE"
        | "EXPLICIT_DENY"
        | "CAPABILITY_ABSENT"
        | "FRESH_AUTH_REQUIRED";
    };

export function parseCapability(value: string): Capability {
  if (!(CAPABILITIES as readonly string[]).includes(value))
    throw new Error(`Unsupported capability: ${value}`);
  return value as Capability;
}

export function parseRoleBundle(value: string): RoleBundle {
  if (!(ROLE_BUNDLES as readonly string[]).includes(value))
    throw new Error(`Unsupported role bundle: ${value}`);
  return value as RoleBundle;
}

function actorMatchesPrincipal(
  principal: AuthenticatedPrincipal,
  actor: AuthorizationActor,
): boolean {
  switch (principal.kind) {
    case "HUMAN":
      return (
        actor.kind === "HUMAN" &&
        principal.accountId !== undefined &&
        actor.reference === `account:${principal.accountId}`
      );
    case "INTEGRATION":
      return actor.kind === "INTEGRATION" && actor.reference === `integration:${principal.id}`;
    case "DEVELOPER_CLIENT":
      return actor.kind === "DEVELOPER_CLIENT" && actor.reference === `client:${principal.id}`;
    case "SYSTEM":
      return actor.kind === "MEMOID_SYSTEM" || actor.kind === "MEMOID_WORKER";
    default:
      return false;
  }
}

function grantMatchesScope(grant: CapabilityGrant, request: AuthorizationRequest): boolean {
  if (grant.workspaceId !== request.workspaceId) return false;
  if (grant.projectId === undefined) return request.projectId === undefined;
  return grant.projectId === request.projectId;
}

function roleMatchesScope(assignment: RoleAssignment, request: AuthorizationRequest): boolean {
  if (assignment.workspaceId !== request.workspaceId) return false;
  return assignment.projectId === undefined || assignment.projectId === request.projectId;
}

export function authorize(request: AuthorizationRequest): AuthorizationDecision {
  const principal = request.principal;
  if (!principal) return { allowed: false, reason: "UNAUTHENTICATED" };
  if (!principal.active || principal.sessionRevoked)
    return { allowed: false, reason: "STALE_PRINCIPAL" };
  if (!request.actor || !actorMatchesPrincipal(principal, request.actor))
    return { allowed: false, reason: "ACTOR_MISMATCH" };
  if (
    principal.kind !== "SYSTEM" &&
    (request.actor.kind === "MEMOID_SYSTEM" || request.actor.kind === "MEMOID_WORKER")
  )
    return { allowed: false, reason: "SYSTEM_ACTOR_FORBIDDEN" };
  if (request.resourceState && request.resourceState !== "ACTIVE")
    return { allowed: false, reason: "RESOURCE_UNAVAILABLE" };

  const matching = request.grants.filter(
    (grant) =>
      grant.capability === request.capability &&
      grantMatchesScope(grant, request) &&
      grant.state === "ACTIVE",
  );
  if (matching.some((grant) => grant.effect === "DENY"))
    return { allowed: false, reason: "EXPLICIT_DENY" };

  const roleAllows = principal.roleAssignments.some((assignment) => {
    const capabilities = ROLE_CAPABILITIES[assignment.role];
    return roleMatchesScope(assignment, request) && capabilities?.has(request.capability) === true;
  });
  const grantAllows = matching.some((grant) => grant.effect === "ALLOW");
  if (!roleAllows && !grantAllows) return { allowed: false, reason: "CAPABILITY_ABSENT" };
  if (request.freshAuthenticationRequired && !request.freshAuthenticationSatisfied)
    return { allowed: false, reason: "FRESH_AUTH_REQUIRED" };
  return { allowed: true, basis: grantAllows ? "EXPLICIT_GRANT" : "ROLE" };
}
