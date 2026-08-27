import type { AccountId, ProjectId } from "@memoid/domain";

export interface AuthenticatedIdentity {
  readonly subject: AccountId;
  readonly assurance: "baseline" | "strong";
  readonly providerSessionId: string;
}

export interface AuthProvider {
  verifySession(token: string): Promise<AuthenticatedIdentity | null>;
  isProviderSessionActive(providerSessionId: string): Promise<boolean>;
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
