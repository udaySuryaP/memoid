import type {
  AuthProvider,
  AuthenticatedIdentity,
  AuthProviderSecurityEvent,
} from "@memoid/application";
export class TestOnlyAuthProvider implements AuthProvider {
  public constructor(private readonly identity: AuthenticatedIdentity | null) {}
  public async createAuthorizationRequest(): Promise<{
    url: string;
    state: string;
    codeVerifier: string;
  }> {
    return {
      url: "https://auth.test.invalid/authorize",
      state: "test-state",
      codeVerifier: "test-code-verifier",
    };
  }
  public async exchangeAuthorizationCode(): Promise<AuthenticatedIdentity> {
    if (!this.identity) throw new Error("Synthetic provider authentication failed");
    return this.identity;
  }
  public async isProviderSessionActive(): Promise<boolean> {
    return this.identity !== null;
  }
  public async revokeProviderSession(): Promise<void> {}
  public getLogoutUrl(): string {
    return "https://auth.test.invalid/logout";
  }
  public async constructWebhookEvent(): Promise<AuthProviderSecurityEvent> {
    return { type: "IGNORED" };
  }
}
