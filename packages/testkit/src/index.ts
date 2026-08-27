import type { AuthProvider, AuthenticatedIdentity } from "@memoid/application";
export class TestOnlyAuthProvider implements AuthProvider {
  public constructor(private readonly identity: AuthenticatedIdentity | null) {}
  public async verifySession(): Promise<AuthenticatedIdentity | null> {
    return this.identity;
  }
  public async isProviderSessionActive(): Promise<boolean> {
    return this.identity !== null;
  }
}
