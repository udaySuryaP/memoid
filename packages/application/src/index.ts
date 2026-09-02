import type { AccountId, ProjectId } from "@memoid/domain";

export interface AuthenticatedIdentity {
  readonly providerKey: string;
  readonly providerSubject: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly providerSessionId: string;
  readonly providerSessionExpiresAt: Date;
  readonly freshAuthenticatedAt: Date;
  readonly authenticationMethod: string;
  readonly impersonated: boolean;
}

export type AuthProviderSecurityEvent =
  | { readonly type: "SESSION_REVOKED"; readonly providerSessionId: string }
  | {
      readonly type: "PASSWORD_RESET_SUCCEEDED" | "USER_DELETED";
      readonly providerKey: string;
      readonly providerSubject: string;
    }
  | { readonly type: "IGNORED" };

export interface AuthProvider {
  createAuthorizationRequest(options: {
    redirectUri: string;
    maxAgeSeconds?: number;
    loginHint?: string;
  }): Promise<{ url: string; state: string; codeVerifier: string }>;
  exchangeAuthorizationCode(options: {
    code: string;
    codeVerifier: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AuthenticatedIdentity>;
  isProviderSessionActive(providerSubject: string, providerSessionId: string): Promise<boolean>;
  revokeProviderSession(providerSessionId: string): Promise<void>;
  getLogoutUrl(providerSessionId: string, returnTo?: string): string;
  constructWebhookEvent(
    payload: string,
    signature: string,
    secret: string,
  ): Promise<AuthProviderSecurityEvent>;
}

export interface GitHubSourcePort {
  getRepositoryIdentity(
    owner: string,
    repository: string,
  ): Promise<{ id: string; fullName: string }>;
}

export interface ReconciliationModel {
  readonly provider: string;
  completeStructured(
    input: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<Record<string, unknown>>>;
}

export interface ObjectStoragePort {
  putTemporary(key: string, body: Uint8Array, expiresAt: Date): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface KeyManagementPort {
  encrypt(plaintext: Uint8Array, context: Readonly<Record<string, string>>): Promise<Uint8Array>;
  decrypt(ciphertext: Uint8Array, context: Readonly<Record<string, string>>): Promise<Uint8Array>;
}

export interface AnalyticsSink {
  capture(event: {
    name: string;
    accountId?: AccountId;
    projectId?: ProjectId;
    properties?: Readonly<Record<string, string | number | boolean>>;
  }): Promise<void>;
}
