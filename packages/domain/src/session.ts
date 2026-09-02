import type { AccountId, AuthSessionId } from "./identifiers.js";

export const DEFAULT_SESSION_POLICY = Object.freeze({
  absoluteLifetimeMs: 24 * 60 * 60 * 1000,
  inactivityLifetimeMs: 60 * 60 * 1000,
  freshAuthenticationMs: 15 * 60 * 1000,
  providerVerificationMs: 5 * 60 * 1000,
});

export interface SessionSecurityState {
  readonly id: AuthSessionId;
  readonly accountId: AccountId;
  readonly securityEpoch: number;
  readonly currentAccountSecurityEpoch: number;
  readonly createdAt: number;
  readonly lastActivityAt: number;
  readonly absoluteExpiresAt: number;
  readonly idleExpiresAt: number;
  readonly providerVerifiedUntil: number;
  readonly providerExpiresAt: number;
  readonly freshAuthenticatedAt: number;
  readonly revokedAt: number | null;
  readonly bindingActive: boolean;
  readonly emailVerified: boolean;
}

export type SessionAssessment =
  | {
      readonly authenticated: true;
      readonly fresh: boolean;
      readonly providerRecheckRequired: boolean;
    }
  | {
      readonly authenticated: false;
      readonly reason:
        | "REVOKED"
        | "IDENTITY_DISABLED"
        | "SECURITY_STATE_CHANGED"
        | "ABSOLUTE_EXPIRED"
        | "IDLE_EXPIRED"
        | "PROVIDER_EXPIRED";
    };

export function assessSession(state: SessionSecurityState, now = Date.now()): SessionAssessment {
  if (state.revokedAt !== null) return { authenticated: false, reason: "REVOKED" };
  if (!state.bindingActive || !state.emailVerified)
    return { authenticated: false, reason: "IDENTITY_DISABLED" };
  if (state.securityEpoch !== state.currentAccountSecurityEpoch)
    return { authenticated: false, reason: "SECURITY_STATE_CHANGED" };
  if (now >= state.absoluteExpiresAt) return { authenticated: false, reason: "ABSOLUTE_EXPIRED" };
  if (
    now >= state.idleExpiresAt ||
    now - state.lastActivityAt >= DEFAULT_SESSION_POLICY.inactivityLifetimeMs
  )
    return { authenticated: false, reason: "IDLE_EXPIRED" };
  if (now >= state.providerExpiresAt) return { authenticated: false, reason: "PROVIDER_EXPIRED" };
  return {
    authenticated: true,
    fresh: now - state.freshAuthenticatedAt <= DEFAULT_SESSION_POLICY.freshAuthenticationMs,
    providerRecheckRequired: now >= state.providerVerifiedUntil,
  };
}

export function requiresFreshAuthentication(
  state: SessionSecurityState,
  now = Date.now(),
): boolean {
  const assessment = assessSession(state, now);
  return !assessment.authenticated || !assessment.fresh || assessment.providerRecheckRequired;
}
